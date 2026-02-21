import React from 'react'

interface ImportPanelProps {
  filePath: string
  onImportToHQ: () => void
  onDownloadCcz: () => void
}

export default function ImportPanel({ filePath, onImportToHQ, onDownloadCcz }: ImportPanelProps) {
  return (
    <div className="rounded-xl border border-accent/20 bg-accent/5 px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <h3 className="text-sm font-semibold text-white">App Generated Successfully</h3>
      </div>

      <p className="text-xs text-white/50 mb-4 leading-relaxed">
        Your CommCare app has been validated and is ready to import.
        Saved to: <code className="text-white/70 bg-white/5 px-1.5 py-0.5 rounded">{filePath}</code>
      </p>

      <div className="flex gap-3">
        <button
          onClick={onImportToHQ}
          className="flex-1 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors"
        >
          Import to HQ
        </button>
        <button
          onClick={onDownloadCcz}
          className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-sm transition-colors"
        >
          Download .ccz
        </button>
      </div>
    </div>
  )
}
