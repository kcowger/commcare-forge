import { IpcMain, BrowserWindow, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { ClaudeService } from '@backend/services/claude'
import { AppGenerator } from '@backend/services/appGenerator'
import { CliValidator } from '@backend/services/cliValidator'
import { AppExporter } from '@backend/services/appExporter'
import { HqImportService } from '@backend/services/hqImport'
import { HqValidator } from '@backend/services/hqValidator'
import { CczParser } from '@backend/services/cczParser'
import { AutoFixer } from '@backend/services/autoFixer'
import { CczBuilder } from '@backend/services/cczBuilder'
import type { FileAttachment, AppSettings } from './preload'
import Store from 'electron-store'
import fs from 'fs'
import path from 'path'

const store = new Store<AppSettings>({
  defaults: {
    apiKey: null,
    hqServer: 'www.commcarehq.org',
    hqDomain: ''
  },
  encryptionKey: 'commcare-forge-encryption-key'
})

let claudeService: ClaudeService | null = null

function getClaudeService(): ClaudeService {
  if (!claudeService) {
    const apiKey = store.get('apiKey')
    if (!apiKey) {
      throw new Error('API key not configured. Please set your Anthropic API key in Settings.')
    }
    claudeService = new ClaudeService(apiKey)
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
      throw new Error(error.message || 'Failed to send message')
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
      throw new Error(error.message || 'Failed to stream message')
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
      throw new Error(error.message || 'Failed to generate app')
    }
  })

  ipcMain.handle('app:download-ccz', async (event, sourcePath: string) => {
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
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('hq:initiate-import', async (_event, jsonPath: string) => {
    const hqServer = store.get('hqServer') || 'www.commcarehq.org'
    const hqDomain = store.get('hqDomain')

    if (!hqDomain) {
      throw new Error('Please set your CommCare HQ project space domain in Settings first.')
    }

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
    return store.get('apiKey') || null
  })

  ipcMain.handle('settings:set-api-key', async (_event, key: string) => {
    store.set('apiKey', key)
    claudeService = null
  })

  ipcMain.handle('settings:get', async () => {
    return {
      apiKey: store.get('apiKey') || null,
      hqServer: store.get('hqServer'),
      hqDomain: store.get('hqDomain')
    }
  })

  ipcMain.handle('settings:set', async (_event, settings: Partial<AppSettings>) => {
    if (settings.apiKey !== undefined) {
      store.set('apiKey', settings.apiKey)
      claudeService = null
    }
    if (settings.hqServer !== undefined) store.set('hqServer', settings.hqServer)
    if (settings.hqDomain !== undefined) store.set('hqDomain', settings.hqDomain)
  })

  // Auto-update handlers
  ipcMain.handle('update:download', async () => {
    await autoUpdater.downloadUpdate()
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })
}
