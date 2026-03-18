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

  // Track message history for the activity log
  useEffect(() => {
    if (message && message !== prevMessageRef.current && isActive) {
      prevMessageRef.current = message
      setRecentMessages(prev => {
        const next = [...prev, message]
        return next.slice(-6) // Keep last 6 messages
      })
    }
  }, [message, isActive])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  // Map status to progress percentage (approximate)
  const progressMap: Record<string, number> = {
    generating: 40,
    validating: 70,
    fixing: 60,
    success: 100,
    failed: 100
  }
  const progressPct = progressMap[status] || 0

  // Phase labels
  const phases = [
    { key: 'generating', label: 'AI Generation', icon: '1' },
    { key: 'validating', label: 'Validation', icon: '2' },
    { key: 'done', label: 'Export', icon: '3' },
  ]
  const currentPhaseIdx = status === 'generating' ? 0 : (status === 'validating' || status === 'fixing') ? 1 : 2

  return (
    <div className={`rounded-xl border px-5 py-4 ${
      isSuccess ? 'border-accent/30 bg-accent/5' :
      isFailed ? 'border-red-500/30 bg-red-500/5' :
      'border-white/10 bg-white/[0.03]'
    }`}>
      {/* Phase steps */}
      {isActive && (
        <div className="flex items-center gap-2 mb-4">
          {phases.map((phase, i) => {
            const isCurrent = i === currentPhaseIdx
            const isDone = i < currentPhaseIdx
            return (
              <React.Fragment key={phase.key}>
                <div className={`flex items-center gap-2 ${
                  isCurrent ? 'text-accent' : isDone ? 'text-accent/60' : 'text-white/20'
                }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                    isCurrent ? 'bg-accent text-white ring-2 ring-accent/30' :
                    isDone ? 'bg-accent/20 text-accent' :
                    'bg-white/5 text-white/30'
                  }`}>
                    {isDone ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : phase.icon}
                  </div>
                  <span className="text-xs font-medium">{phase.label}</span>
                </div>
                {i < phases.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded-full transition-all ${isDone ? 'bg-accent/40' : 'bg-white/10'}`} />
                )}
              </React.Fragment>
            )
          })}
          <span className="text-white/30 ml-auto text-xs tabular-nums font-mono">
            {formatTime(elapsed)}
          </span>
        </div>
      )}

      {/* Progress bar */}
      {isActive && (
        <div className="h-1.5 bg-white/5 rounded-full mb-3 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${progressPct}%`,
              animation: status === 'generating' ? 'pulse 2s ease-in-out infinite' : undefined,
            }}
          />
        </div>
      )}

      {/* Current status */}
      <div className="flex items-center gap-3">
        {isActive && (
          <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin text-accent shrink-0">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
            <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        )}
        {isSuccess && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent shrink-0">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
        {isFailed && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
        <span className={`text-sm font-medium ${isSuccess ? 'text-accent' : isFailed ? 'text-red-400' : 'text-white/80'}`}>
          {message}
          {(status === 'fixing') && attempt > 0 && (
            <span className="text-white/30 ml-2 text-xs">(fixing attempt {attempt})</span>
          )}
        </span>
      </div>

      {/* Activity log — shows what was built */}
      {isActive && recentMessages.length > 1 && (
        <div className="mt-3 pl-8 border-l border-white/5 ml-2 space-y-1">
          {recentMessages.slice(0, -1).map((msg, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-white/30">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-accent/40">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
