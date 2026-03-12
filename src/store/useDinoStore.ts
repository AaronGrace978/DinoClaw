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
} from '../shared/contracts'

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
  clearError: () => void
}

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
  browser: { enabled: false, allowedDomains: [] },
  serviceStatus: 'unknown',
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
      const snapshot = await window.dinoClaw.getSnapshot()
      const workspace = await window.dinoClaw.getWorkspace()
      set({ ...snapshot, isLoading: false, workspace })

      window.dinoClaw.onStreamEvent((event) => {
        set(state => ({ liveSteps: [...state.liveSteps, event] }))
      })
      window.dinoClaw.onApprovalRequest((request) => {
        set(state => ({ approvalQueue: [...state.approvalQueue, request] }))
      })
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
      const snapshot = await window.dinoClaw.getSnapshot()
      set({ ...snapshot, isRunning: false, liveSteps: [] })
      return response
    } catch (error) {
      set({ isRunning: false, error: error instanceof Error ? error.message : 'Run failed' })
      return null
    }
  },

  approveToolUse: async (runId, stepId, approved) => {
    await window.dinoClaw.approveToolUse(runId, stepId, approved)
    set(state => ({ approvalQueue: state.approvalQueue.filter(a => a.stepId !== stepId) }))
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

  clearError: () => set({ error: null }),
}))
