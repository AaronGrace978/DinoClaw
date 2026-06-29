import { create } from 'zustand'
import type {
  DinoCreed,
  ExecutionPolicy,
  GoalRequest,
  ModelSettings,
  RunGoalResponse,
  RuntimeSnapshot,
  StreamEvent,
  ApprovalRequest,
  Skill,
  MemoryEntry,
  TunnelProvider,
  BrowserConfig,
  CronJobInfo,
  StompConfig,
  StompUpdateEvent,
  TidyFolderPreview,
  VoiceConfig,
} from '../shared/contracts'
import { DEFAULT_VOICE_CONFIG } from '../shared/contracts'

interface DinoStore extends RuntimeSnapshot {
  isLoading: boolean
  isRunning: boolean
  error: string | null
  liveSteps: StreamEvent[]
  approvalQueue: ApprovalRequest[]
  memorySearchResults: MemoryEntry[] | null
  workspace: string
  selectedRunId: string | null

  hydrate: () => Promise<void>
  saveCreed: (creed: DinoCreed) => Promise<void>
  saveModel: (model: ModelSettings) => Promise<void>
  savePolicy: (policy: ExecutionPolicy) => Promise<void>
  runGoal: (request: GoalRequest) => Promise<RunGoalResponse | null>
  approveToolUse: (runId: string, stepId: string, approved: boolean) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  searchMemory: (query: string) => Promise<void>
  clearMemorySearch: () => void
  exportMemory: () => Promise<string>
  importMemory: (json: string) => Promise<void>
  installSkill: (skill: Skill) => Promise<void>
  removeSkill: (id: string) => Promise<void>
  openDataDirectory: () => Promise<void>
  pickWorkspace: () => Promise<void>
  selectRun: (id: string | null) => void
  startGateway: (port: number) => Promise<{ port: number; pairingCode: string } | null>
  stopGateway: () => Promise<void>
  startTelegram: (botToken: string, allowedUsers: string[]) => Promise<void>
  stopTelegram: () => Promise<void>
  startDiscord: (botToken: string, allowedUsers: string[]) => Promise<void>
  stopDiscord: () => Promise<void>
  addCronJob: (name: string, schedule: string, goal: string) => Promise<CronJobInfo | null>
  removeCronJob: (id: string) => Promise<void>
  startTunnel: (provider: TunnelProvider, port: number, ngrokToken?: string) => Promise<string | null>
  stopTunnel: () => Promise<void>
  updateBrowser: (config: BrowserConfig) => Promise<void>
  updateVoice: (config: Partial<VoiceConfig>) => Promise<void>
  clearBrowserSession: () => Promise<void>
  clearError: () => void
  updateStompConfig: (config: Partial<StompConfig>) => Promise<void>
  dismissStomp: (id: string) => Promise<void>
  engageStomp: (id: string) => Promise<void>
  stompNow: () => Promise<void>
  stompTidyNow: () => Promise<void>
  previewTidyFolders: () => Promise<TidyFolderPreview[]>
  openStompFolder: (folderPath: string) => Promise<void>
  openStompNotesDirectory: () => Promise<void>
  undoStomp: (id: string) => Promise<void>
}

let streamUnsubscribe: (() => void) | null = null
let approvalUnsubscribe: (() => void) | null = null
let stompUnsubscribe: (() => void) | null = null

const emptySnapshot: RuntimeSnapshot = {
  creed: {
    name: 'DinoClaw', title: 'The Dino Creed', identity: '', relationship: '',
    directives: [], vows: [], motto: '', traits: [], mood: 'focused',
  },
  model: {
    provider: 'ollama', baseUrl: '', model: '', apiKey: '', temperature: 0.2, maxTokens: 4096,
  },
  policy: {
    mode: 'review-risky', maxSteps: 12, allowedCommands: [], blockedPaths: [],
    requireApprovalAboveRisk: 'risky',
  },
  memory: [], runs: [], tools: [], skills: [],
  stats: {
    totalRuns: 0, successRate: 0, avgStepsPerRun: 0, toolUsage: {},
    runsToday: 0, memoryCount: 0, uptime: 0, topGoalPatterns: [],
  },
  auditLog: [],
  channels: {
    telegram: { botToken: '', allowedUsers: [], enabled: false },
    discord: { botToken: '', allowedUsers: [], enabled: false },
  },
  gateway: { running: false, port: 42617, host: '127.0.0.1', paired: false },
  docker: { enabled: false, available: false, image: 'alpine:3.20', network: 'none' },
  tunnel: { provider: 'none', running: false, url: '' },
  cronJobs: [],
  browser: { enabled: false, allowedDomains: [], requireApprovalForWrites: true },
  browserSession: { open: false, url: '', title: '', domain: '' },
  voice: { ...DEFAULT_VOICE_CONFIG },
  serviceStatus: 'unknown',
  pluginActive: false,
  pluginStatus: null,
  queueDepth: 0,
  activeRunId: null,
  pendingApprovals: [],
  stomp: {
    config: {
      enabled: true,
      autonomy: 'notes_only',
      tickSeconds: 300,
      dailyNoteCap: 8,
      dailyActionCap: 3,
      minSpacingMs: 90 * 60 * 1000,
      idleFloorMs: 5 * 60 * 1000,
      quietHoursStart: 22,
      quietHoursEnd: 7,
      dismissStreakThreshold: 2,
      dismissCooldownMs: 6 * 60 * 60 * 1000,
      salienceThreshold: 0.55,
      topicCooldownMs: 12 * 60 * 60 * 1000,
      allowedPaths: [],
      watchPaths: [],
      watchEnabled: true,
    },
    journal: [],
    presence: 'quiet',
    heldCount: 0,
    dismissStreak: 0,
    notesToday: 0,
    actionsToday: 0,
    phase: 'v0.4',
  },
}

async function fetchSnapshot(): Promise<RuntimeSnapshot> {
  const snapshot = await window.dinoClaw.getSnapshot()
  try {
    const serviceStatus = await window.dinoClaw.getServiceStatus()
    return { ...snapshot, serviceStatus }
  } catch {
    return snapshot
  }
}

export const useDinoStore = create<DinoStore>((set) => ({
  ...emptySnapshot,
  isLoading: true,
  isRunning: false,
  error: null,
  liveSteps: [],
  approvalQueue: [],
  memorySearchResults: null,
  workspace: '',
  selectedRunId: null,

  hydrate: async () => {
    set({ isLoading: true, error: null })
    try {
      if (!window.dinoClaw) { set({ isLoading: false }); return }
      const snapshot = await fetchSnapshot()
      const workspace = await window.dinoClaw.getWorkspace()
      set({ ...snapshot, isLoading: false, workspace, approvalQueue: snapshot.pendingApprovals ?? [] })

      streamUnsubscribe?.()
      approvalUnsubscribe?.()

      streamUnsubscribe = window.dinoClaw.onStreamEvent((event) => {
        set(state => ({ liveSteps: [...state.liveSteps, event] }))
      })
      approvalUnsubscribe = window.dinoClaw.onApprovalRequest((request) => {
        set(state => (
          state.approvalQueue.some(item => item.stepId === request.stepId)
            ? state
            : { approvalQueue: [...state.approvalQueue, request] }
        ))
      })

      stompUnsubscribe?.()
      stompUnsubscribe = window.dinoClaw.onStompEvent((event: StompUpdateEvent) => {
        void fetchSnapshot().then(snapshot => {
          set({ ...snapshot, approvalQueue: snapshot.pendingApprovals ?? [] })
        })
        if (event.type === 'stomped') {
          set(state => ({ stomp: { ...state.stomp, presence: event.presence } }))
        }
      })

      window.dinoClaw.recordStompActivity()
      const activity = () => { void window.dinoClaw.recordStompActivity() }
      window.addEventListener('pointerdown', activity)
      window.addEventListener('keydown', activity)
    } catch (error) {
      set({ isLoading: false, error: error instanceof Error ? error.message : 'Failed to load' })
    }
  },

  saveCreed: async (creed) => {
    try {
      const snapshot = await window.dinoClaw.updateCreed(creed)
      set({ ...snapshot, error: null })
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Failed to save creed' }) }
  },

  saveModel: async (model) => {
    try {
      const snapshot = await window.dinoClaw.updateModel(model)
      set({ ...snapshot, error: null })
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Failed to save model' }) }
  },

  savePolicy: async (policy) => {
    try {
      const snapshot = await window.dinoClaw.updatePolicy(policy)
      set({ ...snapshot, error: null })
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Failed to save policy' }) }
  },

  runGoal: async (request) => {
    set({ isRunning: true, error: null, liveSteps: [] })
    try {
      const response = await window.dinoClaw.runGoal(request)
      const snapshot = await fetchSnapshot()
      set({ ...snapshot, isRunning: false, liveSteps: [] })
      return response
    } catch (error) {
      set({ isRunning: false, liveSteps: [], error: error instanceof Error ? error.message : 'Run failed' })
      return null
    }
  },

  approveToolUse: async (runId, stepId, approved) => {
    try {
      await window.dinoClaw.approveToolUse(runId, stepId, approved)
      const snapshot = await fetchSnapshot()
      set({
        ...snapshot,
        approvalQueue: snapshot.pendingApprovals ?? [],
        error: null,
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to resolve approval' })
    }
  },

  deleteMemory: async (id) => {
    const snapshot = await window.dinoClaw.deleteMemory(id)
    set({ ...snapshot, error: null })
  },

  searchMemory: async (query) => {
    const results = await window.dinoClaw.searchMemory(query)
    set({ memorySearchResults: results })
  },

  clearMemorySearch: () => set({ memorySearchResults: null }),

  exportMemory: async () => window.dinoClaw.exportMemory(),

  importMemory: async (json) => {
    const snapshot = await window.dinoClaw.importMemory(json)
    set({ ...snapshot, error: null })
  },

  installSkill: async (skill) => {
    const snapshot = await window.dinoClaw.installSkill(skill)
    set({ ...snapshot, error: null })
  },

  removeSkill: async (id) => {
    const snapshot = await window.dinoClaw.removeSkill(id)
    set({ ...snapshot, error: null })
  },

  openDataDirectory: async () => { if (window.dinoClaw) await window.dinoClaw.openDataDirectory() },

  pickWorkspace: async () => {
    const result = await window.dinoClaw.pickWorkspace()
    if (result) set({ workspace: result })
  },

  selectRun: (id) => set({ selectedRunId: id }),

  startGateway: async (port) => {
    try {
      const result = await window.dinoClaw.startGateway(port)
      const snapshot = await window.dinoClaw.getSnapshot()
      set({ ...snapshot })
      return result
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Gateway failed' }); return null }
  },

  stopGateway: async () => {
    await window.dinoClaw.stopGateway()
    const snapshot = await window.dinoClaw.getSnapshot()
    set({ ...snapshot })
  },

  startTelegram: async (botToken, allowedUsers) => {
    try {
      await window.dinoClaw.startTelegram(botToken, allowedUsers)
      const snapshot = await window.dinoClaw.getSnapshot()
      set({ ...snapshot })
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Telegram failed' }) }
  },

  stopTelegram: async () => {
    await window.dinoClaw.stopTelegram()
    const snapshot = await window.dinoClaw.getSnapshot()
    set({ ...snapshot })
  },

  startDiscord: async (botToken, allowedUsers) => {
    try {
      await window.dinoClaw.startDiscord(botToken, allowedUsers)
      const snapshot = await window.dinoClaw.getSnapshot()
      set({ ...snapshot })
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Discord failed' }) }
  },

  stopDiscord: async () => {
    await window.dinoClaw.stopDiscord()
    const snapshot = await window.dinoClaw.getSnapshot()
    set({ ...snapshot })
  },

  addCronJob: async (name, schedule, goal) => {
    try {
      const job = await window.dinoClaw.addCronJob(name, schedule, goal)
      const snapshot = await window.dinoClaw.getSnapshot()
      set({ ...snapshot })
      return job
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Failed to add job' }); return null }
  },

  removeCronJob: async (id) => {
    await window.dinoClaw.removeCronJob(id)
    const snapshot = await window.dinoClaw.getSnapshot()
    set({ ...snapshot })
  },

  startTunnel: async (provider, port, ngrokToken) => {
    try {
      const url = await window.dinoClaw.startTunnel(provider, port, ngrokToken)
      const snapshot = await window.dinoClaw.getSnapshot()
      set({ ...snapshot })
      return url
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Tunnel failed' }); return null }
  },

  stopTunnel: async () => {
    await window.dinoClaw.stopTunnel()
    const snapshot = await window.dinoClaw.getSnapshot()
    set({ ...snapshot })
  },

  updateBrowser: async (config) => {
    await window.dinoClaw.updateBrowser(config)
    const snapshot = await window.dinoClaw.getSnapshot()
    set({ ...snapshot })
  },

  updateVoice: async (config) => {
    const snapshot = await window.dinoClaw.updateVoice(config)
    set({ ...snapshot })
  },

  clearBrowserSession: async () => {
    await window.dinoClaw.clearBrowserSession()
    const snapshot = await window.dinoClaw.getSnapshot()
    set({ ...snapshot })
  },

  updateStompConfig: async (config) => {
    const stomp = await window.dinoClaw.updateStompConfig(config)
    set(state => ({ ...state, stomp, error: null }))
  },

  dismissStomp: async (id) => {
    const stomp = await window.dinoClaw.dismissStomp(id)
    set(state => ({ ...state, stomp, error: null }))
  },

  engageStomp: async (id) => {
    const stomp = await window.dinoClaw.engageStomp(id)
    set(state => ({ ...state, stomp, error: null }))
  },

  stompNow: async () => {
    const stomp = await window.dinoClaw.stompNow()
    set(state => ({ ...state, stomp, error: null }))
  },

  stompTidyNow: async () => {
    const stomp = await window.dinoClaw.stompTidyNow()
    set(state => ({ ...state, stomp, error: null }))
  },

  previewTidyFolders: async () => {
    return window.dinoClaw.previewTidyFolders()
  },

  openStompFolder: async (folderPath) => {
    await window.dinoClaw.openStompFolder(folderPath)
  },

  openStompNotesDirectory: async () => {
    await window.dinoClaw.openStompNotesDirectory()
  },

  undoStomp: async (id) => {
    const stomp = await window.dinoClaw.undoStomp(id)
    set(state => ({ ...state, stomp, error: null }))
  },

  clearError: () => set({ error: null }),
}))
