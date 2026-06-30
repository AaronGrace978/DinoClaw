import { contextBridge, ipcRenderer } from 'electron'
import type { DinoClawApi, VoicePrepareProgress } from '../src/shared/contracts'

const api: DinoClawApi = {
  getSnapshot: () => ipcRenderer.invoke('dinoclaw:getSnapshot'),
  updateCreed: (creed) => ipcRenderer.invoke('dinoclaw:updateCreed', creed),
  updateModel: (model) => ipcRenderer.invoke('dinoclaw:updateModel', model),
  updatePolicy: (policy) => ipcRenderer.invoke('dinoclaw:updatePolicy', policy),
  runGoal: (request) => ipcRenderer.invoke('dinoclaw:runGoal', request),
  approveToolUse: (runId, stepId, approved) => ipcRenderer.invoke('dinoclaw:approveToolUse', runId, stepId, approved),
  deleteMemory: (id) => ipcRenderer.invoke('dinoclaw:deleteMemory', id),
  searchMemory: (query) => ipcRenderer.invoke('dinoclaw:searchMemory', query),
  exportMemory: () => ipcRenderer.invoke('dinoclaw:exportMemory'),
  importMemory: (json) => ipcRenderer.invoke('dinoclaw:importMemory', json),
  installSkill: (skill) => ipcRenderer.invoke('dinoclaw:installSkill', skill),
  removeSkill: (id) => ipcRenderer.invoke('dinoclaw:removeSkill', id),
  openDataDirectory: () => ipcRenderer.invoke('dinoclaw:openDataDirectory'),
  pickWorkspace: () => ipcRenderer.invoke('dinoclaw:pickWorkspace'),
  setWorkspace: (dir) => ipcRenderer.invoke('dinoclaw:setWorkspace', dir),
  getWorkspace: () => ipcRenderer.invoke('dinoclaw:getWorkspace'),
  showNotification: (title, body) => ipcRenderer.invoke('dinoclaw:showNotification', title, body),
  startGateway: (port) => ipcRenderer.invoke('dinoclaw:startGateway', port),
  stopGateway: () => ipcRenderer.invoke('dinoclaw:stopGateway'),
  startTelegram: (botToken, allowedUsers) => ipcRenderer.invoke('dinoclaw:startTelegram', botToken, allowedUsers),
  stopTelegram: () => ipcRenderer.invoke('dinoclaw:stopTelegram'),
  startDiscord: (botToken, allowedUsers) => ipcRenderer.invoke('dinoclaw:startDiscord', botToken, allowedUsers),
  stopDiscord: () => ipcRenderer.invoke('dinoclaw:stopDiscord'),
  addCronJob: (name, schedule, goal) => ipcRenderer.invoke('dinoclaw:addCronJob', name, schedule, goal),
  removeCronJob: (id) => ipcRenderer.invoke('dinoclaw:removeCronJob', id),
  toggleCronJob: (id, enabled) => ipcRenderer.invoke('dinoclaw:toggleCronJob', id, enabled),
  startTunnel: (provider, port, ngrokToken) => ipcRenderer.invoke('dinoclaw:startTunnel', provider, port, ngrokToken),
  stopTunnel: () => ipcRenderer.invoke('dinoclaw:stopTunnel'),
  updateDocker: (config) => ipcRenderer.invoke('dinoclaw:updateDocker', config),
  updateBrowser: (config) => ipcRenderer.invoke('dinoclaw:updateBrowser', config),
  updateVoice: (config) => ipcRenderer.invoke('dinoclaw:updateVoice', config),
  transcribeAudio: (audio, mimeType) => ipcRenderer.invoke('dinoclaw:transcribeAudio', audio, mimeType),
  transcribePcm: (audio, sampleRate) => ipcRenderer.invoke('dinoclaw:transcribePcm', audio, sampleRate),
  speakText: (text) => ipcRenderer.invoke('dinoclaw:speakText', text),
  stopSpeech: () => ipcRenderer.invoke('dinoclaw:stopSpeech'),
  prepareVoice: () => ipcRenderer.invoke('dinoclaw:prepareVoice'),
  getVoiceStatus: () => ipcRenderer.invoke('dinoclaw:getVoiceStatus'),
  getAppVersion: () => ipcRenderer.invoke('dinoclaw:getAppVersion'),
  onVoiceStatus: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as VoicePrepareProgress)
    ipcRenderer.on('dinoclaw:voiceStatus', handler)
    return () => ipcRenderer.removeListener('dinoclaw:voiceStatus', handler)
  },
  getBrowserSession: () => ipcRenderer.invoke('dinoclaw:getBrowserSession'),
  clearBrowserSession: () => ipcRenderer.invoke('dinoclaw:clearBrowserSession'),
  getServiceStatus: () => ipcRenderer.invoke('dinoclaw:getServiceStatus'),
  installService: () => ipcRenderer.invoke('dinoclaw:installService'),
  uninstallService: () => ipcRenderer.invoke('dinoclaw:uninstallService'),
  onStreamEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0])
    ipcRenderer.on('dinoclaw:stream', handler)
    return () => ipcRenderer.removeListener('dinoclaw:stream', handler)
  },
  onApprovalRequest: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0])
    ipcRenderer.on('dinoclaw:approvalRequest', handler)
    return () => ipcRenderer.removeListener('dinoclaw:approvalRequest', handler)
  },
  updateStompConfig: (config) => ipcRenderer.invoke('dinoclaw:updateStompConfig', config),
  dismissStomp: (id) => ipcRenderer.invoke('dinoclaw:dismissStomp', id),
  engageStomp: (id) => ipcRenderer.invoke('dinoclaw:engageStomp', id),
  stompNow: () => ipcRenderer.invoke('dinoclaw:stompNow'),
  stompTidyNow: () => ipcRenderer.invoke('dinoclaw:stompTidyNow'),
  previewTidyFolders: () => ipcRenderer.invoke('dinoclaw:previewTidyFolders'),
  openStompFolder: (folderPath) => ipcRenderer.invoke('dinoclaw:openStompFolder', folderPath),
  openStompNotesDirectory: () => ipcRenderer.invoke('dinoclaw:openStompNotesDirectory'),
  undoStomp: (id) => ipcRenderer.invoke('dinoclaw:undoStomp', id),
  recordStompActivity: () => ipcRenderer.invoke('dinoclaw:recordStompActivity'),
  onStompEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data as Parameters<typeof callback>[0])
    ipcRenderer.on('dinoclaw:stomp', handler)
    return () => ipcRenderer.removeListener('dinoclaw:stomp', handler)
  },
  getLinkSetup: () => ipcRenderer.invoke('dinoclaw:getLinkSetup'),
}

contextBridge.exposeInMainWorld('dinoClaw', api)
