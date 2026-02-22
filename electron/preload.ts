import { contextBridge, ipcRenderer } from 'electron'

export interface FileAttachment {
  name: string
  type: string
  data: string // base64 encoded
  size: number
}

export interface AppSettings {
  apiKey: string | null
  hqServer: string
  hqDomain: string
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
  getApiKey: () => Promise<string | null>
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
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
