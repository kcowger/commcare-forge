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

export interface ElectronAPI {
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
  downloadJson: (sourcePath: string) => Promise<string | null>
  openFileLocation: (path: string) => Promise<void>
  initiateHqImport: (cczPath: string) => Promise<HqImportResult>
  uploadAndValidate: () => Promise<GenerationResult | null>
  uploadAndParse: () => Promise<CczParseResult | null>
  validateUploaded: (filePath: string) => Promise<GenerationResult>
  injectChatContext: (userMessage: string, assistantMessage: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
