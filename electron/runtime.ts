import { app, BrowserWindow, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type {
  ApprovalRequest,
  AuditEntry,
  BrowserConfig as BrowserConfigType,
  BrowserSessionInfo,
  ChannelConfig,
  CronJobInfo,
  DinoCreed,
  ExecutionPolicy,
  GoalRequest,
  MemoryCategory,
  MemoryEntry,
  ModelSettings,
  RunGoalResponse,
  RunQueueItem,
  RunRecord,
  RunStep,
  RuntimeSnapshot,
  RuntimeStats,
  Skill,
  StepKind,
  StreamEvent,
  ToolName,
  ToolResult,
  TunnelProvider,
} from '../src/shared/contracts'
import { buildSystemPrompt, deriveMood } from './creed'
import { callModel } from './provider'
import { createStorage, type PersistedState } from './storage'
import {
  executeTool,
  getBrowserSession,
  getToolRisk,
  resetBrowserSession,
  setBrowserConfig,
  setDockerSandbox,
  toolCatalog,
} from './tools'
import { Gateway } from './gateway'
import { ChannelManager } from './channels/manager'
import { Scheduler, type CronJob } from './scheduler'
import { DockerSandbox } from './docker-runtime'
import { TunnelManager } from './tunnel'
import { ServiceManager } from './service'
import { DEFAULT_BROWSER_CONFIG } from './browser-tool'
import { getPlugin, isPluginActive } from './plugin-loader'
import { mergeSkillPacks } from './skills'

const ALL_TOOL_NAMES = toolCatalog.map(t => t.name) as [string, ...string[]]
const BROWSER_MUTATION_TOOLS: ToolName[] = ['browser_click', 'browser_fill', 'browser_type', 'run_script']
const CHECKPOINT_TYPES = new Set<ApprovalRequest['checkpointType']>([
  'login_required',
  'captcha_required',
  'resume_browser_flow',
  'browser_blocked',
])
const INTERACTIVE_BROWSER_KEYWORDS = [
  'post',
  'create post',
  'linkedin',
  'log in',
  'login',
  'sign in',
  'submit',
  'type',
  'fill',
  'click',
  'compose',
  'write a post',
  'share',
  'publish',
  'comment',
  'reply',
  'send message',
]

const TOOL_ARG_CONTRACTS: Partial<Record<ToolName, string>> = {
  open_url: '{"url":"https://..."}',
  browser_navigate: '{"url":"https://..."}',
  browser_wait: '{"ms":500}',
  browser_click: '{"target":"text:Start a post"}',
  browser_fill: '{"target":"placeholder:What do you want to talk about?","value":"..."}',
  browser_type: '{"target":"placeholder:What do you want to talk about?","value":"..."}',
}

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
  private pendingRunResolvers = new Map<string, (response: RunGoalResponse) => void>()
  private queueProcessing = false
  private dockerAvailable = false

  readonly gateway: Gateway
  readonly channels: ChannelManager
  readonly scheduler: Scheduler
  readonly docker: DockerSandbox
  private tunnel: TunnelManager | null = null
  private readonly serviceManager: ServiceManager
  private browserConfig: BrowserConfigType
  private channelConfig: ChannelConfig

  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'dinoclaw')
    this.storage = createStorage(this.dataDir)
    this.state = this.storage.load()
    this.state.skills = mergeSkillPacks(this.state.skills)
    this.workspaceRoot = process.cwd()
    this.startTime = Date.now()

    this.browserConfig = {
      ...DEFAULT_BROWSER_CONFIG,
      ...this.state.browser,
    }
    this.channelConfig = this.state.channelConfig ?? {
      telegram: { botToken: '', allowedUsers: [], enabled: false },
      discord: { botToken: '', allowedUsers: [], enabled: false },
    }

    this.state.creed.mood = deriveMood(this.state.runs.slice(-5))

    this.gateway = new Gateway(this)
    this.channels = new ChannelManager(this)
    this.scheduler = new Scheduler(this, jobs => this.syncCronJobs(jobs))
    this.docker = new DockerSandbox(this.state.dockerConfig)
    this.serviceManager = new ServiceManager()

    setDockerSandbox(this.docker)
    setBrowserConfig(this.browserConfig)

    this.scheduler.loadJobs(this.state.cronJobs as CronJob[])
    if (this.state.cronJobs.some(j => j.enabled)) {
      this.scheduler.start()
    }

    this.recoverInterruptedRuns()
    void this.refreshDockerAvailability()
    void this.restoreChannelConnections()
    this.kickQueue()
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
      auditLog: [...this.state.auditLog].reverse().slice(0, 100),
      channels: this.channelConfig,
      gateway: this.gateway.getInfo(),
      docker: {
        enabled: this.docker.getConfig().enabled,
        available: this.dockerAvailable,
        image: this.docker.getConfig().image,
        network: this.docker.getConfig().network,
      },
      tunnel: this.tunnel?.getInfo() ?? { provider: 'none', running: false, url: '' },
      cronJobs: this.state.cronJobs,
      browser: this.browserConfig,
      browserSession: this.getBrowserSessionInfo(),
      serviceStatus: 'unknown',
      pluginActive: isPluginActive(),
      pluginStatus: getPlugin()?.getStatus?.() ?? null,
      queueDepth: this.state.runQueue.length,
      activeRunId: this.state.activeRunId,
      pendingApprovals: this.state.pendingApprovals,
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
    if (!goal) throw new Error('Goal cannot be empty.')

    const run: RunRecord = {
      id: randomUUID(),
      goal,
      status: 'queued',
      startedAt: Date.now(),
      steps: [],
      toolsUsed: [],
    }

    const queueItem: RunQueueItem = {
      id: randomUUID(),
      runId: run.id,
      goal,
      context: request.context,
      stepIndex: 0,
      messages: [],
      resolvedCheckpoints: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.state.runs.push(run)
    this.trimRuns()
    this.state.runQueue.push(queueItem)
    this.persist()
    this.kickQueue()

    return await new Promise<RunGoalResponse>(resolve => {
      this.pendingRunResolvers.set(run.id, resolve)
    })
  }

  resolveApproval(stepId: string, approved: boolean): void {
    this.state.pendingApprovals = this.state.pendingApprovals.filter(req => req.stepId !== stepId)
    const pending = this.pendingApprovals.get(stepId)
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(approved)
      this.pendingApprovals.delete(stepId)
    } else {
      this.state.approvalDecisions[stepId] = approved
    }
    this.persist()
    this.kickQueue()
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
        m.category.includes(q),
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
    if (existing >= 0) this.state.skills[existing] = skill
    else this.state.skills.push(skill)
    this.state.skills = mergeSkillPacks(this.state.skills)
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
    return this.gateway.start(port)
  }

  stopGateway(): void {
    this.gateway.stop()
  }

  async startTelegram(botToken: string, allowedUsers: string[]): Promise<void> {
    this.channelConfig.telegram = { botToken, allowedUsers, enabled: true }
    this.state.channelConfig = this.channelConfig
    this.persist()
    await this.channels.startTelegram({ botToken, allowedUsers })
  }

  stopTelegram(): void {
    this.channels.stopTelegram()
    this.channelConfig.telegram.enabled = false
    this.state.channelConfig = this.channelConfig
    this.persist()
  }

  async startDiscord(botToken: string, allowedUsers: string[]): Promise<void> {
    this.channelConfig.discord = { botToken, allowedUsers, enabled: true }
    this.state.channelConfig = this.channelConfig
    this.persist()
    await this.channels.startDiscord({ botToken, allowedUsers })
  }

  stopDiscord(): void {
    this.channels.stopDiscord()
    this.channelConfig.discord.enabled = false
    this.state.channelConfig = this.channelConfig
    this.persist()
  }

  addCronJob(name: string, schedule: string, goal: string): CronJobInfo {
    const job = this.scheduler.addJob(name, schedule, goal)
    if (!this.scheduler.isRunning()) this.scheduler.start()
    return { id: job.id, name: job.name, schedule: job.schedule, goal: job.goal, enabled: job.enabled, lastRun: job.lastRun }
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
    this.state.browser = { ...config }
    setBrowserConfig(config)
    this.persist()
  }

  async clearBrowserSession(): Promise<void> {
    const result = await resetBrowserSession()
    if (!result.ok) {
      throw new Error(result.summary)
    }
  }

  getBrowserSessionInfo(): BrowserSessionInfo {
    return getBrowserSession()
  }

  updateDockerConfig(config: Record<string, unknown>): void {
    this.docker.updateConfig(config)
    this.state.dockerConfig = this.docker.getConfig()
    this.persist()
    void this.refreshDockerAvailability()
  }

  async getServiceStatus() {
    return await this.serviceManager.getStatus()
  }

  async installService() {
    return await this.serviceManager.install()
  }

  async uninstallService() {
    return await this.serviceManager.uninstall()
  }

  // ─── Queue + Execution ───────────────────────────────────

  private kickQueue(): void {
    if (!this.queueProcessing) {
      void this.processQueue()
    }
  }

  private async processQueue(): Promise<void> {
    if (this.queueProcessing) return
    this.queueProcessing = true

    try {
      while (this.state.runQueue.length > 0) {
        const queueItem = this.state.runQueue[0]
        this.state.activeRunId = queueItem.runId
        queueItem.updatedAt = Date.now()
        this.persist()

        const response = await this.executeQueuedRun(queueItem)

        if (this.state.runQueue[0]?.id === queueItem.id) {
          this.state.runQueue.shift()
        } else {
          this.state.runQueue = this.state.runQueue.filter(q => q.id !== queueItem.id)
        }
        this.state.activeRunId = null
        this.persist()
        this.resolveRunPromise(queueItem.runId, response)
      }
    } finally {
      this.queueProcessing = false
      this.state.activeRunId = null
      this.persist()
    }
  }

  private async executeQueuedRun(queueItem: RunQueueItem): Promise<RunGoalResponse> {
    const run = this.state.runs.find(r => r.id === queueItem.runId)
    if (!run) {
      return { ok: false, run: this.createMissingRun(queueItem), error: 'Run record missing for queue item.' }
    }

    run.status = 'running'
    const plugin = getPlugin()

    try {
      if (queueItem.messages.length === 0) {
        let pluginPromptExtra = ''
        if (plugin?.onGoalStart) {
          const result = await plugin.onGoalStart(queueItem.goal, queueItem.context)
          if (result?.promptExtra) pluginPromptExtra = result.promptExtra
        }

        let systemPrompt = buildSystemPrompt({
          creed: this.state.creed,
          policy: this.state.policy,
          memory: this.state.memory,
          tools: toolCatalog,
          browser: this.browserConfig,
          skills: this.state.skills,
          goal: queueItem.goal,
        })

        if (pluginPromptExtra) systemPrompt += '\n\n' + pluginPromptExtra
        if (plugin?.enrichSystemPrompt) {
          systemPrompt = await plugin.enrichSystemPrompt(systemPrompt)
        }

        queueItem.messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: queueItem.goal },
        ]
        if (queueItem.context) {
          queueItem.messages.push({ role: 'user', content: `Additional context: ${queueItem.context}` })
        }
        queueItem.updatedAt = Date.now()
        this.persist()
      }

      if (isInteractiveBrowserGoal(queueItem.goal) && !this.browserConfig.enabled) {
        this.enableBrowserAutomationForInteractiveGoal(run, queueItem.goal)
      }

      for (let stepIndex = queueItem.stepIndex; stepIndex < this.state.policy.maxSteps; stepIndex++) {
        queueItem.stepIndex = stepIndex
        queueItem.updatedAt = Date.now()
        this.persist()

        if (queueItem.awaitingApprovalStepId) {
          const approvalReq = this.state.pendingApprovals.find(a => a.stepId === queueItem.awaitingApprovalStepId)
          if (approvalReq) {
            this.emitApprovalRequest(approvalReq)
            const approved = await this.waitForApproval(approvalReq.stepId)
            queueItem.awaitingApprovalStepId = undefined
            run.status = 'running'
            this.state.pendingApprovals = this.state.pendingApprovals.filter(a => a.stepId !== approvalReq.stepId)
            this.persist()

            if (!approved) {
              const deniedStep = createStep('denied', `Tool ${approvalReq.toolName} denied by operator`, '', approvalReq.toolName)
              run.steps.push(deniedStep)
              this.emitStreamEvent(run.id, deniedStep)
              this.addAudit(`Tool denied: ${approvalReq.toolName}`, approvalReq.toolName, approvalReq.risk, false, JSON.stringify(approvalReq.args))
              queueItem.messages.push(
                { role: 'assistant', content: JSON.stringify({ type: 'tool', tool: approvalReq.toolName, reason: approvalReq.reason, args: approvalReq.args }) },
                { role: 'user', content: `TOOL DENIED: ${approvalReq.toolName} was denied by operator.` },
              )
              continue
            }
            const approvedStep = createStep('approved', `Tool ${approvalReq.toolName} approved`, '', approvalReq.toolName)
            run.steps.push(approvedStep)
            this.emitStreamEvent(run.id, approvedStep)
            this.addAudit(`Tool approved: ${approvalReq.toolName}`, approvalReq.toolName, approvalReq.risk, true, JSON.stringify(approvalReq.args))

            const toolStart = Date.now()
            const result = await executeTool(approvalReq.toolName as ToolName, approvalReq.args, {
              workspaceRoot: this.workspaceRoot,
              memory: this.state.memory,
              policy: this.state.policy,
              saveMemory: (fact, category, importance, tags) => this.saveMemory(fact, category, importance, tags),
            })
            if (!run.toolsUsed.includes(approvalReq.toolName as ToolName)) run.toolsUsed.push(approvalReq.toolName as ToolName)
            const resultPayload = formatToolResultForDisplay(result)
            const resultStep = createStep('tool_result', `${approvalReq.toolName} ${result.ok ? 'completed' : 'failed'}`, resultPayload, approvalReq.toolName as ToolName, Date.now() - toolStart)
            run.steps.push(resultStep)
            this.emitStreamEvent(run.id, resultStep)
            this.addAudit(`Tool result: ${approvalReq.toolName}`, approvalReq.toolName as ToolName, approvalReq.risk, result.ok, JSON.stringify({ summary: result.summary }))
            if (plugin?.onStepComplete) await plugin.onStepComplete(resultStep).catch(() => {})
            queueItem.messages.push(
              { role: 'assistant', content: JSON.stringify({ type: 'tool', tool: approvalReq.toolName, reason: approvalReq.reason, args: approvalReq.args }) },
              { role: 'user', content: `TOOL RESULT (${approvalReq.toolName}):\n${formatToolResultForModel(result)}` },
            )
            const resumedHint = buildToolArgHint(approvalReq.toolName as ToolName, result)
            if (resumedHint) {
              queueItem.messages.push({ role: 'user', content: resumedHint })
            }
            this.addReflectionStep(run, queueItem, approvalReq.toolName as ToolName, approvalReq.args, result)
            const checkpointType = extractCheckpointType(result)
            if (checkpointType) {
              const cpApproved = await this.requestBrowserCheckpoint(run, queueItem, approvalReq.toolName as ToolName, checkpointType, result)
              if (!cpApproved) {
                run.status = 'failed'
                run.error = `Browser checkpoint denied: ${checkpointType}`
                run.finishedAt = Date.now()
                this.persist()
                return { ok: false, run, error: run.error }
              }
            }
            queueItem.stepIndex = stepIndex + 1
            queueItem.updatedAt = Date.now()
            this.persist()
            continue
          }
          queueItem.awaitingApprovalStepId = undefined
          this.persist()
        }

        const stepStart = Date.now()
        const rawDecision = await callModel(this.state.model, queueItem.messages)
        const decision = parseDecision(rawDecision)

        if (decision.type === 'message') {
          const browserIncomplete = this.detectBrowserTaskIncomplete(queueItem.goal, run)
          if (browserIncomplete) {
            if (!this.browserConfig.enabled) {
              this.enableBrowserAutomationForInteractiveGoal(run, queueItem.goal)
            }
            queueItem.messages.push(
              { role: 'assistant', content: JSON.stringify(decision) },
              {
                role: 'user',
                content:
                  'BROWSER TASK INCOMPLETE: The goal requires posting, typing, or interacting on a website. Use browser_navigate (not open_url), then browser_snapshot to see the page, then browser_click/browser_type/browser_fill to complete the action. Do not return type=message until the action is actually done.',
              },
            )
            continue
          }

          const step = createStep('final', 'Final response', decision.message, undefined, Date.now() - stepStart)
          run.steps.push(step)
          this.emitStreamEvent(run.id, step)

          run.finalMessage = decision.message
          run.status = 'completed'
          run.finishedAt = Date.now()

          this.state.creed.mood = deriveMood(this.state.runs.slice(-5))
          this.rememberGoalOutcome(run)
          this.persist()
          this.emitNotification('Run Completed', `Goal: ${run.goal.slice(0, 80)}`)

          if (plugin?.onStepComplete) await plugin.onStepComplete(step).catch(() => {})
          if (plugin?.onRunEnd) await plugin.onRunEnd(run).catch(() => {})
          return { ok: true, run }
        }

        const toolName = decision.tool as ToolName
        const risk = getToolRisk(toolName)

        if (toolName === 'open_url' && isInteractiveBrowserGoal(queueItem.goal)) {
          if (!this.browserConfig.enabled) {
            this.enableBrowserAutomationForInteractiveGoal(run, queueItem.goal)
          }
          const blockedStep = createStep(
            'denied',
            'Blocked open_url for interactive browser task',
            'Use browser_navigate/browser_snapshot/browser_click/browser_fill/browser_type for real web automation.',
            toolName,
          )
          run.steps.push(blockedStep)
          this.emitStreamEvent(run.id, blockedStep)
          this.addAudit(
            'Tool blocked by browser-autonomy policy: open_url',
            toolName,
            risk,
            false,
            JSON.stringify(decision.args),
          )
          queueItem.messages.push(
            { role: 'assistant', content: JSON.stringify(decision) },
            {
              role: 'user',
              content:
                'TOOL BLOCKED: open_url is handoff-only and cannot automate posting/clicking/typing. Use browser_navigate first, then browser_snapshot, then browser_click/browser_fill/browser_type with valid args.',
            },
          )
          continue
        }

        const thoughtStep = createStep(
          stepIndex === 0 ? 'planning' : 'thought',
          stepIndex === 0 ? 'Mission plan' : `Reasoning: ${decision.reason}`,
          decision.reason,
          undefined,
          0,
        )
        run.steps.push(thoughtStep)
        this.emitStreamEvent(run.id, thoughtStep)

        const toolStep = createStep('tool', `Executing ${toolName}`, JSON.stringify(decision.args, null, 2), toolName)
        run.steps.push(toolStep)
        this.emitStreamEvent(run.id, toolStep)
        this.addAudit(`Tool invoked: ${toolName}`, toolName, risk, true, JSON.stringify(decision.args))

        if (this.shouldRequireApproval(risk, toolName)) {
          const approved = await this.requestApproval(run, queueItem, {
            runId: run.id,
            stepId: randomUUID(),
            toolName,
            risk,
            reason: decision.reason,
            args: decision.args as Record<string, unknown>,
            kind: 'tool',
          })
          if (!approved) {
            const deniedStep = createStep('denied', `Tool ${toolName} denied by operator`, '', toolName)
            run.steps.push(deniedStep)
            this.emitStreamEvent(run.id, deniedStep)
            this.addAudit(`Tool denied: ${toolName}`, toolName, risk, false, JSON.stringify(decision.args))
            queueItem.messages.push(
              { role: 'assistant', content: JSON.stringify(decision) },
              { role: 'user', content: `TOOL DENIED: ${toolName} was denied by operator.` },
            )
            continue
          }
          this.addAudit(`Tool approved: ${toolName}`, toolName, risk, true, JSON.stringify(decision.args))
        }

        const toolStart = Date.now()
        const result = await executeTool(toolName, decision.args, {
          workspaceRoot: this.workspaceRoot,
          memory: this.state.memory,
          policy: this.state.policy,
          saveMemory: (fact, category, importance, tags) => this.saveMemory(fact, category, importance, tags),
        })

        if (!run.toolsUsed.includes(toolName)) {
          run.toolsUsed.push(toolName)
        }

        const resultPayload = formatToolResultForDisplay(result)
        const resultStep = createStep(
          'tool_result',
          `${toolName} ${result.ok ? 'completed' : 'failed'}`,
          resultPayload,
          toolName,
          Date.now() - toolStart,
        )
        run.steps.push(resultStep)
        this.emitStreamEvent(run.id, resultStep)
        this.addAudit(
          `Tool result: ${toolName}`,
          toolName,
          risk,
          result.ok,
          JSON.stringify({ summary: result.summary, errorCode: result.errorCode, retryable: result.retryable }),
        )

        if (plugin?.onStepComplete) await plugin.onStepComplete(resultStep).catch(() => {})

        queueItem.messages.push(
          { role: 'assistant', content: JSON.stringify(decision) },
          { role: 'user', content: `TOOL RESULT (${toolName}):\n${formatToolResultForModel(result)}` },
        )
        const argHint = buildToolArgHint(toolName, result)
        if (argHint) {
          queueItem.messages.push({ role: 'user', content: argHint })
        }
        this.addReflectionStep(run, queueItem, toolName, decision.args as Record<string, unknown>, result)

        const checkpointType = extractCheckpointType(result)
        if (checkpointType) {
          const approved = await this.requestBrowserCheckpoint(run, queueItem, toolName, checkpointType, result)
          if (!approved) {
            const message = `Browser checkpoint denied: ${checkpointType}`
            run.status = 'failed'
            run.error = message
            run.finishedAt = Date.now()
            const errorStep = createStep('error', 'Run failed', message)
            run.steps.push(errorStep)
            this.emitStreamEvent(run.id, errorStep)
            this.persist()
            return { ok: false, run, error: message }
          }
        }

        queueItem.stepIndex = stepIndex + 1
        queueItem.updatedAt = Date.now()
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
      if (plugin?.onRunEnd) await plugin.onRunEnd(run).catch(() => {})
      return { ok: false, run, error: message }
    }
  }

  private async requestApproval(run: RunRecord, queueItem: RunQueueItem, request: ApprovalRequest): Promise<boolean> {
    request.preview = request.preview ?? buildApprovalPreview(request, this.workspaceRoot)
    const approvalStep = createStep(
      'approval_needed',
      `Approval needed for ${request.toolName} (${request.risk})`,
      request.preview ? `${request.preview}\n\n${JSON.stringify(request.args, null, 2)}` : JSON.stringify(request.args, null, 2),
      request.toolName,
    )
    run.steps.push(approvalStep)
    this.emitStreamEvent(run.id, approvalStep)

    request.stepId = approvalStep.id
    queueItem.awaitingApprovalStepId = request.stepId
    queueItem.updatedAt = Date.now()
    run.status = 'awaiting_approval'
    this.state.pendingApprovals = upsertApproval(this.state.pendingApprovals, request)
    this.persist()
    this.emitApprovalRequest(request)

    const approved = await this.waitForApproval(request.stepId)

    queueItem.awaitingApprovalStepId = undefined
    run.status = 'running'
    this.state.pendingApprovals = this.state.pendingApprovals.filter(a => a.stepId !== request.stepId)
    this.persist()

    if (approved) {
      const approvedStep = createStep('approved', `Tool ${request.toolName} approved`, '', request.toolName)
      run.steps.push(approvedStep)
      this.emitStreamEvent(run.id, approvedStep)
    }

    return approved
  }

  private async requestBrowserCheckpoint(
    run: RunRecord,
    queueItem: RunQueueItem,
    toolName: ToolName,
    checkpointType: NonNullable<ApprovalRequest['checkpointType']>,
    result: ToolResult,
  ): Promise<boolean> {
    const checkpointKey = `${checkpointType}:${String(result.evidence?.url ?? '')}`
    if (queueItem.resolvedCheckpoints.includes(checkpointKey)) {
      return true
    }

    const title = checkpointType.replace(/_/g, ' ')
    const approved = await this.requestApproval(run, queueItem, {
      runId: run.id,
      stepId: randomUUID(),
      toolName,
      risk: 'moderate',
      reason: `Browser checkpoint required: ${title}. Complete the action in DinoClaw Browser, then approve to resume.`,
      args: {
        checkpointType,
        url: result.evidence?.url ?? '',
        hint: result.summary,
      },
      kind: 'browser_checkpoint',
      checkpointType,
      title,
    })

    if (approved) {
      queueItem.resolvedCheckpoints.push(checkpointKey)
      queueItem.messages.push({
        role: 'user',
        content: `BROWSER CHECKPOINT RESOLVED: ${checkpointType}. Continue the task.`,
      })
      this.persist()
    }

    return approved
  }

  private waitForApproval(stepId: string): Promise<boolean> {
    const preDecided = this.state.approvalDecisions[stepId]
    if (typeof preDecided === 'boolean') {
      delete this.state.approvalDecisions[stepId]
      this.persist()
      return Promise.resolve(preDecided)
    }

    return new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(stepId)
        this.state.pendingApprovals = this.state.pendingApprovals.filter(req => req.stepId !== stepId)
        this.persist()
        resolve(false)
      }, 120_000)

      this.pendingApprovals.set(stepId, { resolve, timeout })
    })
  }

  // ─── Private helpers ─────────────────────────────────────

  private addReflectionStep(
    run: RunRecord,
    queueItem: RunQueueItem,
    toolName: ToolName,
    args: Record<string, unknown>,
    result: ToolResult,
  ): void {
    const reflection = buildToolReflection(run, toolName, args, result)
    if (!reflection) return

    const reflectionStep = createStep('reflection', reflection.summary, reflection.payload, toolName)
    run.steps.push(reflectionStep)
    this.emitStreamEvent(run.id, reflectionStep)
    queueItem.messages.push({ role: 'user', content: reflection.prompt })
  }

  private resolveRunPromise(runId: string, response: RunGoalResponse): void {
    const resolver = this.pendingRunResolvers.get(runId)
    if (resolver) {
      resolver(response)
      this.pendingRunResolvers.delete(runId)
    }
  }

  private recoverInterruptedRuns(): void {
    if (!this.state.activeRunId) return
    const activeRun = this.state.runs.find(r => r.id === this.state.activeRunId)
    if (activeRun && (activeRun.status === 'running' || activeRun.status === 'awaiting_approval')) {
      activeRun.status = 'queued'
    }
    this.state.activeRunId = null
    this.persist()
  }

  private async restoreChannelConnections(): Promise<void> {
    const { telegram, discord } = this.channelConfig
    if (telegram.enabled && telegram.botToken) {
      await this.channels.startTelegram({
        botToken: telegram.botToken,
        allowedUsers: telegram.allowedUsers,
      }).catch(() => {})
    }
    if (discord.enabled && discord.botToken) {
      await this.channels.startDiscord({
        botToken: discord.botToken,
        allowedUsers: discord.allowedUsers,
      }).catch(() => {})
    }
  }

  private syncCronJobs(jobs: CronJob[]): void {
    this.state.cronJobs = jobs.map(job => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      goal: job.goal,
      enabled: job.enabled,
      lastRun: job.lastRun,
    }))
    this.persist()
  }

  private async refreshDockerAvailability(): Promise<void> {
    this.dockerAvailable = await this.docker.isAvailable().catch(() => false)
  }

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

  private detectBrowserTaskIncomplete(goal: string, run: RunRecord): boolean {
    if (!isInteractiveBrowserGoal(goal)) return false
    const successful = this.getSuccessfulBrowserMutationTools(run)
    const lower = goal.toLowerCase()
    const isPostingGoal = ['post', 'create post', 'publish', 'share', 'write a post'].some(k => lower.includes(k))

    if (isPostingGoal) {
      const wroteText = successful.has('browser_fill') || successful.has('browser_type')
      const clicked = successful.has('browser_click')
      return !(wroteText && clicked)
    }

    return successful.size === 0
  }

  private enableBrowserAutomationForInteractiveGoal(run: RunRecord, goal: string): void {
    if (this.browserConfig.enabled) return
    this.browserConfig = { ...this.browserConfig, enabled: true }
    this.state.browser = { ...this.browserConfig }
    setBrowserConfig(this.browserConfig)

    const note =
      'Interactive web goal detected. Browser automation was auto-enabled so DinoClaw can navigate, click, and type. Disable it anytime in Infra.'
    const step = createStep('reflection', 'Browser automation auto-enabled', note, 'browser_navigate')
    run.steps.push(step)
    this.emitStreamEvent(run.id, step)
    this.addAudit('Browser automation auto-enabled for interactive web task', 'browser_navigate', 'moderate', true, goal)
    this.persist()
  }

  private getSuccessfulBrowserMutationTools(run: RunRecord): Set<ToolName> {
    const mutationTools = new Set<ToolName>(['browser_click', 'browser_fill', 'browser_type'])
    const successful = new Set<ToolName>()
    for (const step of run.steps) {
      if (
        step.kind === 'tool_result' &&
        Boolean(step.toolName) &&
        mutationTools.has(step.toolName as ToolName) &&
        (step.payload?.includes('ok: true') ?? false)
      ) {
        successful.add(step.toolName as ToolName)
      }
    }
    return successful
  }

  private shouldRequireApproval(risk: string, toolName: ToolName): boolean {
    if (this.browserConfig.requireApprovalForWrites && BROWSER_MUTATION_TOOLS.includes(toolName)) {
      return true
    }
    const { mode, requireApprovalAboveRisk } = this.state.policy
    if (mode === 'open') return false
    if (mode === 'lockdown') return true
    const riskOrder = { safe: 0, moderate: 1, risky: 2 }
    return (riskOrder[risk as keyof typeof riskOrder] ?? 0) >= (riskOrder[requireApprovalAboveRisk] ?? 2)
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
    this.emitNotification('Approval Needed', `${request.toolName} (${request.risk})`)
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
    this.state.auditLog = this.state.auditLog.slice(-1000)
    this.persist()
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
    this.state.runs = this.state.runs.slice(-100)
  }

  private createMissingRun(queueItem: RunQueueItem): RunRecord {
    const fallback: RunRecord = {
      id: queueItem.runId,
      goal: queueItem.goal,
      status: 'failed',
      startedAt: Date.now(),
      finishedAt: Date.now(),
      error: 'Run metadata missing.',
      steps: [],
      toolsUsed: [],
    }
    this.state.runs.push(fallback)
    this.persist()
    return fallback
  }

  private persist(): void {
    this.state.browser = { ...this.browserConfig }
    this.state.channelConfig = { ...this.channelConfig }
    this.state.dockerConfig = this.docker.getConfig()
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

  const direct = parseDecisionCandidate(cleaned)
  if (direct) return direct

  const candidates = extractJsonObjectCandidates(cleaned)
  let lastValid: Decision | null = null
  for (const candidate of candidates) {
    const parsed = parseDecisionCandidate(candidate)
    if (parsed) {
      lastValid = parsed
    }
  }

  if (lastValid) {
    return lastValid
  }
  return { type: 'message', message: cleaned || 'Model returned an invalid structured response.' }
}

function parseDecisionCandidate(candidate: string): Decision | null {
  if (!candidate) return null
  try {
    const parsed = JSON.parse(candidate) as unknown
    return decisionSchema.parse(parsed)
  } catch {
    return null
  }
}

function extractJsonObjectCandidates(input: string): string[] {
  const candidates: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (ch === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.push(input.slice(start, i + 1))
        start = -1
      }
    }
  }

  return candidates
}

function isInteractiveBrowserGoal(goal: string): boolean {
  const lower = goal.toLowerCase()
  return INTERACTIVE_BROWSER_KEYWORDS.some(keyword => lower.includes(keyword))
}

function buildToolArgHint(toolName: ToolName, result: ToolResult): string | null {
  if (result.errorCode !== 'tool_runtime_error') return null
  const lower = result.summary.toLowerCase()
  const likelyArgError =
    lower.includes('invalid input') ||
    lower.includes('expected') ||
    lower.includes('required') ||
    lower.includes('invalid_type')
  if (!likelyArgError) return null

  const contract = TOOL_ARG_CONTRACTS[toolName]
  if (!contract) return null

  return `ARGUMENT ERROR: ${toolName} received invalid args. Use this exact shape: ${contract}`
}

function buildToolReflection(
  run: RunRecord,
  toolName: ToolName,
  args: Record<string, unknown>,
  result: ToolResult,
): { summary: string; payload: string; prompt: string } | null {
  const recentAttempts = countRecentToolAttempts(run, toolName, args)

  if (result.ok && recentAttempts < 2) {
    return null
  }

  if (!result.ok) {
    const payload = [
      `Tool: ${toolName}`,
      `Summary: ${result.summary}`,
      result.errorCode ? `Error code: ${result.errorCode}` : '',
      typeof result.retryable === 'boolean' ? `Retryable: ${result.retryable}` : '',
      `Recent matching attempts: ${recentAttempts}`,
    ].filter(Boolean).join('\n')

    return {
      summary: `Reflection: ${toolName} needs correction`,
      payload,
      prompt: [
        `REFLECTION: ${toolName} failed.`,
        `Summary: ${result.summary}`,
        result.errorCode ? `Error code: ${result.errorCode}.` : '',
        recentAttempts > 1 ? `The same tool/args pattern was attempted ${recentAttempts} times.` : '',
        'Diagnose why it failed using the evidence above.',
        'Do not repeat the same call with the same args unless the page or file state clearly changed.',
        'Prefer inspecting state first, then retry with corrected args or choose a different tool.',
      ].filter(Boolean).join(' '),
    }
  }

  return {
    summary: `Reflection: avoid redundant ${toolName} retries`,
    payload: `The same tool/args pattern has already succeeded ${recentAttempts} times.`,
    prompt: [
      `REFLECTION: ${toolName} with the same args has already succeeded ${recentAttempts} times.`,
      'Only repeat it if the state has changed and you need another pass.',
      'Otherwise move to the next step or finish the task.',
    ].join(' '),
  }
}

function countRecentToolAttempts(run: RunRecord, toolName: ToolName, args: Record<string, unknown>): number {
  const targetArgs = JSON.stringify(args, null, 2)
  let count = 0
  let currentArgs: string | null = null

  for (const step of run.steps) {
    if (step.kind === 'tool' && step.toolName === toolName) {
      currentArgs = step.payload ?? null
    }
    if (step.kind === 'tool_result' && step.toolName === toolName && currentArgs === targetArgs) {
      count += 1
      currentArgs = null
    }
  }

  return count
}

function buildApprovalPreview(request: ApprovalRequest, workspaceRoot: string): string | undefined {
  switch (request.toolName) {
    case 'delete_file': {
      const target = typeof request.args.path === 'string' ? resolvePreviewPath(request.args.path, workspaceRoot) : null
      if (!target) return undefined
      const exists = fs.existsSync(target)
      const size = exists && fs.statSync(target).isFile() ? fs.statSync(target).size : 0
      return exists
        ? `This will permanently delete:\n${target}\nSize: ${formatBytes(size)}`
        : `This will attempt to delete:\n${target}`
    }
    case 'write_file': {
      const target = typeof request.args.path === 'string' ? resolvePreviewPath(request.args.path, workspaceRoot) : null
      const content = typeof request.args.content === 'string' ? request.args.content : ''
      if (!target) return undefined
      const exists = fs.existsSync(target)
      return [
        exists ? 'This will overwrite an existing file:' : 'This will create a file:',
        target,
        `Content length: ${content.length} characters`,
        content ? `Preview: ${truncateSingleLine(content, 140)}` : '',
      ].filter(Boolean).join('\n')
    }
    case 'execute_command':
    case 'docker_exec': {
      const command = typeof request.args.command === 'string' ? request.args.command : ''
      const cwd = typeof request.args.cwd === 'string' ? resolvePreviewPath(request.args.cwd, workspaceRoot) : workspaceRoot
      return [
        request.toolName === 'docker_exec' ? 'Command will run inside Docker sandbox.' : 'Command will run in the local shell.',
        `Working directory: ${cwd}`,
        command ? `Command: ${command}` : '',
      ].filter(Boolean).join('\n')
    }
    case 'run_script': {
      const scriptPath = typeof request.args.path === 'string' ? resolvePreviewPath(request.args.path, workspaceRoot) : path.join(workspaceRoot, '.dinoclaw', 'scripts')
      const language = typeof request.args.language === 'string' ? request.args.language : (process.platform === 'win32' ? 'powershell' : 'bash')
      const execute = request.args.execute !== false
      const useDocker = request.args.useDocker === true
      const content = typeof request.args.content === 'string' ? request.args.content : ''
      return [
        `Script language: ${language}`,
        `Script path: ${scriptPath}`,
        `Execution: ${execute ? (useDocker ? 'Docker sandbox' : 'Local process') : 'Write only'}`,
        content ? `Preview: ${truncateSingleLine(content, 140)}` : '',
      ].filter(Boolean).join('\n')
    }
    case 'browser_click':
    case 'browser_fill':
    case 'browser_type': {
      const target = typeof request.args.target === 'string' ? request.args.target : ''
      const value = typeof request.args.value === 'string' ? request.args.value : ''
      return [
        'This will interact with the live DinoClaw browser session.',
        target ? `Target: ${target}` : '',
        value ? `Text preview: ${truncateSingleLine(value, 140)}` : '',
      ].filter(Boolean).join('\n')
    }
    case 'browser_navigate': {
      const url = typeof request.args.url === 'string' ? request.args.url : ''
      return url ? `This will navigate the DinoClaw browser to:\n${url}` : undefined
    }
    default:
      return undefined
  }
}

function resolvePreviewPath(input: string, workspaceRoot: string): string {
  return path.isAbsolute(input) ? input : path.resolve(workspaceRoot, input)
}

function truncateSingleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatToolResultForDisplay(result: ToolResult): string {
  const lines = [
    `ok: ${result.ok}`,
    `summary: ${result.summary}`,
    result.errorCode ? `errorCode: ${result.errorCode}` : '',
    typeof result.retryable === 'boolean' ? `retryable: ${result.retryable}` : '',
    result.output ? `output:\n${result.output}` : '',
    result.artifacts && result.artifacts.length > 0
      ? `artifacts:\n${result.artifacts.map(a => `- ${a.path}${a.description ? ` (${a.description})` : ''}`).join('\n')}`
      : '',
  ].filter(Boolean)
  return lines.join('\n\n')
}

function formatToolResultForModel(result: ToolResult): string {
  const payload = {
    ok: result.ok,
    summary: result.summary,
    output: result.output?.slice(0, 6000),
    retryable: result.retryable ?? false,
    errorCode: result.errorCode ?? null,
    evidence: result.evidence ?? null,
    artifacts: result.artifacts ?? [],
  }
  return JSON.stringify(payload, null, 2)
}

function extractCheckpointType(result: ToolResult): NonNullable<ApprovalRequest['checkpointType']> | null {
  if (result.errorCode === 'browser_domain_blocked') return 'browser_blocked'
  if (result.errorCode === 'browser_navigation_failed') return 'resume_browser_flow'
  const maybe = result.evidence?.checkpointType
  if (typeof maybe === 'string' && CHECKPOINT_TYPES.has(maybe as ApprovalRequest['checkpointType'])) {
    return maybe as NonNullable<ApprovalRequest['checkpointType']>
  }
  return null
}

function upsertApproval(current: ApprovalRequest[], incoming: ApprovalRequest): ApprovalRequest[] {
  const without = current.filter(r => r.stepId !== incoming.stepId)
  without.push(incoming)
  return without
}
