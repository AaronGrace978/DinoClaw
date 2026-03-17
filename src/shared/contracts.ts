/* ─── Providers ─────────────────────────────────────────── */

export type ModelProvider =
  | 'ollama'
  | 'ollama-cloud'
  | 'openai-compatible'
  | 'anthropic'
  | 'google-gemini'
  | 'groq'
  | 'openrouter'

export const PROVIDER_DEFAULTS: Record<ModelProvider, { baseUrl: string; model: string }> = {
  'ollama':             { baseUrl: 'http://127.0.0.1:11434', model: 'llama3.2' },
  'ollama-cloud':       { baseUrl: 'https://ollama.com', model: 'qwen3.5' },
  'openai-compatible':  { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  'anthropic':          { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514' },
  'google-gemini':      { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash' },
  'groq':               { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  'openrouter':         { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4-20250514' },
}

export const OLLAMA_CLOUD_MODELS = [
  'qwen3.5',
  'nemotron-3-super',
  'glm-5',
  'minimax-m2.5',
  'qwen3-coder-next',
  'kimi-k2.5',
  'glm-4.7',
  'deepseek-v3.2',
  'devstral-2',
  'devstral-small-2',
  'qwen3-next',
  'mistral-large-3',
  'ministral-3',
  'cogito-2.1',
  'kimi-k2-thinking',
  'minimax-m2',
  'gemini-3-flash-preview',
  'nemotron-3-nano',
  'rnj-1',
]

/* ─── Tools ─────────────────────────────────────────────── */

export type ToolRisk = 'safe' | 'moderate' | 'risky'

export type ExecutionMode = 'open' | 'review-risky' | 'lockdown'

export type ToolName =
  | 'list_directory'
  | 'read_file'
  | 'write_file'
  | 'delete_file'
  | 'execute_command'
  | 'run_script'
  | 'open_url'
  | 'web_fetch'
  | 'save_memory'
  | 'recall_memory'
  | 'git_status'
  | 'git_log'
  | 'git_diff'
  | 'code_search'
  | 'system_info'
  | 'browser_navigate'
  | 'browser_snapshot'
  | 'browser_click'
  | 'browser_fill'
  | 'browser_type'
  | 'browser_wait'
  | 'browser_close'
  | 'browser_screenshot'
  | 'browser_search'
  | 'hardware_info'
  | 'docker_exec'

/* ─── Creed (enhanced with mood + traits) ───────────────── */

export interface CreedTrait {
  name: string
  score: number
}

export type CreedMood = 'focused' | 'curious' | 'cautious' | 'determined' | 'reflective'

export interface DinoCreed {
  name: string
  title: string
  identity: string
  relationship: string
  directives: string[]
  vows: string[]
  motto: string
  traits: CreedTrait[]
  mood: CreedMood
}

/* ─── Model ─────────────────────────────────────────────── */

export interface ModelSettings {
  provider: ModelProvider
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
}

/* ─── Execution ─────────────────────────────────────────── */

export interface ExecutionPolicy {
  mode: ExecutionMode
  maxSteps: number
  allowedCommands: string[]
  blockedPaths: string[]
  requireApprovalAboveRisk: ToolRisk
}

/* ─── Memory ────────────────────────────────────────────── */

export type MemoryCategory = 'fact' | 'preference' | 'pattern' | 'context' | 'skill'

export interface MemoryEntry {
  id: string
  fact: string
  category: MemoryCategory
  importance: number
  tags: string[]
  createdAt: number
  accessCount: number
  lastAccessedAt: number
}

/* ─── Tools ─────────────────────────────────────────────── */

export interface ToolCatalogItem {
  name: ToolName
  risk: ToolRisk
  description: string
}

export interface ToolArtifact {
  path: string
  description?: string
}

export interface ToolResult {
  ok: boolean
  summary: string
  output?: string
  retryable?: boolean
  errorCode?: string
  evidence?: Record<string, unknown>
  artifacts?: ToolArtifact[]
}

/* ─── Runs ──────────────────────────────────────────────── */

export type StepKind = 'planning' | 'thought' | 'tool' | 'tool_result' | 'reflection' | 'approval_needed' | 'approved' | 'denied' | 'final' | 'error'

export interface RunStep {
  id: string
  kind: StepKind
  summary: string
  toolName?: ToolName
  payload?: string
  createdAt: number
  durationMs?: number
}

export interface RunRecord {
  id: string
  goal: string
  status: 'idle' | 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed'
  startedAt: number
  finishedAt?: number
  finalMessage?: string
  error?: string
  steps: RunStep[]
  toolsUsed: ToolName[]
  tokenEstimate?: number
}

/* ─── Skills ────────────────────────────────────────────── */

export interface Skill {
  id: string
  name: string
  description: string
  version: string
  author: string
  instructions: string
  tools: ToolName[]
  enabled: boolean
  builtin?: boolean
  triggers?: string[]
  category?: string
  workflow?: string[]
  recovery?: string[]
  outputStyle?: string[]
  examples?: string[]
}

/* ─── Audit Log ─────────────────────────────────────────── */

export interface AuditEntry {
  id: string
  timestamp: number
  action: string
  toolName?: ToolName
  risk?: ToolRisk
  approved: boolean
  detail: string
}

/* ─── Analytics ─────────────────────────────────────────── */

export interface RuntimeStats {
  totalRuns: number
  successRate: number
  avgStepsPerRun: number
  toolUsage: Record<string, number>
  runsToday: number
  memoryCount: number
  uptime: number
  topGoalPatterns: string[]
}

/* ─── Channels ──────────────────────────────────────────── */

export interface ChannelConfig {
  telegram: { botToken: string; allowedUsers: string[]; enabled: boolean }
  discord: { botToken: string; allowedUsers: string[]; enabled: boolean }
}

/* ─── Gateway ───────────────────────────────────────────── */

export interface GatewayStatus {
  running: boolean
  port: number
  host: string
  paired: boolean
}

/* ─── Docker Sandbox ────────────────────────────────────── */

export interface DockerStatus {
  enabled: boolean
  available: boolean
  image: string
  network: string
}

/* ─── Tunnel ────────────────────────────────────────────── */

export type TunnelProvider = 'none' | 'cloudflare' | 'ngrok' | 'custom'

export interface TunnelStatus {
  provider: TunnelProvider
  running: boolean
  url: string
}

/* ─── Scheduler ─────────────────────────────────────────── */

export interface CronJobInfo {
  id: string
  name: string
  schedule: string
  goal: string
  enabled: boolean
  lastRun?: number
}

/* ─── Browser ───────────────────────────────────────────── */

export interface BrowserConfig {
  enabled: boolean
  allowedDomains: string[]
  requireApprovalForWrites: boolean
}

export interface BrowserSessionInfo {
  open: boolean
  url: string
  title: string
  domain: string
}

/* ─── Service ───────────────────────────────────────────── */

export type ServiceStatus = 'installed' | 'running' | 'stopped' | 'not_installed' | 'unknown'

/* ─── Snapshot ──────────────────────────────────────────── */

export interface RuntimeSnapshot {
  creed: DinoCreed
  model: ModelSettings
  policy: ExecutionPolicy
  memory: MemoryEntry[]
  runs: RunRecord[]
  tools: ToolCatalogItem[]
  skills: Skill[]
  stats: RuntimeStats
  auditLog: AuditEntry[]
  channels: ChannelConfig
  gateway: GatewayStatus
  docker: DockerStatus
  tunnel: TunnelStatus
  cronJobs: CronJobInfo[]
  browser: BrowserConfig
  browserSession: BrowserSessionInfo
  serviceStatus: ServiceStatus
  pluginActive: boolean
  pluginStatus: Record<string, unknown> | null
  queueDepth: number
  activeRunId: string | null
  pendingApprovals: ApprovalRequest[]
}

/* ─── IPC Contracts ─────────────────────────────────────── */

export interface GoalRequest {
  goal: string
  context?: string
}

export interface RunGoalResponse {
  ok: boolean
  run: RunRecord
  error?: string
}

export interface ApprovalRequest {
  runId: string
  stepId: string
  toolName: ToolName
  risk: ToolRisk
  reason: string
  args: Record<string, unknown>
  preview?: string
  kind?: 'tool' | 'browser_checkpoint'
  checkpointType?: 'login_required' | 'captcha_required' | 'resume_browser_flow' | 'browser_blocked'
  title?: string
}

export interface RunMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RunQueueItem {
  id: string
  runId: string
  goal: string
  context?: string
  stepIndex: number
  messages: RunMessage[]
  awaitingApprovalStepId?: string
  resolvedCheckpoints: string[]
  createdAt: number
  updatedAt: number
}

export interface StreamEvent {
  runId: string
  step: RunStep
}

export interface DinoClawApi {
  getSnapshot: () => Promise<RuntimeSnapshot>
  updateCreed: (creed: DinoCreed) => Promise<RuntimeSnapshot>
  updateModel: (model: ModelSettings) => Promise<RuntimeSnapshot>
  updatePolicy: (policy: ExecutionPolicy) => Promise<RuntimeSnapshot>
  runGoal: (request: GoalRequest) => Promise<RunGoalResponse>
  approveToolUse: (runId: string, stepId: string, approved: boolean) => Promise<void>
  deleteMemory: (id: string) => Promise<RuntimeSnapshot>
  searchMemory: (query: string) => Promise<MemoryEntry[]>
  exportMemory: () => Promise<string>
  importMemory: (json: string) => Promise<RuntimeSnapshot>
  installSkill: (skill: Skill) => Promise<RuntimeSnapshot>
  removeSkill: (id: string) => Promise<RuntimeSnapshot>
  openDataDirectory: () => Promise<void>
  pickWorkspace: () => Promise<string | null>
  setWorkspace: (dir: string) => Promise<string>
  getWorkspace: () => Promise<string>
  showNotification: (title: string, body: string) => Promise<void>
  startGateway: (port: number) => Promise<{ port: number; pairingCode: string }>
  stopGateway: () => Promise<void>
  startTelegram: (botToken: string, allowedUsers: string[]) => Promise<void>
  stopTelegram: () => Promise<void>
  startDiscord: (botToken: string, allowedUsers: string[]) => Promise<void>
  stopDiscord: () => Promise<void>
  addCronJob: (name: string, schedule: string, goal: string) => Promise<CronJobInfo>
  removeCronJob: (id: string) => Promise<void>
  toggleCronJob: (id: string, enabled: boolean) => Promise<void>
  startTunnel: (provider: TunnelProvider, port: number, ngrokToken?: string) => Promise<string>
  stopTunnel: () => Promise<void>
  updateDocker: (config: Partial<DockerStatus>) => Promise<void>
  updateBrowser: (config: BrowserConfig) => Promise<void>
  getBrowserSession: () => Promise<BrowserSessionInfo>
  clearBrowserSession: () => Promise<void>
  getServiceStatus: () => Promise<ServiceStatus>
  installService: () => Promise<string>
  uninstallService: () => Promise<string>
  onStreamEvent: (callback: (event: StreamEvent) => void) => () => void
  onApprovalRequest: (callback: (request: ApprovalRequest) => void) => () => void
}
