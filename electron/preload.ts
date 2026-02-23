import { contextBridge, ipcRenderer } from 'electron'

export interface FileAttachment {
  name: string
  type: string
  data: string // base64 encoded
  size: number
}

export interface AppSettings {
  hasApiKey: boolean
  hasHqCredentials: boolean
  hqUsername: string
  hqServer: string
  hqDomain: string
  model: string
}

export interface HqAppSummary {
  app_id: string
  name: string
}

export interface HqAppListResult {
  apps: HqAppSummary[]
  totalCount: number
}

export interface HqFetchResult {
  appName: string
  appId: string
  markdownSummary: string
  hqJson: Record<string, any>
}

// Internal store type (API key stored separately via safeStorage)
export interface StoreSettings {
  hqServer: string
  hqDomain: string
  model: string
  cliJarVersion: string
}

export interface GenerationProgress {
  status: 'generating' | 'validating' | 'fixing' | 'success' | 'failed'
  message: string
  attempt: number
  filesDetected?: string[]
}

export interface GenerationResult {
  success: boolean
  cczPath?: string
  exportPath?: string
  hqJsonPath?: string
  errors?: string[]
}

export interface HqImportResult {
  importUrl: string
  fakeAppUrl: string
  filePath: string
  instructions: string
}

export interface CczParseResult {
  appName: string
  markdownSummary: string
  files: Record<string, string>
  filePath: string
}

export type ElectronAPI = {
  sendMessage: (message: string, attachments?: FileAttachment[]) => Promise<string>
  streamMessage: (message: string, attachments?: FileAttachment[]) => Promise<string>
  getApiKey: () => Promise<{ hasKey: boolean; maskedKey: string | null }>
  setApiKey: (key: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  setSettings: (settings: Partial<AppSettings>) => Promise<void>
  onStreamChunk: (callback: (chunk: string) => void) => () => void
  generateApp: (appName?: string) => Promise<GenerationResult>
  onGenerationProgress: (callback: (progress: GenerationProgress) => void) => () => void
  downloadCcz: (sourcePath: string) => Promise<string | null>
  openFileLocation: (path: string) => Promise<void>
  initiateHqImport: (cczPath: string) => Promise<HqImportResult>
  uploadAndValidate: () => Promise<GenerationResult | null>
  uploadAndParse: () => Promise<CczParseResult | null>
  validateUploaded: (filePath: string) => Promise<GenerationResult>
  injectChatContext: (userMessage: string, assistantMessage: string) => Promise<void>
  // HQ API
  setHqCredentials: (username: string, apiKey: string) => Promise<void>
  listHqApps: () => Promise<HqAppListResult>
  fetchHqApp: (appId: string) => Promise<HqFetchResult>
  // Auto-update
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateAvailable: (callback: (version: string) => void) => () => void
  onUpdateDownloadProgress: (callback: (percent: number) => void) => () => void
  onUpdateDownloaded: (callback: () => void) => () => void
  // Conversation persistence
  saveConversations: (data: { conversations: any[]; activeId: string }) => Promise<void>
  loadConversations: () => Promise<{ conversations: any[]; activeId: string } | null>
  switchBackendConversation: (backendHistory: any[]) => Promise<void>
  getBackendHistory: () => Promise<any[]>
  resetChat: () => Promise<void>
}

const api: ElectronAPI = {
  sendMessage: (message: string, attachments?: FileAttachment[]) => {
    return ipcRenderer.invoke('chat:send-message', message, attachments)
  },
  streamMessage: (message: string, attachments?: FileAttachment[]) => {
    return ipcRenderer.invoke('chat:stream-message', message, attachments)
  },
  getApiKey: () => {
    return ipcRenderer.invoke('settings:get-api-key')
  },
  setApiKey: (key: string) => {
    return ipcRenderer.invoke('settings:set-api-key', key)
  },
  getSettings: () => {
    return ipcRenderer.invoke('settings:get')
  },
  setSettings: (settings: Partial<AppSettings>) => {
    return ipcRenderer.invoke('settings:set', settings)
  },
  onStreamChunk: (callback: (chunk: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
    ipcRenderer.on('chat:stream-chunk', handler)
    return () => ipcRenderer.removeListener('chat:stream-chunk', handler)
  },
  generateApp: (appName?: string) => {
    return ipcRenderer.invoke('app:generate', appName)
  },
  onGenerationProgress: (callback: (progress: GenerationProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: GenerationProgress) => callback(progress)
    ipcRenderer.on('app:generation-progress', handler)
    return () => ipcRenderer.removeListener('app:generation-progress', handler)
  },
  downloadCcz: (sourcePath: string) => {
    return ipcRenderer.invoke('app:download-ccz', sourcePath)
  },
  downloadJson: (sourcePath: string) => {
    return ipcRenderer.invoke('app:download-json', sourcePath)
  },
  openFileLocation: (path: string) => {
    return ipcRenderer.invoke('app:open-file-location', path)
  },
  initiateHqImport: (cczPath: string) => {
    return ipcRenderer.invoke('hq:initiate-import', cczPath)
  },
  uploadAndValidate: () => {
    return ipcRenderer.invoke('app:upload-and-validate')
  },
  uploadAndParse: () => {
    return ipcRenderer.invoke('app:upload-and-parse')
  },
  validateUploaded: (filePath: string) => {
    return ipcRenderer.invoke('app:validate-uploaded', filePath)
  },
  injectChatContext: (userMessage: string, assistantMessage: string) => {
    return ipcRenderer.invoke('chat:inject-context', userMessage, assistantMessage)
  },
  // HQ API
  setHqCredentials: (username: string, apiKey: string) => {
    return ipcRenderer.invoke('hq:set-credentials', username, apiKey)
  },
  listHqApps: () => {
    return ipcRenderer.invoke('hq:list-apps')
  },
  fetchHqApp: (appId: string) => {
    return ipcRenderer.invoke('hq:fetch-app', appId)
  },
  // Auto-update
  downloadUpdate: () => {
    return ipcRenderer.invoke('update:download')
  },
  installUpdate: () => {
    return ipcRenderer.invoke('update:install')
  },
  onUpdateAvailable: (callback: (version: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, version: string) => callback(version)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateDownloadProgress: (callback: (percent: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent)
    ipcRenderer.on('update:download-progress', handler)
    return () => ipcRenderer.removeListener('update:download-progress', handler)
  },
  onUpdateDownloaded: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('update:downloaded', handler)
    return () => ipcRenderer.removeListener('update:downloaded', handler)
  },
  onUpdateError: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('update:error', handler)
    return () => ipcRenderer.removeListener('update:error', handler)
  },
  // Conversation persistence
  saveConversations: (data: { conversations: any[]; activeId: string }) => {
    return ipcRenderer.invoke('conversations:save', data)
  },
  loadConversations: () => {
    return ipcRenderer.invoke('conversations:load')
  },
  switchBackendConversation: (backendHistory: any[]) => {
    return ipcRenderer.invoke('conversations:switch-backend', backendHistory)
  },
  getBackendHistory: () => {
    return ipcRenderer.invoke('conversations:get-backend-history')
  },
  resetChat: () => {
    return ipcRenderer.invoke('chat:reset')
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
