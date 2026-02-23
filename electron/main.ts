import { app, BrowserWindow, ipcMain, session } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
import { registerIpcHandlers } from './ipc-handlers'

// Diagnostic log file for debugging packaged builds
const LOG_PATH = join(app.getPath('userData'), 'debug.log')
function debugLog(msg: string) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* ignore */ }
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'CommCare Forge',
    icon: app.isPackaged
      ? join(process.resourcesPath, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
      : join(__dirname, '../../build/resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    backgroundColor: '#0a0a0a'
  })

  debugLog('Registering IPC handlers...')
  try {
    registerIpcHandlers(ipcMain)
    debugLog('IPC handlers registered successfully')
  } catch (err: any) {
    debugLog(`IPC handler registration FAILED: ${err.message}\n${err.stack}`)
  }

  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    const url = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
    mainWindow.loadURL(url)
  } else {
    const htmlPath = join(__dirname, '../renderer/index.html')
    debugLog(`Loading renderer from: ${htmlPath}`)
    mainWindow.loadFile(htmlPath)
    // Disable DevTools in production to prevent data inspection
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools()
    })
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    debugLog(`Renderer FAILED to load: ${code} ${desc}`)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    debugLog('Renderer loaded successfully')
  })

  // Capture renderer errors for debugging
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    // Only log errors (level 3 = error) to avoid filling the debug log
    if (level >= 3) {
      debugLog(`[RENDERER ERROR] line=${line} src=${sourceId} msg=${message}`)
    }
  })
  mainWindow.webContents.on('preload-error' as any, (_e: any, preloadPath: string, error: Error) => {
    debugLog(`[PRELOAD ERROR] path=${preloadPath} error=${error.message}`)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function setupAutoUpdater() {
  // Don't check for updates in dev mode
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', info.version)
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:download-progress', Math.round(progress.percent))
    }
  })

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded')
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:error', err.message)
    }
  })

  // Check for updates after a short delay so the window is ready
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Update check failed:', err.message)
    })
  }, 3000)

  // Re-check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)
}

app.whenReady().then(() => {
  // Content Security Policy — only for HTTPS responses (file:// doesn't use HTTP headers)
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src https://api.anthropic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"
          ]
        }
      })
    }
  )

  createWindow()
  setupAutoUpdater()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
