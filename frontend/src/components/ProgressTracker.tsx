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
  const startRef = useRef(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    setElapsed(0)
  }, [status === 'success' || status === 'failed' ? 'done' : 'active'])

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [isActive])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  // Map status to step number
  const stepMap: Record<string, number> = { generating: 1, validating: 2, fixing: 2, success: 3, failed: 3 }
  const currentStep = stepMap[status] || 1
  const steps = ['Generate', 'Validate', 'Done']

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${
      isSuccess ? 'border-accent/30 bg-accent/5' :
      isFailed ? 'border-red-500/30 bg-red-500/5' :
      'border-white/10 bg-white/5'
    }`}>
      {/* Step indicators */}
      {isActive && (
        <div className="flex items-center gap-1 mb-3">
          {steps.map((step, i) => {
            const stepNum = i + 1
            const isCurrentStep = stepNum === currentStep
            const isCompleted = stepNum < currentStep
            return (
              <React.Fragment key={step}>
                <div className={`flex items-center gap-1.5 ${
                  isCurrentStep ? 'text-accent' : isCompleted ? 'text-accent/60' : 'text-white/20'
                }`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isCurrentStep ? 'bg-accent text-white' :
                    isCompleted ? 'bg-accent/20 text-accent' :
                    'bg-white/5 text-white/30'
                  }`}>
                    {isCompleted ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : stepNum}
                  </div>
                  <span className="text-xs font-medium">{step}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${isCompleted ? 'bg-accent/30' : 'bg-white/10'}`} />
                )}
              </React.Fragment>
            )
          })}
          <span className="text-white/30 ml-auto text-xs tabular-nums">
            {formatTime(elapsed)}
          </span>
        </div>
      )}

      {/* Status line */}
      <div className="flex items-center gap-3">
        {isActive && (
          <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin text-accent shrink-0">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
            <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        )}
        {isSuccess && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent shrink-0">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        )}
        {isFailed && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        )}
        <span className={`text-xs ${isSuccess ? 'text-accent' : isFailed ? 'text-red-400' : 'text-white/70'} break-words`}>
          {message}
          {(status === 'validating' || status === 'fixing') && attempt > 0 && (
            <span className="text-white/30 ml-2">(attempt {attempt})</span>
          )}
        </span>
      </div>

      {/* Files detected during generation */}
      {filesDetected && filesDetected.length > 0 && isActive && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {filesDetected.map((file) => (
            <span key={file} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent/10 text-[11px] text-accent/80">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {file}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
