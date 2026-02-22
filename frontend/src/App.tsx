import React, { useState, useEffect, useCallback } from 'react'
import Header from './components/Header'
import ChatInterface from './components/ChatInterface'
import SettingsModal from './components/SettingsModal'
import ProgressTracker from './components/ProgressTracker'
import ArchitecturePanel from './components/ArchitecturePanel'
import AppNameModal from './components/AppNameModal'
import { useChat } from './hooks/useChat'
import type { GenerationProgress, GenerationResult, HqImportResult } from './types'

type PanelMode = 'chat' | 'uploaded'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [needsApiKey, setNeedsApiKey] = useState(false)
  const { messages, isLoading, sendMessage, clearMessages, architectureSpec, isSpecStreaming, injectMessages, setSpec } = useChat()

  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null)
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null)
  const [hqImportResult, setHqImportResult] = useState<HqImportResult | null>(null)

  // Upload-first flow state
  const [panelMode, setPanelMode] = useState<PanelMode>('chat')
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null)
  const [uploadedAppName, setUploadedAppName] = useState<string | null>(null)

  // App name modal state
  const [nameModalOpen, setNameModalOpen] = useState(false)
  const [pendingAppName, setPendingAppName] = useState('CommCare App')

  // Auto-update state
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateDownloadPercent, setUpdateDownloadPercent] = useState(0)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getApiKey().then(key => {
        if (!key) {
          setNeedsApiKey(true)
          setSettingsOpen(true)
        }
      })
    }
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return
    const cleanup = window.electronAPI.onGenerationProgress((progress) => {
      setGenerationProgress(progress)
    })
    return cleanup
  }, [])

  // Auto-update listeners
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanups = [
      window.electronAPI.onUpdateAvailable((version) => {
        setUpdateAvailable(version)
      }),
      window.electronAPI.onUpdateDownloadProgress((percent) => {
        setUpdateDownloadPercent(percent)
      }),
      window.electronAPI.onUpdateDownloaded(() => {
        setUpdateDownloading(false)
        setUpdateReady(true)
      })
    ]
    return () => cleanups.forEach(fn => fn())
  }, [])

  // Mode transition: when Claude starts streaming a new spec while in uploaded mode, switch to chat mode
  useEffect(() => {
    if (panelMode === 'uploaded' && isSpecStreaming) {
      setPanelMode('chat')
    }
  }, [isSpecStreaming, panelMode])

  // --- Upload-first flow handlers ---

  const handleUploadExisting = useCallback(async () => {
    if (!window.electronAPI) return

    const result = await window.electronAPI.uploadAndParse()
    if (!result) return // user cancelled

    // Store uploaded state
    setUploadedFilePath(result.filePath)
    setUploadedAppName(result.appName)
    setPanelMode('uploaded')

    // Clear any previous generation state
    setGenerationProgress(null)
    setGenerationResult(null)
    setHqImportResult(null)

    // Show parsed structure in architecture panel
    setSpec(result.markdownSummary)

    // Inject synthetic messages into chat
    const userMsg = `I uploaded an existing CommCare app: "${result.appName}"`
    const assistantMsg = `I've parsed your uploaded app **"${result.appName}"**. The structure is shown in the panel on the right.\n\nYou can:\n- Click **Validate App** to run it through the CommCare validator\n- Tell me about any modifications you'd like to make`

    injectMessages(userMsg, assistantMsg)

    // Also inject into Claude's conversation history (backend)
    await window.electronAPI.injectChatContext(
      `The user uploaded an existing CommCare app (.ccz file). Here is the full file listing:\n\n${
        Object.entries(result.files)
          .map(([path, content]) => `--- ${path} ---\n${content}`)
          .join('\n\n')
      }`,
      `I've analyzed the uploaded app "${result.appName}". It contains ${
        Object.keys(result.files).length
      } files. I'm ready to help with any modifications.`
    )
  }, [injectMessages, setSpec])

  const handleValidateUploaded = useCallback(async () => {
    if (!window.electronAPI || !uploadedFilePath || isGenerating) return

    setIsGenerating(true)
    setGenerationProgress({ status: 'validating', message: 'Validating uploaded app...', attempt: 1 })
    setGenerationResult(null)

    try {
      const result = await window.electronAPI.validateUploaded(uploadedFilePath)
      setGenerationResult(result)
    } catch (error: any) {
      setGenerationProgress({ status: 'failed', message: error.message || 'Validation failed', attempt: 1 })
      setGenerationResult({ success: false, errors: [error.message] })
    } finally {
      setIsGenerating(false)
    }
  }, [uploadedFilePath, isGenerating])

  // --- Build flow with name modal ---

  const handleBuildRequest = useCallback(() => {
    let defaultName = uploadedAppName || 'CommCare App'
    // If no uploaded name, try to infer from first user message
    if (!uploadedAppName && messages.length > 0) {
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg) {
        let desc = firstUserMsg.content.trim()
        desc = desc.replace(
          /^(I need|I want|Create|Build|Make|Generate|Design|Develop|Help me build|Help me create|Can you build|Can you create|Please create|Please build)\s+(a|an|the|me a|me an)?\s*/i,
          ''
        )
        const words = desc.split(/\s+/).slice(0, 5).join(' ')
        if (words.length > 3) {
          defaultName = words.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'CommCare App'
        }
      }
    }
    setPendingAppName(defaultName)
    setNameModalOpen(true)
  }, [uploadedAppName, messages])

  const handleNameConfirmed = useCallback(async (chosenName: string) => {
    setNameModalOpen(false)

    if (!window.electronAPI || isGenerating) return

    setIsGenerating(true)
    setGenerationProgress({ status: 'generating', message: 'Starting generation...', attempt: 0 })
    setGenerationResult(null)

    try {
      const result = await window.electronAPI.generateApp(chosenName)
      setGenerationResult(result)
    } catch (error: any) {
      setGenerationProgress({ status: 'failed', message: error.message || 'Generation failed', attempt: 0 })
      setGenerationResult({ success: false, errors: [error.message] })
    } finally {
      setIsGenerating(false)
    }
  }, [isGenerating])

  // --- Existing handlers ---

  const handleDownloadCcz = useCallback(async () => {
    if (!window.electronAPI || !generationResult?.cczPath) return
    try {
      await window.electronAPI.downloadCcz(generationResult.cczPath)
    } catch (error: any) {
      console.error('Download failed:', error)
    }
  }, [generationResult])

  const handleDownloadJson = useCallback(async () => {
    if (!window.electronAPI || !generationResult?.hqJsonPath) return
    try {
      await window.electronAPI.downloadJson(generationResult.hqJsonPath)
    } catch (error: any) {
      console.error('Download failed:', error)
    }
  }, [generationResult])

  const handleOpenFileLocation = useCallback(async () => {
    if (!window.electronAPI || !generationResult?.cczPath) return
    await window.electronAPI.openFileLocation(generationResult.cczPath)
  }, [generationResult])

  const handleUploadApp = useCallback(async () => {
    if (!window.electronAPI || isGenerating) return

    setIsGenerating(true)
    setGenerationProgress({ status: 'validating', message: 'Opening file...', attempt: 0 })
    setGenerationResult(null)
    setHqImportResult(null)

    try {
      const result = await window.electronAPI.uploadAndValidate()
      if (result === null) {
        // User cancelled the file dialog
        setGenerationProgress(null)
      } else {
        setGenerationResult(result)
      }
    } catch (error: any) {
      setGenerationProgress({ status: 'failed', message: error.message || 'Upload failed', attempt: 0 })
      setGenerationResult({ success: false, errors: [error.message] })
    } finally {
      setIsGenerating(false)
    }
  }, [isGenerating])

  const handleImportToHq = useCallback(async () => {
    const importPath = generationResult?.hqJsonPath || generationResult?.cczPath
    if (!window.electronAPI || !importPath) return
    try {
      const result = await window.electronAPI.initiateHqImport(importPath)
      setHqImportResult(result)
    } catch (error: any) {
      alert(error.message || 'Failed to initiate HQ import')
    }
  }, [generationResult])

  const canGenerate = messages.length >= 2 && !isLoading && !isGenerating
  const hasPanel = !!architectureSpec

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-white">
      {/* Auto-update banner */}
      {updateAvailable && !updateDismissed && (
        <div className="flex items-center justify-between px-4 py-2 bg-accent/10 border-b border-accent/20 text-sm">
          <div className="flex items-center gap-3">
            {updateReady ? (
              <>
                <span className="text-white/80">Update ready — restart to install v{updateAvailable}</span>
                <button
                  onClick={() => window.electronAPI?.installUpdate()}
                  className="px-3 py-1 rounded-md bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors"
                >
                  Restart now
                </button>
              </>
            ) : updateDownloading ? (
              <>
                <span className="text-white/60">Downloading update... {updateDownloadPercent}%</span>
                <div className="w-32 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${updateDownloadPercent}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <span className="text-white/80">A new version (v{updateAvailable}) is available</span>
                <button
                  onClick={() => {
                    setUpdateDownloading(true)
                    window.electronAPI?.downloadUpdate()
                  }}
                  className="px-3 py-1 rounded-md bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors"
                >
                  Download
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => setUpdateDismissed(true)}
            className="text-white/40 hover:text-white/70 transition-colors ml-4"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      <Header
        onOpenSettings={() => setSettingsOpen(true)}
        onNewChat={() => {
          clearMessages()
          setGenerationProgress(null)
          setGenerationResult(null)
          setIsGenerating(false)
          setHqImportResult(null)
          setPanelMode('chat')
          setUploadedFilePath(null)
          setUploadedAppName(null)
          setNameModalOpen(false)
        }}
        showNewChat={messages.length > 0}
      />
      <main className="flex-1 overflow-hidden flex flex-row">
        {/* Left column: chat */}
        <div className={`flex flex-col overflow-hidden transition-all duration-300 ${
          hasPanel ? 'w-[60%]' : 'w-full'
        }`}>
          <div className="flex-1 overflow-hidden">
            <ChatInterface
              messages={messages}
              isLoading={isLoading}
              onSendMessage={sendMessage}
              onUploadExisting={handleUploadExisting}
            />
          </div>

          {/* Generation controls - pinned above chat input */}
          {(isGenerating || generationResult) && (
            <div className="border-t border-white/10 bg-[#0a0a0a] px-6 py-3">
              <div className="max-w-3xl mx-auto space-y-3">
                {/* Progress tracker */}
                {generationProgress && (isGenerating || generationProgress.status === 'success' || generationProgress.status === 'failed') && (
                  <ProgressTracker {...generationProgress} />
                )}

                {/* Result: success */}
                {generationResult?.success && (generationResult.cczPath || generationResult.hqJsonPath) && (
                  <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 space-y-3">
                    <p className="text-sm text-white/70">
                      App generated successfully!
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {generationResult.cczPath && (
                        <button
                          onClick={handleDownloadCcz}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Download .ccz
                        </button>
                      )}
                      {generationResult.hqJsonPath && (
                        <button
                          onClick={handleDownloadJson}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Download .json
                        </button>
                      )}
                      {generationResult.cczPath && (
                        <button
                          onClick={handleOpenFileLocation}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                          </svg>
                          Open in Explorer
                        </button>
                      )}
                      {(generationResult.hqJsonPath || generationResult.cczPath) && (
                        <button
                          onClick={handleImportToHq}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          Import to HQ
                        </button>
                      )}
                    </div>
                    {/* HQ import instructions */}
                    {hqImportResult && (
                      <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-xs text-white/60 whitespace-pre-wrap leading-relaxed">
                        {hqImportResult.instructions}
                      </div>
                    )}
                  </div>
                )}

                {/* Result: failure with errors */}
                {generationResult && !generationResult.success && generationResult.errors && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                    <p className="text-sm text-red-400 font-medium mb-1">
                      Generation failed after {generationResult.errors.length > 0 ? 'validation' : 'build'}:
                    </p>
                    <div className="text-xs text-white/60 space-y-1 mt-2 max-h-40 overflow-y-auto">
                      {generationResult.errors.map((err, i) => (
                        <pre key={i} className="whitespace-pre-wrap break-words font-mono leading-relaxed">{err}</pre>
                      ))}
                    </div>
                    {generationResult.cczPath && (
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-white/5">
                        <p className="text-xs text-white/40">
                          Partial app saved — you can still download it:
                        </p>
                        <button
                          onClick={handleDownloadCcz}
                          className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 transition-colors"
                        >
                          Download .ccz
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right column: architecture panel */}
        {hasPanel && (
          <ArchitecturePanel
            content={architectureSpec}
            isStreaming={isSpecStreaming}
            canBuild={
              panelMode === 'uploaded'
                ? !isGenerating && !generationResult?.success
                : canGenerate && !generationResult?.success
            }
            onBuild={handleBuildRequest}
            mode={panelMode}
            onValidate={handleValidateUploaded}
            isValidating={isGenerating}
          />
        )}
      </main>
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          if (needsApiKey && window.electronAPI) {
            window.electronAPI.getApiKey().then(key => {
              if (key) setNeedsApiKey(false)
            })
          }
        }}
      />
      <AppNameModal
        isOpen={nameModalOpen}
        defaultName={pendingAppName}
        onConfirm={handleNameConfirmed}
        onCancel={() => setNameModalOpen(false)}
      />
    </div>
  )
}
