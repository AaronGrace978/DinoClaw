import type {
  DinoClawApi,
  RuntimeSnapshot,
  StompSnapshot,
} from '../shared/contracts'
import { createDemoSnapshot } from './demo-snapshot'

function cloneSnapshot(s: RuntimeSnapshot): RuntimeSnapshot {
  return structuredClone(s)
}

export function installWebMock(): void {
  if (typeof window === 'undefined' || window.dinoClaw) return

  let snapshot = createDemoSnapshot()
  let workspace = 'C:\\Users\\You\\Projects'

  const stompFrom = (): StompSnapshot => snapshot.stomp

  const api: DinoClawApi = {
    getSnapshot: async () => cloneSnapshot(snapshot),
    updateCreed: async (creed) => {
      snapshot = { ...snapshot, creed }
      return cloneSnapshot(snapshot)
    },
    updateModel: async (model) => {
      snapshot = { ...snapshot, model }
      return cloneSnapshot(snapshot)
    },
    updatePolicy: async (policy) => {
      snapshot = { ...snapshot, policy }
      return cloneSnapshot(snapshot)
    },
    runGoal: async (request) => ({
      ok: true,
      run: {
        id: `web-${Date.now()}`,
        goal: request.goal,
        status: 'completed',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        finalMessage:
          'Web preview only — download DinoClaw for your PC to run missions, tools, and desktop copilot for real.',
        steps: [],
        toolsUsed: [],
      },
    }),
    approveToolUse: async () => {},
    deleteMemory: async (id) => {
      snapshot = { ...snapshot, memory: snapshot.memory.filter((m) => m.id !== id) }
      return cloneSnapshot(snapshot)
    },
    searchMemory: async (query) =>
      snapshot.memory.filter((m) => m.fact.toLowerCase().includes(query.toLowerCase())),
    exportMemory: async () => JSON.stringify(snapshot.memory, null, 2),
    importMemory: async () => cloneSnapshot(snapshot),
    installSkill: async () => cloneSnapshot(snapshot),
    removeSkill: async () => cloneSnapshot(snapshot),
    openDataDirectory: async () => {},
    pickWorkspace: async () => workspace,
    setWorkspace: async (dir) => {
      workspace = dir
      return dir
    },
    getWorkspace: async () => workspace,
    showNotification: async (title, body) => {
      console.info('[DinoClaw preview]', title, body)
    },
    startGateway: async () => ({ port: 42617, pairingCode: 'PREVIEW' }),
    stopGateway: async () => {},
    startTelegram: async () => {},
    stopTelegram: async () => {},
    startDiscord: async () => {},
    stopDiscord: async () => {},
    addCronJob: async (name, schedule, goal) => ({
      id: `cron-${Date.now()}`,
      name,
      schedule,
      goal,
      enabled: true,
    }),
    removeCronJob: async () => {},
    toggleCronJob: async () => {},
    startTunnel: async () => '',
    stopTunnel: async () => {},
    updateDocker: async () => {},
    updateBrowser: async () => {},
    getBrowserSession: async () => snapshot.browserSession,
    clearBrowserSession: async () => {},
    getServiceStatus: async () => 'not_installed',
    installService: async () => 'Preview only — install the desktop app.',
    uninstallService: async () => 'Preview only.',
    onStreamEvent: () => () => {},
    onApprovalRequest: () => () => {},
    updateStompConfig: async (config) => {
      snapshot = {
        ...snapshot,
        stomp: { ...snapshot.stomp, config: { ...snapshot.stomp.config, ...config } },
      }
      return stompFrom()
    },
    dismissStomp: async () => stompFrom(),
    engageStomp: async () => stompFrom(),
    stompNow: async () => stompFrom(),
    stompTidyNow: async () => stompFrom(),
    previewTidyFolders: async () => [],
    openStompFolder: async () => {},
    openStompNotesDirectory: async () => {},
    undoStomp: async () => stompFrom(),
    recordStompActivity: async () => {},
    onStompEvent: () => () => {},
  }

  window.dinoClaw = api
}
