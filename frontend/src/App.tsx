import React, { useState, useEffect, useCallback, useRef } from 'react'
import Header from './components/Header'
import TabBar from './components/TabBar'
import ChatInterface from './components/ChatInterface'
import SettingsModal from './components/SettingsModal'
import ProgressTracker from './components/ProgressTracker'
import ArchitecturePanel from './components/ArchitecturePanel'
import AppNameModal from './components/AppNameModal'
import WelcomeScreen from './components/WelcomeScreen'
import { useChat } from './hooks/useChat'
import type { Conversation, GenerationProgress, GenerationResult, HqImportResult } from './types'

type PanelMode = 'chat' | 'uploaded'

function createEmptyConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: 'New Chat',
    messages: [],
    architectureSpec: null,
    panelMode: 'chat',
    uploadedFilePath: null,
    uploadedAppName: null,
    generationProgress: null,
    generationResult: null,
    hqImportResult: null,
    backendHistory: [],
    createdAt: Date.now()
  }
}

function deriveTitle(messages: Array<{ role: string; content: string }>): string {
  const first = messages.find(m => m.role === 'user')
  if (!first) return 'New Chat'
  const text = first.content.replace(/\s+/g, ' ').trim()
  return text.length > 28 ? text.substring(0, 28) + '...' : text || 'New Chat'
}

export default function App() {
  // API key gating: null = still checking, true = ready, false = needs key
  const [apiKeyReady, setApiKeyReady] = useState<boolean | null>(null)

  // Conversation tabs
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const conversationsRef = useRef<Conversation[]>([])
  const activeIdRef = useRef<string | null>(null)

  // Live chat state (active conversation)
  const { messages, isLoading, sendMessage, clearMessages, architectureSpec, isSpecStreaming, injectMessages, setSpec, restoreState } = useChat()

  // Live generation state (active conversation)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null)
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null)
  const [hqImportResult, setHqImportResult] = useState<HqImportResult | null>(null)

  // Live upload state (active conversation)
  const [panelMode, setPanelMode] = useState<PanelMode>('chat')
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null)
  const [uploadedAppName, setUploadedAppName] = useState<string | null>(null)

  // UI state (global)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [nameModalOpen, setNameModalOpen] = useState(false)
  const [pendingAppName, setPendingAppName] = useState('CommCare App')

  // Auto-update state (global)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [updateDownloading, setUpdateDownloading] = useState(false)
  const [updateDownloadPercent, setUpdateDownloadPercent] = useState(0)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  // Keep refs in sync
  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  useEffect(() => { activeIdRef.current = activeConversationId }, [activeConversationId])

  // --- Initialization ---

  useEffect(() => {
    if (!window.electronAPI) {
      // No preload — show welcome screen so user isn't stuck on blank
      setApiKeyReady(false)
      return
    }

    // Timeout: if IPC doesn't respond in 5s, show welcome screen
    const timeout = setTimeout(() => {
      if (apiKeyReady === null) setApiKeyReady(false)
    }, 5000)

    window.electronAPI.getApiKey().then(async (result) => {
      clearTimeout(timeout)
      if (!result.hasKey) {
        setApiKeyReady(false)
        return
      }
      setApiKeyReady(true)
      // Load saved conversations
      try {
        const saved = await window.electronAPI.loadConversations()
        if (saved && saved.conversations.length > 0) {
          setConversations(saved.conversations)
          const activeId = saved.activeId || saved.conversations[0].id
          setActiveConversationId(activeId)
          const active = saved.conversations.find(c => c.id === activeId) || saved.conversations[0]
          restoreState(active.messages, active.architectureSpec)
          setPanelMode((active.panelMode as PanelMode) || 'chat')
          setUploadedFilePath(active.uploadedFilePath)
          setUploadedAppName(active.uploadedAppName)
          setGenerationProgress(active.generationProgress)
          setGenerationResult(active.generationResult)
          setHqImportResult(active.hqImportResult)
        } else {
          const fresh = createEmptyConversation()
          setConversations([fresh])
          setActiveConversationId(fresh.id)
        }
      } catch {
        // Conversations failed to load — start fresh
        const fresh = createEmptyConversation()
        setConversations([fresh])
        setActiveConversationId(fresh.id)
      }
    }).catch(() => {
      clearTimeout(timeout)
      // IPC failed — show welcome screen instead of blank
      setApiKeyReady(false)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Generation progress listener
  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.onGenerationProgress((progress) => {
      setGenerationProgress(progress)
    })
  }, [])

  // Auto-update listeners
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanups = [
      window.electronAPI.onUpdateAvailable((version) => setUpdateAvailable(version)),
      window.electronAPI.onUpdateDownloadProgress((percent) => { setUpdateDownloadPercent(percent); setUpdateError(null) }),
      window.electronAPI.onUpdateDownloaded(() => { setUpdateDownloading(false); setUpdateReady(true) }),
      window.electronAPI.onUpdateError((message) => { setUpdateDownloading(false); setUpdateError(message) })
    ]
    return () => cleanups.forEach(fn => fn())
  }, [])

  // Mode transition: when Claude starts streaming a new spec while in uploaded mode, switch to chat mode
  useEffect(() => {
    if (panelMode === 'uploaded' && isSpecStreaming) {
      setPanelMode('chat')
    }
  }, [isSpecStreaming, panelMode])

  // --- Auto-save: save when streaming completes or messages change while not loading ---
  const prevLoadingRef = useRef(false)
  useEffect(() => {
    if (!window.electronAPI || !activeConversationId) return
    if (isLoading) {
      prevLoadingRef.current = true
      return
    }
    // Save when loading just finished, or when messages were injected
    if (!prevLoadingRef.current && messages.length === 0) return
    prevLoadingRef.current = false

    // Update active conversation in the array and save
    const save = async () => {
      const backendHistory = await window.electronAPI.getBackendHistory().catch(() => [])
      const title = deriveTitle(messages)
      setConversations(prev => {
        const updated = prev.map(c => c.id === activeConversationId
          ? { ...c, title: messages.length > 0 ? title : c.title, messages, architectureSpec, panelMode, uploadedFilePath, uploadedAppName, generationProgress, generationResult, hqImportResult, backendHistory }
          : c
        )
        // Save to disk async
        window.electronAPI.saveConversations({ conversations: updated, activeId: activeConversationId })
        return updated
      })
    }
    save()
  }, [messages, isLoading, architectureSpec]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Tab management ---

  const snapshotActive = useCallback(async (): Promise<Conversation | null> => {
    const id = activeIdRef.current
    const convs = conversationsRef.current
    if (!id) return null
    const current = convs.find(c => c.id === id)
    if (!current) return null
    const backendHistory = window.electronAPI ? await window.electronAPI.getBackendHistory().catch(() => []) : []
    return {
      ...current,
      title: messages.length > 0 ? deriveTitle(messages) : current.title,
      messages,
      architectureSpec,
      panelMode,
      uploadedFilePath,
      uploadedAppName,
      generationProgress,
      generationResult,
      hqImportResult,
      backendHistory
    }
  }, [messages, architectureSpec, panelMode, uploadedFilePath, uploadedAppName, generationProgress, generationResult, hqImportResult])

  const restoreConversation = useCallback((conv: Conversation) => {
    restoreState(conv.messages, conv.architectureSpec)
    setPanelMode((conv.panelMode as PanelMode) || 'chat')
    setUploadedFilePath(conv.uploadedFilePath)
    setUploadedAppName(conv.uploadedAppName)
    setGenerationProgress(conv.generationProgress)
    setGenerationResult(conv.generationResult)
    setHqImportResult(conv.hqImportResult)
    setIsGenerating(false)
    setNameModalOpen(false)
  }, [restoreState])

  const handleSwitchTab = useCallback(async (targetId: string) => {
    if (targetId === activeIdRef.current || isLoading) return
    // Snapshot current
    const snapshot = await snapshotActive()
    const target = conversationsRef.current.find(c => c.id === targetId)
    if (!target) return

    if (snapshot) {
      setConversations(prev => prev.map(c => c.id === snapshot.id ? snapshot : c))
    }
    setActiveConversationId(targetId)
    restoreConversation(target)
    if (window.electronAPI) {
      await window.electronAPI.switchBackendConversation(target.backendHistory || [])
    }
  }, [isLoading, snapshotActive, restoreConversation])

  const handleNewTab = useCallback(async () => {
    // Snapshot current before creating new
    const snapshot = await snapshotActive()
    const fresh = createEmptyConversation()
    setConversations(prev => {
      const updated = snapshot ? prev.map(c => c.id === snapshot.id ? snapshot : c) : prev
      return [...updated, fresh]
    })
    setActiveConversationId(fresh.id)
    restoreConversation(fresh)
    if (window.electronAPI) {
      await window.electronAPI.resetChat()
    }
  }, [snapshotActive, restoreConversation])

  const handleCloseTab = useCallback(async (targetId: string) => {
    if (isLoading) return
    const convs = conversationsRef.current
    if (convs.length <= 1) {
      // Last tab — reset it instead of closing
      const fresh = createEmptyConversation()
      setConversations([fresh])
      setActiveConversationId(fresh.id)
      restoreConversation(fresh)
      if (window.electronAPI) {
        await window.electronAPI.resetChat()
        window.electronAPI.saveConversations({ conversations: [fresh], activeId: fresh.id })
      }
      return
    }

    const idx = convs.findIndex(c => c.id === targetId)
    const remaining = convs.filter(c => c.id !== targetId)

    if (targetId === activeIdRef.current) {
      // Closing active tab — switch to adjacent
      const newIdx = Math.min(idx, remaining.length - 1)
      const newActive = remaining[newIdx]
      setConversations(remaining)
      setActiveConversationId(newActive.id)
      restoreConversation(newActive)
      if (window.electronAPI) {
        await window.electronAPI.switchBackendConversation(newActive.backendHistory || [])
        window.electronAPI.saveConversations({ conversations: remaining, activeId: newActive.id })
      }
    } else {
      // Closing inactive tab — just remove it
      setConversations(remaining)
      if (window.electronAPI && activeIdRef.current) {
        window.electronAPI.saveConversations({ conversations: remaining, activeId: activeIdRef.current })
      }
    }
  }, [isLoading, restoreConversation])

  const handleRenameTab = useCallback((id: string, title: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c))
  }, [])

  // --- Upload-first flow handlers ---

  const handleUploadExisting = useCallback(async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.uploadAndParse()
    if (!result) return

    setUploadedFilePath(result.filePath)
    setUploadedAppName(result.appName)
    setPanelMode('uploaded')
    setGenerationProgress(null)
    setGenerationResult(null)
    setHqImportResult(null)
    setSpec(result.markdownSummary)

    const userMsg = `I uploaded an existing CommCare app: "${result.appName}"`
    const assistantMsg = `I've parsed your uploaded app **"${result.appName}"**. The structure is shown in the panel on the right.\n\nYou can:\n- Click **Validate App** to run it through the CommCare validator\n- Tell me about any modifications you'd like to make`
    injectMessages(userMsg, assistantMsg)

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

  // --- Build flow ---

  const handleBuildRequest = useCallback(() => {
    let defaultName = uploadedAppName || 'CommCare App'
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

  // --- Download/export handlers ---

  const handleDownloadCcz = useCallback(async () => {
    if (!window.electronAPI || !generationResult?.cczPath) return
    try { await window.electronAPI.downloadCcz(generationResult.cczPath) } catch (e) { console.error('Download failed:', e) }
  }, [generationResult])

  const handleDownloadJson = useCallback(async () => {
    if (!window.electronAPI || !generationResult?.hqJsonPath) return
    try { await window.electronAPI.downloadJson(generationResult.hqJsonPath) } catch (e) { console.error('Download failed:', e) }
  }, [generationResult])

  const handleOpenFileLocation = useCallback(async () => {
    if (!window.electronAPI || !generationResult?.cczPath) return
    await window.electronAPI.openFileLocation(generationResult.cczPath)
  }, [generationResult])

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

  const handleSendMessage = useCallback(async (content: string, attachments?: FileAttachment[]) => {
    if (generationResult) {
      setGenerationResult(null)
      setGenerationProgress(null)
    }
    return sendMessage(content, attachments)
  }, [sendMessage, generationResult])

  const canGenerate = messages.length >= 2 && !isLoading && !isGenerating
  const hasPanel = !!architectureSpec

  // --- Welcome screen (no API key) ---

  if (apiKeyReady === null) {
    // Still checking
    return <div className="h-screen bg-[#0a0a0a]" />
  }

  if (apiKeyReady === false) {
    return (
      <WelcomeScreen onComplete={async () => {
        setApiKeyReady(true)
        const fresh = createEmptyConversation()
        setConversations([fresh])
        setActiveConversationId(fresh.id)
      }} />
    )
  }

  // --- Main app ---

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
            ) : updateError ? (
              <>
                <span className="text-red-400/80">Update failed: {updateError.substring(0, 100)}</span>
                <button
                  onClick={() => {
                    setUpdateError(null)
                    setUpdateDownloading(true)
                    window.electronAPI?.downloadUpdate()
                  }}
                  className="px-3 py-1 rounded-md bg-accent hover:bg-accent-light text-white text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <span className="text-white/80">A new version (v{updateAvailable}) is available</span>
                <button
                  onClick={() => {
                    setUpdateDownloading(true)
                    setUpdateError(null)
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
        onNewChat={handleNewTab}
        showNewChat={true}
      />

      <TabBar
        conversations={conversations}
        activeId={activeConversationId || ''}
        onSwitch={handleSwitchTab}
        onClose={handleCloseTab}
        onNew={handleNewTab}
        onRename={handleRenameTab}
        isLoading={isLoading}
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
              onSendMessage={handleSendMessage}
              onUploadExisting={handleUploadExisting}
            />
          </div>

          {/* Generation controls - pinned above chat input */}
          {(isGenerating || generationResult) && (
            <div className="border-t border-white/10 bg-[#0a0a0a] px-6 py-3">
              <div className="max-w-3xl mx-auto space-y-3">
                {generationProgress && (isGenerating || generationProgress.status === 'success' || generationProgress.status === 'failed') && (
                  <ProgressTracker {...generationProgress} />
                )}

                {generationResult?.success && (generationResult.cczPath || generationResult.hqJsonPath) && (
                  <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 space-y-3">
                    <p className="text-sm text-white/70">App generated successfully!</p>
                    <div className="flex flex-wrap gap-2">
                      {generationResult.cczPath && (
                        <button onClick={handleDownloadCcz} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                          Download .ccz
                        </button>
                      )}
                      {generationResult.hqJsonPath && (
                        <button onClick={handleDownloadJson} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                          Download .json
                        </button>
                      )}
                      {generationResult.cczPath && (
                        <button onClick={handleOpenFileLocation} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm transition-colors">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                          Open in Explorer
                        </button>
                      )}
                      {(generationResult.hqJsonPath || generationResult.cczPath) && (
                        <button onClick={handleImportToHq} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm transition-colors">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                          Import to HQ
                        </button>
                      )}
                    </div>
                    {hqImportResult && (
                      <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-xs text-white/60 whitespace-pre-wrap leading-relaxed">
                        {hqImportResult.instructions}
                      </div>
                    )}
                  </div>
                )}

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
                        <p className="text-xs text-white/40">Partial app saved — you can still download it:</p>
                        <button onClick={handleDownloadCcz} className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 transition-colors">
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
        onClose={() => setSettingsOpen(false)}
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
