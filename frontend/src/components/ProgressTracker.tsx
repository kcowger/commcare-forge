import React from 'react'

interface ProgressTrackerProps {
  status: 'generating' | 'validating' | 'fixing' | 'success' | 'failed'
  message: string
  attempt: number
  maxAttempts: number
}

export default function ProgressTracker({ status, message, attempt, maxAttempts }: ProgressTrackerProps) {
  const isActive = status !== 'success' && status !== 'failed'
  const isSuccess = status === 'success'
  const isFailed = status === 'failed'

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${
      isSuccess ? 'border-accent/30 bg-accent/5' :
      isFailed ? 'border-red-500/30 bg-red-500/5' :
      'border-white/10 bg-white/5'
    }`}>
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
        <span className={`${isSuccess ? 'text-accent' : isFailed ? 'text-red-400' : 'text-white/70'}`}>
          {message}
        </span>
        {isActive && (
          <span className="text-white/30 ml-auto text-xs">
            Attempt {attempt}/{maxAttempts}
          </span>
        )}
      </div>
    </div>
  )
}
