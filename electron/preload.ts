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
  maxValidationRetries: number
}

export interface GenerationProgress {
  status: 'generating' | 'validating' | 'fixing' | 'success' | 'failed'
  message: string
  attempt: number
  maxAttempts: number
}

export interface GenerationResult {
  success: boolean
  cczPath?: string
  exportPath?: string
  errors?: string[]
}

export type ElectronAPI = {
  sendMessage: (message: string, attachments?: FileAttachment[]) => Promise<string>
  streamMessage: (message: string, attachments?: FileAttachment[]) => Promise<string>
  getApiKey: () => Promise<string | null>
  setApiKey: (key: string) => Promise<void>
  getSettings: () => Promise<AppSettings>
  setSettings: (settings: Partial<AppSettings>) => Promise<void>
  onStreamChunk: (callback: (chunk: string) => void) => () => void
  generateApp: () => Promise<GenerationResult>
  onGenerationProgress: (callback: (progress: GenerationProgress) => void) => () => void
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
  generateApp: () => {
    return ipcRenderer.invoke('app:generate')
  },
  onGenerationProgress: (callback: (progress: GenerationProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: GenerationProgress) => callback(progress)
    ipcRenderer.on('app:generation-progress', handler)
    return () => ipcRenderer.removeListener('app:generation-progress', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
