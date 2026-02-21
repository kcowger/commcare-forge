import React, { useState, useEffect, useCallback } from 'react'
import Header from './components/Header'
import ChatInterface from './components/ChatInterface'
import SettingsModal from './components/SettingsModal'
import ProgressTracker from './components/ProgressTracker'
import { useChat } from './hooks/useChat'
import type { GenerationProgress, GenerationResult } from './types'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [needsApiKey, setNeedsApiKey] = useState(false)
  const { messages, isLoading, sendMessage, clearMessages } = useChat()

  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null)
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null)

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

  const handleGenerate = useCallback(async () => {
    if (!window.electronAPI || isGenerating) return

    setIsGenerating(true)
    setGenerationProgress({ status: 'generating', message: 'Starting generation...', attempt: 0, maxAttempts: 5 })
    setGenerationResult(null)

    try {
      const result = await window.electronAPI.generateApp()
      setGenerationResult(result)
    } catch (error: any) {
      setGenerationProgress({ status: 'failed', message: error.message || 'Generation failed', attempt: 0, maxAttempts: 5 })
      setGenerationResult({ success: false, errors: [error.message] })
    } finally {
      setIsGenerating(false)
    }
  }, [isGenerating])

  // Show "Build App" button once there are enough messages (user + assistant)
  const canGenerate = messages.length >= 2 && !isLoading && !isGenerating

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-white">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ChatInterface
            messages={messages}
            isLoading={isLoading}
            onSendMessage={sendMessage}
          />
        </div>

        {/* Generation controls - pinned above chat input */}
        {(canGenerate || isGenerating || generationResult) && (
          <div className="border-t border-white/10 bg-[#0a0a0a] px-6 py-3">
            <div className="max-w-3xl mx-auto space-y-3">
              {/* Progress tracker */}
              {generationProgress && (isGenerating || generationProgress.status === 'success' || generationProgress.status === 'failed') && (
                <ProgressTracker {...generationProgress} />
              )}

              {/* Result: success */}
              {generationResult?.success && generationResult.cczPath && (
                <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-3">
                  <p className="text-sm text-white/70 mb-2">
                    Saved to: <code className="text-white/90 bg-white/5 px-1.5 py-0.5 rounded text-xs">{generationResult.cczPath}</code>
                  </p>
                </div>
              )}

              {/* Result: failure with errors */}
              {generationResult && !generationResult.success && generationResult.errors && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
                  <p className="text-sm text-red-400 font-medium mb-1">Issues found:</p>
                  <ul className="text-xs text-white/50 space-y-0.5">
                    {generationResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i} className="truncate">- {err}</li>
                    ))}
                  </ul>
                  {generationResult.cczPath && (
                    <p className="text-xs text-white/40 mt-2">
                      Partial app saved to: <code className="text-white/60">{generationResult.cczPath}</code>
                    </p>
                  )}
                </div>
              )}

              {/* Build button */}
              {canGenerate && !generationResult?.success && (
                <button
                  onClick={handleGenerate}
                  className="w-full py-3 rounded-xl bg-accent hover:bg-accent-light text-white font-medium text-sm transition-colors"
                >
                  Build App
                </button>
              )}
            </div>
          </div>
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
    </div>
  )
}
