import { IpcMain, BrowserWindow, dialog, shell, app, safeStorage } from 'electron'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
import { ClaudeService } from '@backend/services/claude'
import { AppGenerator } from '@backend/services/appGenerator'
import { CliValidator } from '@backend/services/cliValidator'
import { AppExporter } from '@backend/services/appExporter'
import { HqImportService } from '@backend/services/hqImport'
import { HqValidator } from '@backend/services/hqValidator'
import { CczParser } from '@backend/services/cczParser'
import { AutoFixer } from '@backend/services/autoFixer'
import { CczBuilder } from '@backend/services/cczBuilder'
import type { FileAttachment, StoreSettings } from './preload'
import Store from 'electron-store'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Non-sensitive settings — no encryption needed
// Wrap in try/catch to handle migration from old encrypted store
const STORE_DEFAULTS: StoreSettings = {
  hqServer: 'www.commcarehq.org',
  hqDomain: '',
  model: 'claude-sonnet-4-5-20250929'
}

let store: Store<StoreSettings>
try {
  store = new Store<StoreSettings>({ defaults: STORE_DEFAULTS })
  // Force a read to trigger deserialization errors early
  store.get('hqServer')
} catch {
  // Old store was encrypted with a hardcoded key — overwrite with valid JSON and retry
  const storePath = path.join(app.getPath('userData'), 'config.json')
  try { fs.writeFileSync(storePath, '{}', 'utf-8') } catch { /* ignore */ }
  try { fs.unlinkSync(storePath) } catch { /* ignore */ }
  store = new Store<StoreSettings>({ defaults: STORE_DEFAULTS })
}

// Secure API key storage using OS-level encryption (DPAPI/Keychain/libsecret)
const API_KEY_FILE = path.join(app.getPath('userData'), '.api-key')

function getSecureApiKey(): string | null {
  try {
    if (!fs.existsSync(API_KEY_FILE)) return null
    const encrypted = fs.readFileSync(API_KEY_FILE)
    if (encrypted.length === 0) return null
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

function setSecureApiKey(key: string): void {
  const encrypted = safeStorage.encryptString(key)
  fs.writeFileSync(API_KEY_FILE, encrypted)
}

function getMaskedApiKey(): string | null {
  const key = getSecureApiKey()
  if (!key) return null
  if (key.length <= 8) return '••••••••'
  return key.substring(0, 7) + '...' + key.substring(key.length - 4)
}

// Sanitize error messages to prevent API key leakage
function sanitizeError(message: string): string {
  return message.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
}

// Validate file paths to prevent directory traversal
const ALLOWED_DIRS: string[] = []
function getAllowedDirs(): string[] {
  if (ALLOWED_DIRS.length === 0) {
    ALLOWED_DIRS.push(
      path.resolve(os.tmpdir()),
      path.resolve(app.getPath('userData')),
      path.resolve(app.getPath('home'))
    )
  }
  return ALLOWED_DIRS
}

function validateFilePath(filePath: string): void {
  let resolved: string
  try {
    // Resolve symlinks to prevent symlink-based path traversal
    resolved = fs.realpathSync(filePath)
  } catch {
    // File doesn't exist yet (e.g. write target) — use resolve instead
    resolved = path.resolve(filePath)
  }
  const allowed = getAllowedDirs()
  const isAllowed = allowed.some(dir => resolved.startsWith(dir))
  if (!isAllowed) {
    throw new Error('Access to this file path is not permitted')
  }
}

// Validate HQ server domain
function validateHqServer(server: string): void {
  if (!/^[a-zA-Z0-9.-]+$/.test(server)) {
    throw new Error('Invalid HQ server: only alphanumeric characters, dots, and hyphens allowed')
  }
  if (!server.endsWith('commcarehq.org')) {
    throw new Error('Invalid HQ server: must be a commcarehq.org domain')
  }
}

// Validate HQ domain (project space name)
function validateHqDomain(domain: string): void {
  if (domain && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(domain)) {
    throw new Error('Invalid project space domain: only alphanumeric characters, hyphens, and underscores allowed')
  }
}

// Whitelist of allowed Claude models
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001'
])

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

function checkFileSize(filePath: string): void {
  const stat = fs.statSync(filePath)
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 100MB)')
  }
}

let claudeService: ClaudeService | null = null
let pendingHistory: Array<{ role: string; content: any }> | null = null

function getConversationsFilePath(): string {
  return path.join(app.getPath('userData'), 'conversations.json')
}

function stripBase64FromBackendHistory(
  history: Array<{ role: string; content: any }>
): Array<{ role: string; content: any }> {
  return history.map(msg => {
    if (typeof msg.content === 'string') return msg
    if (!Array.isArray(msg.content)) return msg
    return {
      ...msg,
      content: msg.content.map((block: any) => {
        if (block.type === 'image' && block.source?.type === 'base64') {
          return { type: 'text', text: '[Previously uploaded image]' }
        }
        if (block.type === 'document' && block.source?.type === 'base64') {
          return { type: 'text', text: '[Previously uploaded PDF document]' }
        }
        return block
      })
    }
  })
}

function stripBase64FromFrontendMessages(messages: any[]): any[] {
  return messages.map(msg => ({
    ...msg,
    attachments: msg.attachments?.map((att: any) => ({
      name: att.name,
      type: att.type,
      size: att.size,
      data: ''
    }))
  }))
}

function getClaudeService(): ClaudeService {
  if (!claudeService) {
    const apiKey = getSecureApiKey()
    if (!apiKey) {
      throw new Error('API key not configured. Please set your Anthropic API key in Settings.')
    }
    claudeService = new ClaudeService(apiKey, store.get('model'))
    if (pendingHistory) {
      claudeService.setHistory(pendingHistory as Array<{ role: 'user' | 'assistant'; content: any }>)
      pendingHistory = null
    }
  }
  return claudeService
}

export function registerIpcHandlers(ipcMain: IpcMain) {
  ipcMain.handle('chat:send-message', async (_event, message: string, attachments?: FileAttachment[]) => {
    try {
      const service = getClaudeService()
      const response = await service.sendMessage(message, attachments)
      return response
    } catch (error: any) {
      throw new Error(sanitizeError(error.message || 'Failed to send message'))
    }
  })

  ipcMain.handle('chat:stream-message', async (event, message: string, attachments?: FileAttachment[]) => {
    try {
      const service = getClaudeService()
      const window = BrowserWindow.fromWebContents(event.sender)
      let fullResponse = ''

      await service.streamMessage(message, attachments, (chunk: string) => {
        fullResponse += chunk
        if (window && !window.isDestroyed()) {
          window.webContents.send('chat:stream-chunk', chunk)
        }
      })

      return fullResponse
    } catch (error: any) {
      throw new Error(sanitizeError(error.message || 'Failed to stream message'))
    }
  })

  ipcMain.handle('app:generate', async (event, appName?: string) => {
    try {
      const service = getClaudeService()
      const window = BrowserWindow.fromWebContents(event.sender)

      const generator = new AppGenerator(service)
      const conversationContext = service.getConversationSummary()

      const result = await generator.generate(conversationContext, (progress) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('app:generation-progress', progress)
        }
      }, appName)

      return {
        success: result.success,
        cczPath: result.cczPath,
        exportPath: result.exportPath,
        hqJsonPath: result.hqJsonPath,
        errors: result.errors
      }
    } catch (error: any) {
      throw new Error(sanitizeError(error.message || 'Failed to generate app'))
    }
  })

  ipcMain.handle('app:download-ccz', async (event, sourcePath: string) => {
    validateFilePath(sourcePath)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found')

    const defaultName = path.basename(sourcePath)
    const result = await dialog.showSaveDialog(window, {
      title: 'Save .ccz file',
      defaultPath: defaultName,
      filters: [{ name: 'CommCare App', extensions: ['ccz'] }]
    })

    if (result.canceled || !result.filePath) return null
    fs.copyFileSync(sourcePath, result.filePath)
    return result.filePath
  })

  ipcMain.handle('app:download-json', async (event, sourcePath: string) => {
    validateFilePath(sourcePath)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found')

    const defaultName = path.basename(sourcePath)
    const result = await dialog.showSaveDialog(window, {
      title: 'Save HQ JSON file',
      defaultPath: defaultName,
      filters: [{ name: 'CommCare HQ JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) return null
    fs.copyFileSync(sourcePath, result.filePath)
    return result.filePath
  })

  ipcMain.handle('app:open-file-location', async (_event, filePath: string) => {
    validateFilePath(filePath)
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('hq:initiate-import', async (_event, jsonPath: string) => {
    validateFilePath(jsonPath)
    const hqServer = store.get('hqServer') || 'www.commcarehq.org'
    const hqDomain = store.get('hqDomain')

    if (!hqDomain) {
      throw new Error('Please set your CommCare HQ project space domain in Settings first.')
    }

    validateHqServer(hqServer)
    validateHqDomain(hqDomain)

    const hqImport = new HqImportService()
    return await hqImport.initiateImport(hqServer, hqDomain, jsonPath)
  })

  ipcMain.handle('app:upload-and-parse', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found')

    const result = await dialog.showOpenDialog(window, {
      title: 'Upload Existing CommCare App',
      filters: [{ name: 'CommCare Apps', extensions: ['ccz'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    checkFileSize(result.filePaths[0])
    const parser = new CczParser()
    const parsed = parser.parse(result.filePaths[0])

    return {
      appName: parsed.appName,
      markdownSummary: parsed.markdownSummary,
      files: parsed.files,
      filePath: parsed.filePath
    }
  })

  ipcMain.handle('app:validate-uploaded', async (event, filePath: string) => {
    validateFilePath(filePath)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found')

    const baseName = path.basename(filePath, path.extname(filePath))

    const sendProgress = (progress: any) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('app:generation-progress', progress)
      }
    }

    sendProgress({ status: 'validating', message: `Validating ${path.basename(filePath)}...`, attempt: 1 })

    // Parse the CCZ to get files
    const parser = new CczParser()
    let parsed: ReturnType<CczParser['parse']>
    try {
      parsed = parser.parse(filePath)
    } catch (err: any) {
      sendProgress({ status: 'failed', message: `Failed to parse CCZ: ${err.message}`, attempt: 1 })
      return { success: false, errors: [err.message] }
    }

    // Auto-fix issues before validating
    const autoFixer = new AutoFixer()
    const { files: fixedFiles, fixes } = autoFixer.fix(parsed.files)

    // If auto-fixer made changes, rebuild the CCZ
    let validationPath = filePath
    if (fixes.length > 0) {
      sendProgress({ status: 'validating', message: `Auto-fixed ${fixes.length} issue(s), re-validating...`, attempt: 1 })
      const builder = new CczBuilder()
      validationPath = await builder.build(fixedFiles, baseName)
    }

    // Run CLI validation on the (possibly rebuilt) CCZ
    const validator = new CliValidator()
    const validation = await validator.validate(validationPath)

    // Run HQ validation on the (possibly fixed) files
    const hqValidator = new HqValidator()
    const hqResult = hqValidator.validate(fixedFiles)

    const combinedErrors = [
      ...(validation.success ? [] : validation.errors),
      ...hqResult.errors
    ]

    const exporter = new AppExporter()

    if (validation.skipped) {
      const exportPath = await exporter.exportCcz(validationPath, baseName)
      const msg = hqResult.success
        ? `App validated successfully${fixes.length > 0 ? ` (auto-fixed ${fixes.length} issue(s))` : ''}. CLI skipped — install Java 17+ to enable.`
        : `HQ issues found: ${hqResult.errors.join('; ').substring(0, 150)}`
      sendProgress({ status: hqResult.success ? 'success' : 'failed', message: msg, attempt: 1 })
      return { success: hqResult.success, cczPath: exportPath, exportPath, errors: combinedErrors }
    }

    if (validation.success && hqResult.success) {
      const exportPath = await exporter.exportCcz(validationPath, baseName)
      const msg = fixes.length > 0
        ? `Validation passed! Auto-fixed ${fixes.length} issue(s).`
        : 'Validation passed!'
      sendProgress({ status: 'success', message: msg, attempt: 1 })
      return { success: true, cczPath: exportPath, exportPath, errors: [] }
    }

    // Still failing after auto-fix — export what we have
    const exportPath = await exporter.exportCcz(validationPath, baseName)
    const errorSummary = combinedErrors.length > 0
      ? combinedErrors[0].substring(0, 200)
      : 'Unknown validation error'
    sendProgress({ status: 'failed', message: `Validation failed: ${errorSummary}`, attempt: 1 })
    return { success: false, cczPath: exportPath, exportPath, errors: combinedErrors }
  })

  ipcMain.handle('chat:inject-context', async (_event, userMessage: string, assistantMessage: string) => {
    const service = getClaudeService()
    service.injectContext(userMessage, assistantMessage)
  })

  ipcMain.handle('app:upload-and-validate', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found')

    const result = await dialog.showOpenDialog(window, {
      title: 'Upload CommCare App',
      filters: [
        { name: 'CommCare Apps', extensions: ['ccz', 'json'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    checkFileSize(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const baseName = path.basename(filePath, ext)

    const sendProgress = (progress: any) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('app:generation-progress', progress)
      }
    }

    if (ext === '.ccz') {
      sendProgress({ status: 'validating', message: `Validating ${path.basename(filePath)}...`, attempt: 1 })

      const validator = new CliValidator()
      const validation = await validator.validate(filePath)

      if (validation.skipped) {
        // Copy to exports even if validation skipped
        const exporter = new AppExporter()
        const exportPath = await exporter.exportCcz(filePath, baseName)
        sendProgress({ status: 'success', message: `App loaded (validation skipped: ${validation.skipReason})`, attempt: 1 })
        return { success: true, cczPath: exportPath, exportPath, errors: [] }
      }

      if (validation.success) {
        const exporter = new AppExporter()
        const exportPath = await exporter.exportCcz(filePath, baseName)
        sendProgress({ status: 'success', message: `Validation passed!\n${validation.stdout}`, attempt: 1 })
        return { success: true, cczPath: exportPath, exportPath, errors: [] }
      }

      // Validation failed — copy anyway so user can download
      const exporter = new AppExporter()
      const exportPath = await exporter.exportCcz(filePath, baseName)
      const errorSummary = validation.errors.length > 0
        ? validation.errors[0].substring(0, 200)
        : 'Unknown validation error'
      sendProgress({ status: 'failed', message: `Validation failed: ${errorSummary}`, attempt: 1 })
      return { success: false, cczPath: exportPath, exportPath, errors: validation.errors }

    } else if (ext === '.json') {
      sendProgress({ status: 'validating', message: `Loading ${path.basename(filePath)}...`, attempt: 1 })

      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(content)

        // Copy to exports
        const exporter = new AppExporter()
        const hqJsonPath = await exporter.exportForHQ(baseName, parsed)

        if (parsed.doc_type === 'Application') {
          sendProgress({ status: 'success', message: 'Valid HQ import JSON loaded.', attempt: 1 })
          return { success: true, hqJsonPath, errors: [] }
        } else {
          sendProgress({ status: 'success', message: 'JSON file loaded (not in HQ import format).', attempt: 1 })
          return { success: true, hqJsonPath, errors: [] }
        }
      } catch (err: any) {
        sendProgress({ status: 'failed', message: `Invalid JSON: ${err.message}`, attempt: 1 })
        return { success: false, errors: [`Invalid JSON: ${err.message}`] }
      }
    }

    throw new Error(`Unsupported file type: ${ext}`)
  })

  ipcMain.handle('settings:get-api-key', async () => {
    return { hasKey: !!getSecureApiKey(), maskedKey: getMaskedApiKey() }
  })

  ipcMain.handle('settings:set-api-key', async (_event, key: string) => {
    if (!key || typeof key !== 'string') throw new Error('Invalid API key')
    setSecureApiKey(key)
    claudeService = null
  })

  ipcMain.handle('settings:get', async () => {
    return {
      hasApiKey: !!getSecureApiKey(),
      hqServer: store.get('hqServer'),
      hqDomain: store.get('hqDomain'),
      model: store.get('model')
    }
  })

  ipcMain.handle('settings:set', async (_event, settings: Partial<StoreSettings & { apiKey?: string }>) => {
    if (settings.apiKey !== undefined) {
      setSecureApiKey(settings.apiKey)
      claudeService = null
    }
    if (settings.hqServer !== undefined) {
      validateHqServer(settings.hqServer)
      store.set('hqServer', settings.hqServer)
    }
    if (settings.hqDomain !== undefined) {
      validateHqDomain(settings.hqDomain)
      store.set('hqDomain', settings.hqDomain)
    }
    if (settings.model !== undefined) {
      if (!ALLOWED_MODELS.has(settings.model)) {
        throw new Error('Invalid model selected')
      }
      store.set('model', settings.model)
      claudeService = null
    }
  })

  // Auto-update handlers
  ipcMain.handle('update:download', async () => {
    await autoUpdater.downloadUpdate()
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Conversation persistence handlers
  ipcMain.handle('conversations:save', async (_event, data: { conversations: any[]; activeId: string }) => {
    try {
      const filePath = getConversationsFilePath()
      // Get current backend history for the active conversation
      const backendHistory = claudeService ? claudeService.getHistory() : []
      const stripped = {
        conversations: data.conversations.map((conv: any) => ({
          ...conv,
          messages: stripBase64FromFrontendMessages(conv.messages),
          backendHistory: conv.id === data.activeId
            ? stripBase64FromBackendHistory(backendHistory)
            : stripBase64FromBackendHistory(conv.backendHistory || [])
        })),
        activeId: data.activeId
      }
      fs.writeFileSync(filePath, JSON.stringify(stripped), 'utf-8')
    } catch (err) {
      console.error('Failed to save conversations:', err)
    }
  })

  ipcMain.handle('conversations:load', async () => {
    try {
      const filePath = getConversationsFilePath()
      if (!fs.existsSync(filePath)) return null
      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw)
      if (!data || !Array.isArray(data.conversations)) return null

      // Find active conversation and set its backend history as pending
      const active = data.conversations.find((c: any) => c.id === data.activeId)
      if (active?.backendHistory?.length > 0) {
        if (claudeService) {
          claudeService.setHistory(active.backendHistory)
        } else {
          pendingHistory = active.backendHistory
        }
      }

      return data
    } catch (err) {
      console.error('Failed to load conversations:', err)
      return null
    }
  })

  ipcMain.handle('conversations:switch-backend', async (_event, backendHistory: any[]) => {
    try {
      if (claudeService) {
        claudeService.setHistory(backendHistory || [])
      } else {
        pendingHistory = backendHistory || null
      }
    } catch (err) {
      console.error('Failed to switch backend conversation:', err)
    }
  })

  ipcMain.handle('conversations:get-backend-history', async () => {
    return claudeService ? claudeService.getHistory() : []
  })

  ipcMain.handle('chat:reset', async () => {
    if (claudeService) {
      claudeService.resetConversation()
    }
    pendingHistory = null
  })
}
