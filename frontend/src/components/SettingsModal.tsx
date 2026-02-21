import React, { useState, useEffect } from 'react'
import type { AppSettings } from '../types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState('')
  const [hqServer, setHqServer] = useState('www.commcarehq.org')
  const [hqDomain, setHqDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const [hasKey, setHasKey] = useState(false)

  useEffect(() => {
    if (isOpen && window.electronAPI) {
      window.electronAPI.getSettings().then(settings => {
        setHasKey(!!settings.apiKey)
        setApiKey(settings.apiKey ? '••••••••••••••••••••' : '')
        setHqServer(settings.hqServer || 'www.commcarehq.org')
        setHqDomain(settings.hqDomain || '')
      })
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      const settings: Partial<AppSettings> = {
        hqServer,
        hqDomain
      }
      // Only update API key if user changed it from the masked value
      if (apiKey && !apiKey.startsWith('••')) {
        settings.apiKey = apiKey
      }
      await window.electronAPI.setSettings(settings)
      if (apiKey && !apiKey.startsWith('••')) {
        await window.electronAPI.setApiKey(apiKey)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-6">Settings</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">Anthropic API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onFocus={() => { if (apiKey.startsWith('••')) setApiKey('') }}
              placeholder="sk-ant-..."
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50"
            />
            {!hasKey && (
              <p className="text-xs text-amber-400/70 mt-1">Required to use CommCare Forge</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">CommCare HQ Server</label>
            <input
              type="text"
              value={hqServer}
              onChange={e => setHqServer(e.target.value)}
              placeholder="www.commcarehq.org"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">Project Space Domain</label>
            <input
              type="text"
              value={hqDomain}
              onChange={e => setHqDomain(e.target.value)}
              placeholder="my-project"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white/90 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-accent hover:bg-accent-light text-white transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
