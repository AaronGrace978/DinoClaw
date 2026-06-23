import fs from 'node:fs'
import path from 'node:path'
import type {
  ApprovalRequest,
  BrowserConfig,
  ChannelConfig,
  CronJobInfo,
  DinoCreed,
  ExecutionPolicy,
  GatewayNestConfig,
  MemoryEntry,
  ModelSettings,
  RunQueueItem,
  RunRecord,
  Skill,
  AuditEntry,
  StompConfig,
  StompJournalEntry,
} from '../src/shared/contracts'
import {
  DEFAULT_STOMP_CONFIG,
  DEFAULT_STOMP_RUNTIME,
  type StompRuntimeState,
} from './dino-stomp-types'
import { expandConfiguredPaths } from './stomp-tidy'
import { defaultCreed } from './creed'
import { DEFAULT_BROWSER_CONFIG } from './browser-tool'
import { DEFAULT_DOCKER_CONFIG, type DockerConfig } from './docker-runtime'
import { getBuiltInSkillPacks, mergeSkillPacks } from './skills'
import { applyRetiredOllamaCloudModelMigrations } from './ollama-cloud-retirements'

export interface PersistedState {
  creed: DinoCreed
  model: ModelSettings
  policy: ExecutionPolicy
  memory: MemoryEntry[]
  runs: RunRecord[]
  skills: Skill[]
  auditLog: AuditEntry[]
  browser: BrowserConfig
  runQueue: RunQueueItem[]
  activeRunId: string | null
  pendingApprovals: ApprovalRequest[]
  approvalDecisions: Record<string, boolean>
  cronJobs: CronJobInfo[]
  channelConfig: ChannelConfig
  gatewayConfig: GatewayNestConfig
  dockerConfig: DockerConfig
  stompConfig: StompConfig
  stompJournal: StompJournalEntry[]
  stompRuntime: StompRuntimeState
}

const DEFAULT_STATE: PersistedState = {
  creed: defaultCreed,
  model: {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.2',
    apiKey: '',
    temperature: 0.2,
    maxTokens: 4096,
  },
  policy: {
    mode: 'review-risky',
    maxSteps: 12,
    allowedCommands: [],
    blockedPaths: [],
    requireApprovalAboveRisk: 'risky',
    desktopAutomationEnabled: false,
  },
  memory: [],
  runs: [],
  skills: getBuiltInSkillPacks(),
  auditLog: [],
  browser: { ...DEFAULT_BROWSER_CONFIG, requireApprovalForWrites: true },
  runQueue: [],
  activeRunId: null,
  pendingApprovals: [],
  approvalDecisions: {},
  cronJobs: [],
  channelConfig: {
    telegram: { botToken: '', allowedUsers: [], enabled: false },
    discord: { botToken: '', allowedUsers: [], enabled: false },
  },
  gatewayConfig: {
    autoStart: false,
    port: 42617,
    bearerToken: '',
  },
  dockerConfig: { ...DEFAULT_DOCKER_CONFIG },
  stompConfig: { ...DEFAULT_STOMP_CONFIG },
  stompJournal: [],
  stompRuntime: { ...DEFAULT_STOMP_RUNTIME },
}

export function createStorage(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true })

  const statePath = path.join(dataDir, 'state.json')
  const backupDir = path.join(dataDir, 'backups')

  const load = (): PersistedState => {
    if (!fs.existsSync(statePath)) return structuredClone(DEFAULT_STATE)

    try {
      const raw = fs.readFileSync(statePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistedState>
      return migrate({
        creed:    parsed.creed    ?? structuredClone(DEFAULT_STATE.creed),
        model:    parsed.model    ?? structuredClone(DEFAULT_STATE.model),
        policy:   parsed.policy   ?? structuredClone(DEFAULT_STATE.policy),
        memory:   parsed.memory   ?? [],
        runs:     parsed.runs     ?? [],
        skills:   parsed.skills   ?? structuredClone(DEFAULT_STATE.skills),
        auditLog: parsed.auditLog ?? [],
        browser:  parsed.browser  ?? structuredClone(DEFAULT_STATE.browser),
        runQueue: parsed.runQueue ?? [],
        activeRunId: parsed.activeRunId ?? null,
        pendingApprovals: parsed.pendingApprovals ?? [],
        approvalDecisions: parsed.approvalDecisions ?? {},
        cronJobs: parsed.cronJobs ?? [],
        channelConfig: parsed.channelConfig ?? structuredClone(DEFAULT_STATE.channelConfig),
        gatewayConfig: parsed.gatewayConfig ?? structuredClone(DEFAULT_STATE.gatewayConfig),
        dockerConfig: parsed.dockerConfig ?? structuredClone(DEFAULT_STATE.dockerConfig),
        stompConfig: parsed.stompConfig ?? structuredClone(DEFAULT_STATE.stompConfig),
        stompJournal: parsed.stompJournal ?? [],
        stompRuntime: parsed.stompRuntime ?? structuredClone(DEFAULT_STATE.stompRuntime),
      })
    } catch {
      return structuredClone(DEFAULT_STATE)
    }
  }

  const save = (state: PersistedState): void => {
    const json = JSON.stringify(state, null, 2)
    const tmp = statePath + '.tmp'
    fs.writeFileSync(tmp, json, 'utf8')
    fs.renameSync(tmp, statePath)
  }

  const backup = (): string => {
    fs.mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = path.join(backupDir, `state-${stamp}.json`)
    if (fs.existsSync(statePath)) {
      fs.copyFileSync(statePath, dest)
    }
    return dest
  }

  return { load, save, backup, statePath }
}

function migrate(state: PersistedState): PersistedState {
  const OLD_DEFAULT_MOTTO = 'AI for the people. Not the portfolio.'
  const OLD_FALLBACK_MOTTO = 'The pain was not wasted. The pain was research.'
  const OLD_CORPORATE_MOTTO = 'AI for Regular People'

  for (const mem of state.memory) {
    if (!mem.category) mem.category = 'fact'
    if (!mem.importance) mem.importance = 3
    if (!mem.tags) mem.tags = []
    if (!mem.accessCount) mem.accessCount = 0
    if (!mem.lastAccessedAt) mem.lastAccessedAt = mem.createdAt
  }

  const creed = state.creed
  if (!creed.motto || creed.motto === OLD_DEFAULT_MOTTO || creed.motto === OLD_FALLBACK_MOTTO || creed.motto === OLD_CORPORATE_MOTTO) {
    creed.motto = DEFAULT_STATE.creed.motto
  }
  if (!creed.traits) creed.traits = structuredClone(DEFAULT_STATE.creed.traits)
  if (!creed.mood) creed.mood = 'focused'

  const model = state.model
  if (!model.maxTokens) model.maxTokens = 4096
  applyRetiredOllamaCloudModelMigrations(model)

  const policy = state.policy
  if (!policy.allowedCommands) policy.allowedCommands = []
  if (!policy.blockedPaths) policy.blockedPaths = []
  if (!policy.requireApprovalAboveRisk) policy.requireApprovalAboveRisk = 'risky'
  if (typeof policy.desktopAutomationEnabled !== 'boolean') policy.desktopAutomationEnabled = false

  state.skills = mergeSkillPacks(Array.isArray(state.skills) ? state.skills : [])

  if (!state.browser) state.browser = structuredClone(DEFAULT_STATE.browser)
  if (!state.browser.allowedDomains) state.browser.allowedDomains = []
  if (typeof state.browser.enabled !== 'boolean') state.browser.enabled = false
  if (typeof state.browser.requireApprovalForWrites !== 'boolean') state.browser.requireApprovalForWrites = true

  if (!Array.isArray(state.runQueue)) state.runQueue = []
  for (const item of state.runQueue) {
    if (!Array.isArray(item.resolvedCheckpoints)) item.resolvedCheckpoints = []
    if (!item.messages) item.messages = []
  }
  if (!state.activeRunId) state.activeRunId = null
  if (!Array.isArray(state.pendingApprovals)) state.pendingApprovals = []
  if (!state.approvalDecisions || typeof state.approvalDecisions !== 'object') state.approvalDecisions = {}
  if (!Array.isArray(state.cronJobs)) state.cronJobs = []

  if (!state.channelConfig) state.channelConfig = structuredClone(DEFAULT_STATE.channelConfig)
  if (!state.channelConfig.telegram) state.channelConfig.telegram = structuredClone(DEFAULT_STATE.channelConfig.telegram)
  if (!state.channelConfig.discord) state.channelConfig.discord = structuredClone(DEFAULT_STATE.channelConfig.discord)
  if (!Array.isArray(state.channelConfig.telegram.allowedUsers)) state.channelConfig.telegram.allowedUsers = []
  if (!Array.isArray(state.channelConfig.discord.allowedUsers)) state.channelConfig.discord.allowedUsers = []

  if (!state.gatewayConfig) state.gatewayConfig = structuredClone(DEFAULT_STATE.gatewayConfig)
  if (typeof state.gatewayConfig.autoStart !== 'boolean') state.gatewayConfig.autoStart = false
  if (!state.gatewayConfig.port) state.gatewayConfig.port = DEFAULT_STATE.gatewayConfig.port
  if (!state.gatewayConfig.bearerToken) state.gatewayConfig.bearerToken = ''

  if (!state.dockerConfig) state.dockerConfig = structuredClone(DEFAULT_STATE.dockerConfig)
  if (typeof state.dockerConfig.enabled !== 'boolean') state.dockerConfig.enabled = DEFAULT_STATE.dockerConfig.enabled
  if (!state.dockerConfig.image) state.dockerConfig.image = DEFAULT_STATE.dockerConfig.image
  if (!state.dockerConfig.network) state.dockerConfig.network = DEFAULT_STATE.dockerConfig.network
  if (!state.dockerConfig.memoryLimitMb) state.dockerConfig.memoryLimitMb = DEFAULT_STATE.dockerConfig.memoryLimitMb
  if (!state.dockerConfig.cpuLimit) state.dockerConfig.cpuLimit = DEFAULT_STATE.dockerConfig.cpuLimit
  if (typeof state.dockerConfig.readOnlyRootfs !== 'boolean') state.dockerConfig.readOnlyRootfs = DEFAULT_STATE.dockerConfig.readOnlyRootfs
  if (typeof state.dockerConfig.mountWorkspace !== 'boolean') state.dockerConfig.mountWorkspace = DEFAULT_STATE.dockerConfig.mountWorkspace

  for (const run of state.runs) {
    if (!run.toolsUsed) run.toolsUsed = []
  }

  for (const skill of state.skills) {
    if (!Array.isArray(skill.triggers)) skill.triggers = []
    if (!Array.isArray(skill.workflow)) skill.workflow = []
    if (!Array.isArray(skill.recovery)) skill.recovery = []
    if (!Array.isArray(skill.outputStyle)) skill.outputStyle = []
    if (!Array.isArray(skill.examples)) skill.examples = []
  }

  if (!state.stompConfig) state.stompConfig = structuredClone(DEFAULT_STATE.stompConfig)
  if (!Array.isArray(state.stompJournal)) state.stompJournal = []
  if (!state.stompRuntime) state.stompRuntime = structuredClone(DEFAULT_STATE.stompRuntime)
  if (!state.stompRuntime.topicPings) state.stompRuntime.topicPings = []
  if (!Array.isArray(state.stompConfig.allowedPaths)) state.stompConfig.allowedPaths = []
  if (!Array.isArray(state.stompConfig.watchPaths)) state.stompConfig.watchPaths = []
  if (typeof state.stompConfig.watchEnabled !== 'boolean') state.stompConfig.watchEnabled = true
  if (state.stompConfig.allowedPaths.length > 0) {
    state.stompConfig.allowedPaths = expandConfiguredPaths(state.stompConfig.allowedPaths)
  }
  if (state.stompConfig.watchPaths.length > 0) {
    state.stompConfig.watchPaths = expandConfiguredPaths(state.stompConfig.watchPaths)
  }

  return state
}
