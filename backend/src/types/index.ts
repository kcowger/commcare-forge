export interface FileAttachment {
  name: string
  type: string
  data: string // base64 encoded
  size: number
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: FileAttachment[]
  timestamp: number
}

export interface AppDefinition {
  name: string
  files: Record<string, string> // filepath -> content
}

export interface ValidationResult {
  success: boolean
  errors: string[]
  stdout: string
  stderr: string
}

export interface GenerationProgress {
  status: 'generating' | 'validating' | 'fixing' | 'success' | 'failed'
  message: string
  attempt: number
  maxAttempts: number
}

export interface AppSettings {
  apiKey: string | null
  hqServer: string
  hqDomain: string
  maxValidationRetries: number
}
