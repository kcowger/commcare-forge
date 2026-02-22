import React, { useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'

interface ArchitecturePanelProps {
  content: string
  isStreaming: boolean
  canBuild: boolean
  onBuild: () => void
  mode: 'chat' | 'uploaded'
  onValidate?: () => void
  isValidating?: boolean
}

export default function ArchitecturePanel({ content, isStreaming, canBuild, onBuild, mode, onValidate, isValidating }: ArchitecturePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll while streaming
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming])

  return (
    <div className="w-[40%] border-l border-white/10 flex flex-col bg-[#0c0c0c] animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span className="text-sm font-semibold text-white">App Architecture</span>
        </div>
        {isStreaming && (
          <span className="text-[11px] text-accent/70 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            Updating...
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        <div className="spec-markdown text-sm text-white/85 leading-relaxed">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-accent animate-pulse ml-0.5 mt-1 rounded-sm" />
        )}
      </div>

      {/* Action button */}
      {canBuild && !isStreaming && (
        <div className="px-5 py-3 border-t border-white/10 shrink-0">
          {mode === 'uploaded' ? (
            <button
              onClick={onValidate}
              disabled={isValidating}
              className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-light text-white font-medium text-sm transition-colors disabled:opacity-50"
            >
              {isValidating ? 'Validating...' : 'Validate App'}
            </button>
          ) : (
            <button
              onClick={onBuild}
              className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-light text-white font-medium text-sm transition-colors"
            >
              Build App
            </button>
          )}
        </div>
      )}
    </div>
  )
}
