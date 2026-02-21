import React from 'react'

interface AppSummaryProps {
  summary: string
  onConfirm: () => void
  onEdit: () => void
}

export default function AppSummary({ summary, onConfirm, onEdit }: AppSummaryProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
      <h3 className="text-sm font-semibold text-white mb-3">App Summary</h3>
      <div className="text-sm text-white/70 whitespace-pre-wrap leading-relaxed mb-4">
        {summary}
      </div>
      <div className="flex gap-3">
        <button
          onClick={onConfirm}
          className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors"
        >
          Confirm & Generate
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-sm transition-colors"
        >
          Request Changes
        </button>
      </div>
    </div>
  )
}
