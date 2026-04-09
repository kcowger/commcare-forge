import React, { useState, useEffect, useRef } from 'react'

interface ProgressTrackerProps {
  status: 'generating' | 'validating' | 'fixing' | 'success' | 'failed'
  message: string
  attempt: number
  filesDetected?: string[]
}

export default function ProgressTracker({ status, message, attempt, filesDetected }: ProgressTrackerProps) {
  const isActive = status !== 'success' && status !== 'failed'
  const isSuccess = status === 'success'
  const isFailed = status === 'failed'
  const [elapsed, setElapsed] = useState(0)
  const [recentMessages, setRecentMessages] = useState<string[]>([])
  const startRef = useRef(Date.now())
  const prevMessageRef = useRef('')

  useEffect(() => {
    startRef.current = Date.now()
    setElapsed(0)
    setRecentMessages([])
  }, [status === 'success' || status === 'failed' ? 'done' : 'active'])

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [isActive])

  // Track message history
  useEffect(() => {
    if (message && message !== prevMessageRef.current && isActive) {
      prevMessageRef.current = message
      setRecentMessages(prev => [...prev, message].slice(-8))
    }
  }, [message, isActive])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  // Phase description — tells the user what's actually happening
  const phaseDescription: Record<string, string> = {
    generating: 'Claude is designing your app structure — modules, forms, questions, case logic',
    validating: 'Checking against CommCare HQ rules and running the CLI validator',
    fixing: 'Found issues — Claude is fixing them automatically',
  }

  // Time estimate based on phase
  const timeHint: Record<string, string> = {
    generating: 'Usually 15-45 seconds depending on complexity',
    validating: 'A few seconds',
    fixing: 'Usually 10-20 seconds per fix attempt',
  }

  return (
    <div className={`rounded-xl border px-5 py-4 ${
      isSuccess ? 'border-accent/30 bg-accent/5' :
      isFailed ? 'border-danger/30 bg-danger/5' :
      'border-white/10 bg-white/[0.03]'
    }`}>

      {/* Active state */}
      {isActive && (
        <>
          {/* Header: phase name + timer */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin text-accent shrink-0">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
              <span className="text-sm font-semibold text-white/90">
                {status === 'generating' ? 'Generating App' :
                 status === 'validating' ? 'Validating' :
                 status === 'fixing' ? `Auto-Fixing (attempt ${attempt})` : 'Processing'}
              </span>
            </div>
            <span className="text-white/30 text-xs tabular-nums font-mono">
              {formatTime(elapsed)}
            </span>
          </div>

          {/* Indeterminate progress bar — honest, no fake percentage */}
          <div className="h-1 bg-white/5 rounded-full mb-3 overflow-hidden">
            <div
              className="h-full bg-accent/80 rounded-full"
              style={{
                width: status === 'validating' ? '80%' : '30%',
                animation: 'indeterminate 1.8s ease-in-out infinite',
              }}
            />
          </div>

          {/* What's happening right now */}
          <p className="text-sm text-white/70 mb-1">
            {message.startsWith('Building:') ? message : phaseDescription[status] || message}
          </p>

          {/* Time estimate */}
          <p className="text-xs text-white/30 mb-2">
            {timeHint[status]}
          </p>

          {/* Activity log — what's been built so far */}
          {recentMessages.length > 1 && (
            <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
              {recentMessages.slice(0, -1).map((msg, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-white/30">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-accent/50">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{msg}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Success state */}
      {isSuccess && (
        <div className="flex items-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent shrink-0">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span className="text-sm font-medium text-accent">{message}</span>
        </div>
      )}

      {/* Failed state */}
      {isFailed && (
        <div className="flex items-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-danger shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span className="text-sm font-medium text-danger">{message}</span>
        </div>
      )}

      {/* CSS for indeterminate animation */}
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  )
}
