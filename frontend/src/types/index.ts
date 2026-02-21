export interface FileAttachment {
  name: string
  type: string
  data: string // base64 encoded
  size: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: FileAttachment[]
  timestamp: number
  isStreaming?: boolean
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

export interface ElectronAPI {
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

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
