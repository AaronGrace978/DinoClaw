import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import path from 'node:path'
import { z } from 'zod'
import type {
  DinoCreed,
  ExecutionPolicy,
  GoalRequest,
  MemoryEntry,
  MemoryCategory,
  ModelSettings,
  RunGoalResponse,
  RunRecord,
  RunStep,
  RuntimeSnapshot,
  RuntimeStats,
  ToolName,
  Skill,
  AuditEntry,
  StepKind,
  StreamEvent,
  ApprovalRequest,
  ChannelConfig,
  CronJobInfo,
  BrowserConfig as BrowserConfigType,
  TunnelProvider,
} from '../src/shared/contracts'
import { buildSystemPrompt, deriveMood } from './creed'
import { callModel } from './provider'
import { createStorage, type PersistedState } from './storage'
import { executeTool, getToolRisk, toolCatalog, setBrowserConfig, setDockerSandbox } from './tools'
import { Gateway } from './gateway'
import { ChannelManager } from './channels/manager'
import { Scheduler, type CronJob } from './scheduler'
import { DockerSandbox } from './docker-runtime'
import { TunnelManager } from './tunnel'
import { ServiceManager } from './service'
import { DEFAULT_BROWSER_CONFIG } from './browser-tool'

const ALL_TOOL_NAMES = toolCatalog.map(t => t.name) as [string, ...string[]]

const decisionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool'),
    tool: z.enum(ALL_TOOL_NAMES),
    reason: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('message'),
    message: z.string().min(1),
  }),
])

type Decision = z.infer<typeof decisionSchema>

interface PendingApproval {
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

export class DinoRuntime {
  private readonly dataDir: string
  private readonly storage: ReturnType<typeof createStorage>
  private state: PersistedState
  private workspaceRoot: string
  private readonly startTime: number
  private pendingApprovals = new Map<string, PendingApproval>()

  readonly gateway: Gateway
  readonly channels: ChannelManager
  readonly scheduler: Scheduler
  readonly docker: DockerSandbox
  private tunnel: TunnelManager | null = null
  private readonly serviceManager: ServiceManager
  private browserConfig: BrowserConfigType = { ...DEFAULT_BROWSER_CONFIG }
  private channelConfig: ChannelConfig = {
    telegram: { botToken: '', allowedUsers: [], enabled: false },
    discord: { botToken: '', allowedUsers: [], enabled: false },
  }

  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'dinoclaw')
    this.storage = createStorage(this.dataDir)
    this.state = this.storage.load()
    this.workspaceRoot = process.cwd()
    this.startTime = Date.now()

    this.state.creed.mood = deriveMood(this.state.runs.slice(-5))

    this.gateway = new Gateway(this)
    this.channels = new ChannelManager(this)
    this.scheduler = new Scheduler(this)
    this.docker = new DockerSandbox()
    this.serviceManager = new ServiceManager()

    setDockerSandbox(this.docker)
    setBrowserConfig(this.browserConfig)
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      creed: this.state.creed,
      model: this.state.model,
      policy: this.state.policy,
      memory: [...this.state.memory].reverse(),
      runs: [...this.state.runs].reverse(),
      tools: toolCatalog,
      skills: this.state.skills,
      stats: this.computeStats(),
      auditLog: [...this.state.auditLog].reverse().slice(0, 50),
      channels: this.channelConfig,
      gateway: this.gateway.getInfo(),
      docker: {
        enabled: false,
        available: false,
        image: this.docker.getConfig().image,
        network: this.docker.getConfig().network,
      },
      tunnel: this.tunnel?.getInfo() ?? { provider: 'none', running: false, url: '' },
      cronJobs: this.scheduler.getJobs().map(j => ({
        id: j.id,
        name: j.name,
        schedule: j.schedule,
        goal: j.goal,
        enabled: j.enabled,
        lastRun: j.lastRun,
      })),
      browser: this.browserConfig,
      serviceStatus: 'unknown',
    }
  }

  updateCreed(creed: DinoCreed): RuntimeSnapshot {
    this.state.creed = creed
    this.persist()
    return this.getSnapshot()
  }

  updateModel(model: ModelSettings): RuntimeSnapshot {
    this.state.model = model
    this.persist()
    return this.getSnapshot()
  }

  updatePolicy(policy: ExecutionPolicy): RuntimeSnapshot {
    this.state.policy = policy
    this.persist()
    return this.getSnapshot()
  }

  async runGoal(request: GoalRequest): Promise<RunGoalResponse> {
    const goal = request.goal.trim()
    const startMs = Date.now()

    const run: RunRecord = {
      id: randomUUID(),
      goal,
      status: 'running',
      startedAt: startMs,
      steps: [],
      toolsUsed: [],
    }

    this.state.runs.push(run)
    this.trimRuns()
    this.persist()

    try {
      const systemPrompt = buildSystemPrompt({
        creed: this.state.creed,
        policy: this.state.policy,
        memory: this.state.memory,
        tools: toolCatalog,
        skills: this.state.skills,
      })

      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: goal },
      ]

      if (request.context) {
        messages.push({ role: 'user', content: `Additional context: ${request.context}` })
      }

      for (let stepIndex = 0; stepIndex < this.state.policy.maxSteps; stepIndex++) {
        const stepStart = Date.now()
        const rawDecision = await callModel(this.state.model, messages)
        const decision = parseDecision(rawDecision)

        if (decision.type === 'message') {
          const step = createStep('final', 'Final response', decision.message, undefined, Date.now() - stepStart)
          run.steps.push(step)
          this.emitStreamEvent(run.id, step)

          run.finalMessage = decision.message
          run.status = 'completed'
          run.finishedAt = Date.now()

          this.state.creed.mood = deriveMood(this.state.runs.slice(-5))
          this.rememberGoalOutcome(run)
          this.persist()
          this.emitNotification('Run Completed', `Goal: ${goal.slice(0, 80)}`)
          return { ok: true, run }
        }

        const toolName = decision.tool as ToolName

        const thoughtStep = createStep('thought', `Reasoning: ${decision.reason}`, decision.reason, undefined, 0)
        run.steps.push(thoughtStep)
        this.emitStreamEvent(run.id, thoughtStep)

        const toolStep = createStep('tool', `Executing ${toolName}`, JSON.stringify(decision.args, null, 2), toolName)
        run.steps.push(toolStep)
        this.emitStreamEvent(run.id, toolStep)

        const risk = getToolRisk(toolName)

        if (this.shouldRequireApproval(risk)) {
          const approvalStep = createStep('approval_needed', `Approval needed for ${toolName} (${risk})`, JSON.stringify(decision.args, null, 2), toolName)
          run.steps.push(approvalStep)
          run.status = 'awaiting_approval'
          this.emitStreamEvent(run.id, approvalStep)
          this.persist()

          this.emitApprovalRequest({
            runId: run.id,
            stepId: approvalStep.id,
            toolName,
            risk,
            reason: decision.reason,
            args: decision.args as Record<string, unknown>,
          })

          const approved = await this.waitForApproval(approvalStep.id)

          if (!approved) {
            const deniedStep = createStep('denied', `Tool ${toolName} denied by operator`, '', toolName)
            run.steps.push(deniedStep)
            this.emitStreamEvent(run.id, deniedStep)
            this.addAudit(`Tool denied: ${toolName}`, toolName, risk, false, JSON.stringify(decision.args))

            run.status = 'running'
            messages.push(
              { role: 'assistant', content: JSON.stringify(decision) },
              { role: 'user', content: `TOOL DENIED: The operator blocked ${toolName}. Try a different approach or ask for guidance.` },
            )
            continue
          }

          const approvedStep = createStep('approved', `Tool ${toolName} approved`, '', toolName)
          run.steps.push(approvedStep)
          this.emitStreamEvent(run.id, approvedStep)
          this.addAudit(`Tool approved: ${toolName}`, toolName, risk, true, JSON.stringify(decision.args))
          run.status = 'running'
        }

        const toolStart = Date.now()
        const result = await executeTool(toolName, decision.args, {
          workspaceRoot: this.workspaceRoot,
          memory: this.state.memory,
          saveMemory: (fact, category, importance, tags) =>
            this.saveMemory(fact, category, importance, tags),
        })

        if (!run.toolsUsed.includes(toolName)) {
          run.toolsUsed.push(toolName)
        }

        const resultStep = createStep('tool_result', `${toolName} completed`, result, toolName, Date.now() - toolStart)
        run.steps.push(resultStep)
        this.emitStreamEvent(run.id, resultStep)

        messages.push(
          { role: 'assistant', content: JSON.stringify(decision) },
          { role: 'user', content: `TOOL RESULT (${toolName}):\n${result}` },
        )

        this.persist()
      }

      throw new Error(`Maximum step count reached (${this.state.policy.maxSteps})`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown runtime failure'
      run.status = 'failed'
      run.error = message
      run.finishedAt = Date.now()

      const errStep = createStep('error', 'Run failed', message)
      run.steps.push(errStep)
      this.emitStreamEvent(run.id, errStep)

      this.state.creed.mood = deriveMood(this.state.runs.slice(-5))
      this.persist()
      this.emitNotification('Run Failed', message.slice(0, 100))
      return { ok: false, run, error: message }
    }
  }

  resolveApproval(stepId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(stepId)
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(approved)
      this.pendingApprovals.delete(stepId)
    }
  }

  deleteMemory(id: string): RuntimeSnapshot {
    this.state.memory = this.state.memory.filter(m => m.id !== id)
    this.persist()
    return this.getSnapshot()
  }

  searchMemory(query: string): MemoryEntry[] {
    const q = query.toLowerCase()
    return this.state.memory
      .filter(m =>
        m.fact.toLowerCase().includes(q) ||
        m.tags.some(t => t.toLowerCase().includes(q)) ||
        m.category.includes(q)
      )
      .sort((a, b) => b.importance - a.importance)
  }

  exportMemory(): string {
    return JSON.stringify(this.state.memory, null, 2)
  }

  importMemory(json: string): RuntimeSnapshot {
    const parsed = JSON.parse(json) as MemoryEntry[]
    if (!Array.isArray(parsed)) throw new Error('Invalid memory format')
    const imported = parsed.filter(m => m.id && m.fact)
    const existingIds = new Set(this.state.memory.map(m => m.id))
    for (const m of imported) {
      if (!existingIds.has(m.id)) {
        if (!m.category) m.category = 'fact'
        if (!m.importance) m.importance = 3
        if (!m.tags) m.tags = []
        if (!m.accessCount) m.accessCount = 0
        if (!m.lastAccessedAt) m.lastAccessedAt = m.createdAt
        this.state.memory.push(m)
      }
    }
    this.persist()
    return this.getSnapshot()
  }

  installSkill(skill: Skill): RuntimeSnapshot {
    const existing = this.state.skills.findIndex(s => s.id === skill.id)
    if (existing >= 0) {
      this.state.skills[existing] = skill
    } else {
      this.state.skills.push(skill)
    }
    this.persist()
    return this.getSnapshot()
  }

  removeSkill(id: string): RuntimeSnapshot {
    this.state.skills = this.state.skills.filter(s => s.id !== id)
    this.persist()
    return this.getSnapshot()
  }

  async openDataDirectory(): Promise<void> {
    await shell.openPath(this.dataDir)
  }

  setWorkspace(dir: string): string {
    this.workspaceRoot = dir
    return this.workspaceRoot
  }

  getWorkspace(): string {
    return this.workspaceRoot
  }

  async startGateway(port: number): Promise<{ port: number; pairingCode: string }> {
    return this.gateway.start()
  }

  stopGateway(): void {
    this.gateway.stop()
  }

  async startTelegram(botToken: string, allowedUsers: string[]): Promise<void> {
    this.channelConfig.telegram = { botToken, allowedUsers, enabled: true }
    await this.channels.startTelegram({ botToken, allowedUsers })
  }

  stopTelegram(): void {
    this.channels.stopTelegram()
    this.channelConfig.telegram.enabled = false
  }

  async startDiscord(botToken: string, allowedUsers: string[]): Promise<void> {
    this.channelConfig.discord = { botToken, allowedUsers, enabled: true }
    await this.channels.startDiscord({ botToken, allowedUsers })
  }

  stopDiscord(): void {
    this.channels.stopDiscord()
    this.channelConfig.discord.enabled = false
  }

  addCronJob(name: string, schedule: string, goal: string): CronJobInfo {
    const job = this.scheduler.addJob(name, schedule, goal)
    if (!this.scheduler.isRunning()) this.scheduler.start()
    return { id: job.id, name: job.name, schedule: job.schedule, goal: job.goal, enabled: job.enabled }
  }

  removeCronJob(id: string): void {
    this.scheduler.removeJob(id)
  }

  toggleCronJob(id: string, enabled: boolean): void {
    if (enabled) this.scheduler.resumeJob(id)
    else this.scheduler.pauseJob(id)
  }

  async startTunnel(provider: TunnelProvider, port: number, ngrokToken?: string): Promise<string> {
    this.tunnel?.stop()
    this.tunnel = new TunnelManager({ provider, port, ngrokToken })
    return this.tunnel.start()
  }

  stopTunnel(): void {
    this.tunnel?.stop()
    this.tunnel = null
  }

  updateBrowserConfig(config: BrowserConfigType): void {
    this.browserConfig = config
    setBrowserConfig(config)
  }

  async getServiceStatus() {
    return this.serviceManager.getStatus()
  }

  async installService() {
    return this.serviceManager.install()
  }

  async uninstallService() {
    return this.serviceManager.uninstall()
  }

  // ─── Private ───────────────────────────────────────────

  private saveMemory(
    fact: string,
    category: MemoryCategory = 'fact',
    importance: number = 3,
    tags: string[] = [],
  ): MemoryEntry {
    const entry: MemoryEntry = {
      id: randomUUID(),
      fact,
      category,
      importance: Math.min(5, Math.max(1, importance)),
      tags,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: Date.now(),
    }
    this.state.memory.push(entry)
    this.state.memory = this.state.memory.slice(-200)
    this.persist()
    return entry
  }

  private rememberGoalOutcome(run: RunRecord): void {
    if (!run.finalMessage) return
    const toolList = run.toolsUsed.length > 0 ? ` [tools: ${run.toolsUsed.join(', ')}]` : ''
    this.saveMemory(
      `Goal: "${run.goal}" → ${run.finalMessage.slice(0, 300)}${toolList}`,
      'pattern',
      2,
      ['goal-outcome'],
    )
  }

  private shouldRequireApproval(risk: string): boolean {
    const { mode, requireApprovalAboveRisk } = this.state.policy
    if (mode === 'open') return false
    if (mode === 'lockdown') return true
    const riskOrder = { safe: 0, moderate: 1, risky: 2 }
    return (riskOrder[risk as keyof typeof riskOrder] ?? 0) >= (riskOrder[requireApprovalAboveRisk] ?? 2)
  }

  private waitForApproval(stepId: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(stepId)
        resolve(false)
      }, 120_000)

      this.pendingApprovals.set(stepId, { resolve, timeout })
    })
  }

  private emitStreamEvent(runId: string, step: RunStep): void {
    const event: StreamEvent = { runId, step }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('dinoclaw:stream', event)
    }
  }

  private emitApprovalRequest(request: ApprovalRequest): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('dinoclaw:approvalRequest', request)
    }
    this.emitNotification('Approval Needed', `Tool: ${request.toolName} (${request.risk})`)
  }

  private emitNotification(title: string, body: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('dinoclaw:notification', { title, body })
    }
  }

  private addAudit(action: string, toolName?: ToolName, risk?: string, approved = true, detail = ''): void {
    this.state.auditLog.push({
      id: randomUUID(),
      timestamp: Date.now(),
      action,
      toolName,
      risk: risk as AuditEntry['risk'],
      approved,
      detail,
    })
    this.state.auditLog = this.state.auditLog.slice(-500)
  }

  private computeStats(): RuntimeStats {
    const runs = this.state.runs
    const completed = runs.filter(r => r.status === 'completed')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayMs = today.getTime()

    const toolUsage: Record<string, number> = {}
    for (const run of runs) {
      for (const tool of run.toolsUsed ?? []) {
        toolUsage[tool] = (toolUsage[tool] ?? 0) + 1
      }
    }

    const goalWords = runs.map(r => r.goal.split(/\s+/).slice(0, 3).join(' '))
    const wordCounts = new Map<string, number>()
    for (const w of goalWords) {
      wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1)
    }
    const topGoalPatterns = [...wordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w)

    return {
      totalRuns: runs.length,
      successRate: runs.length > 0 ? completed.length / runs.length : 0,
      avgStepsPerRun: runs.length > 0 ? runs.reduce((s, r) => s + r.steps.length, 0) / runs.length : 0,
      toolUsage,
      runsToday: runs.filter(r => r.startedAt >= todayMs).length,
      memoryCount: this.state.memory.length,
      uptime: Date.now() - this.startTime,
      topGoalPatterns,
    }
  }

  private trimRuns(): void {
    this.state.runs = this.state.runs.slice(-50)
  }

  private persist(): void {
    this.storage.save(this.state)
  }
}

function createStep(
  kind: StepKind,
  summary: string,
  payload?: string,
  toolName?: ToolName,
  durationMs?: number,
): RunStep {
  return {
    id: randomUUID(),
    kind,
    summary,
    payload,
    toolName,
    createdAt: Date.now(),
    durationMs,
  }
}

function parseDecision(raw: string): Decision {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON object found in model response: ${cleaned.slice(0, 200)}`)

  const parsed = JSON.parse(jsonMatch[0]) as unknown
  return decisionSchema.parse(parsed)
}
