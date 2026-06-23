import { create } from 'zustand'
import type { ApprovalRequest, MemoryEntry, RunRecord } from '../shared/contracts'
import {
  clearSession,
  DinoLinkClient,
  formatLinkError,
  loadSession,
  saveSession,
  type NestStatus,
} from './api'

interface LinkState {
  connected: boolean
  connecting: boolean
  error: string | null
  nestUrl: string
  client: DinoLinkClient | null
  status: NestStatus | null
  activeRunId: string | null
  activeRun: RunRecord | null
  queue: Array<{ runId: string; goal: string; createdAt: number }>
  recent: RunRecord[]
  approvals: ApprovalRequest[]
  memory: MemoryEntry[]
  goalDraft: string

  pair: (nestUrl: string, code: string) => Promise<void>
  disconnect: () => void
  refresh: () => Promise<void>
  submitGoal: () => Promise<void>
  setGoalDraft: (goal: string) => void
  watchRun: (runId: string) => void
  resolveApproval: (stepId: string, runId: string, approved: boolean) => Promise<void>
  startEventStream: () => () => void
}

let pollTimer: ReturnType<typeof setInterval> | null = null

export const useLinkStore = create<LinkState>((set, get) => ({
  connected: false,
  connecting: false,
  error: null,
  nestUrl: loadSession()?.nestUrl ?? '',
  client: null,
  status: null,
  activeRunId: null,
  activeRun: null,
  queue: [],
  recent: [],
  approvals: [],
  memory: [],
  goalDraft: '',

  pair: async (nestUrl, code) => {
    set({ connecting: true, error: null })
    try {
      const token = await DinoLinkClient.pair(nestUrl, code)
      saveSession(nestUrl, token)
      const client = new DinoLinkClient(nestUrl.replace(/\/$/, ''), token)
      await client.health()
      set({
        connected: true,
        connecting: false,
        nestUrl: nestUrl.replace(/\/$/, ''),
        client,
        error: null,
      })
      await get().refresh()
    } catch (err) {
      set({
        connecting: false,
        connected: false,
        error: formatLinkError(err, nestUrl),
      })
    }
  },

  disconnect: () => {
    clearSession()
    if (pollTimer) clearInterval(pollTimer)
    set({
      connected: false,
      client: null,
      status: null,
      activeRunId: null,
      activeRun: null,
      queue: [],
      recent: [],
      approvals: [],
      memory: [],
      error: null,
    })
  },

  refresh: async () => {
    const { client } = get()
    if (!client) return
    try {
      const [status, missions, approvals, memory] = await Promise.all([
        client.status(),
        client.getMissions(),
        client.getApprovals(),
        client.getMemory(),
      ])
      const activeRunId = status.activeRunId
      let activeRun = get().activeRun
      if (activeRunId && activeRun?.id !== activeRunId) {
        const detail = await client.getMission(activeRunId)
        activeRun = detail.run
      } else if (activeRunId && activeRun) {
        const detail = await client.getMission(activeRunId)
        activeRun = detail.run
      } else if (!activeRunId) {
        activeRun = null
      }
      set({
        status,
        queue: missions.queue,
        recent: missions.recent,
        approvals: approvals.pending,
        memory: memory.entries,
        activeRunId,
        activeRun,
        error: null,
      })
    } catch (err) {
      set({ error: formatLinkError(err, get().nestUrl) })
    }
  },

  submitGoal: async () => {
    const { client, goalDraft } = get()
    const goal = goalDraft.trim()
    if (!client || !goal) return
    set({ goalDraft: '', error: null })
    try {
      const enqueued = await client.submitMission(goal)
      set({ activeRunId: enqueued.runId })
      get().watchRun(enqueued.runId)
      await get().refresh()
    } catch (err) {
      set({ error: formatLinkError(err, get().nestUrl) })
    }
  },

  setGoalDraft: (goal) => set({ goalDraft: goal }),

  watchRun: (runId) => {
    const { client } = get()
    if (!client) return
    void client.getMission(runId).then(detail => {
      set({ activeRunId: runId, activeRun: detail.run })
    })
  },

  resolveApproval: async (stepId, runId, approved) => {
    const { client } = get()
    if (!client) return
    try {
      await client.resolveApproval(stepId, runId, approved)
      await get().refresh()
    } catch (err) {
      set({ error: formatLinkError(err, get().nestUrl) })
    }
  },

  startEventStream: () => {
    const { client } = get()
    if (!client) return () => {}

    const disconnect = client.connectEvents({
      onStream: (event) => {
        const { activeRunId } = get()
        if (event.runId === activeRunId || !activeRunId) {
          void get().refresh()
        }
      },
      onApproval: () => { void get().refresh() },
      onError: () => { void get().refresh() },
    })

    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(() => { void get().refresh() }, 12_000)

    return () => {
      disconnect()
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
    }
  },
}))

export function tryRestoreSession(): boolean {
  const session = loadSession()
  if (!session) return false
  const client = new DinoLinkClient(session.nestUrl, session.token)
  useLinkStore.setState({
    connected: true,
    nestUrl: session.nestUrl,
    client,
  })
  return true
}
