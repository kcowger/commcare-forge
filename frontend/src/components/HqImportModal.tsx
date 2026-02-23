import React, { useState, useEffect } from 'react'

interface HqAppSummary {
  app_id: string
  name: string
}

interface HqFetchResult {
  appName: string
  appId: string
  markdownSummary: string
  hqJson: Record<string, any>
}

interface HqImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (result: HqFetchResult) => void
}

type Step = 'credentials' | 'select' | 'importing'

export default function HqImportModal({ isOpen, onClose, onImport }: HqImportModalProps) {
  const [step, setStep] = useState<Step>('select')
  const [apps, setApps] = useState<HqAppSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [importingName, setImportingName] = useState('')

  // Credentials form
  const [hqUsername, setHqUsername] = useState('')
  const [hqApiKey, setHqApiKey] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSearch('')
    loadApps()
  }, [isOpen])

  async function loadApps() {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.listHqApps()
      setApps(result.apps)
      setStep('select')
    } catch (err: any) {
      if (err.message?.includes('credentials') || err.message?.includes('Credentials')) {
        setStep('credentials')
      } else {
        setError(err.message || 'Failed to load apps')
        setStep('select')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault()
    if (!hqUsername.trim() || !hqApiKey.trim()) return
    setLoading(true)
    setError(null)
    try {
      await window.electronAPI.setHqCredentials(hqUsername.trim(), hqApiKey.trim())
      await loadApps()
    } catch (err: any) {
      setError(err.message || 'Failed to save credentials')
      setLoading(false)
    }
  }

  async function handleSelectApp(app: HqAppSummary) {
    setStep('importing')
    setImportingName(app.name)
    setError(null)
    try {
      const result = await window.electronAPI.fetchHqApp(app.app_id)
      onImport(result)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to fetch app')
      setStep('select')
    }
  }

  if (!isOpen) return null

  const filtered = apps.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">

        {/* Step: Credentials */}
        {step === 'credentials' && (
          <form onSubmit={handleSaveCredentials}>
            <h2 className="text-lg font-semibold text-white mb-1">Connect to CommCare HQ</h2>
            <p className="text-sm text-white/40 mb-4">
              Enter your HQ API credentials. Find your API key at HQ &gt; Settings &gt; My Account.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">Username (email)</label>
                <input
                  type="text"
                  value={hqUsername}
                  onChange={e => setHqUsername(e.target.value)}
                  placeholder="user@example.com"
                  autoFocus
                  autoComplete="off"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">API Key</label>
                <input
                  type="password"
                  value={hqApiKey}
                  onChange={e => setHqApiKey(e.target.value)}
                  placeholder="Your HQ API key"
                  autoComplete="off"
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>
            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white/90 hover:bg-white/5 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!hqUsername.trim() || !hqApiKey.trim() || loading}
                className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent-light text-white transition-colors disabled:opacity-40"
              >
                {loading ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </form>
        )}

        {/* Step: App Selection */}
        {step === 'select' && (
          <>
            <h2 className="text-lg font-semibold text-white mb-1">Import from CommCare HQ</h2>
            <p className="text-sm text-white/40 mb-4">Select an app to import</p>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                <span className="ml-3 text-sm text-white/50">Loading apps...</span>
              </div>
            ) : (
              <>
                {apps.length > 5 && (
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search apps..."
                    className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 mb-3"
                  />
                )}

                {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

                {filtered.length === 0 ? (
                  <p className="text-sm text-white/40 py-8 text-center">
                    {apps.length === 0 ? 'No apps found in this project space.' : 'No matching apps.'}
                  </p>
                ) : (
                  <div className="max-h-72 overflow-y-auto -mx-2 px-2 space-y-1">
                    {filtered.map(app => (
                      <button
                        key={app.app_id}
                        onClick={() => handleSelectApp(app)}
                        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors group"
                      >
                        <span className="text-sm text-white/80 group-hover:text-white">{app.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-white/5">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white/90 hover:bg-white/5 transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <div className="py-8 text-center">
            <div className="w-8 h-8 mx-auto border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-4" />
            <p className="text-sm text-white/70">Importing <strong>{importingName}</strong>...</p>
            <p className="text-xs text-white/40 mt-1">Fetching app details from CommCare HQ</p>
          </div>
        )}
      </div>
    </div>
  )
}
