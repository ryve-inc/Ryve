import { useEffect, useState } from 'react'
import { LogoutButton } from '@/components/buttons/logout-button'
import { SaveBlindPeersButton } from '@/components/buttons/save-blind-peers-button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDrive } from '@/context/drive-context'
import { formatBytes } from '@/lib/format'
import { HardDrive, Check, Sparkles, Shield, Database } from 'lucide-react'

const PRESETS = [
  { label: '500 MB', bytes: 500 * 1024 * 1024 },
  { label: '2 GB', bytes: 2 * 1024 * 1024 * 1024 },
  { label: '10 GB', bytes: 10 * 1024 * 1024 * 1024 },
  { label: '25 GB', bytes: 25 * 1024 * 1024 * 1024 },
  { label: '50 GB', bytes: 50 * 1024 * 1024 * 1024 },
  { label: '100 GB', bytes: 100 * 1024 * 1024 * 1024 }
]

export function SettingsPage() {
  const { status, setStorageQuota } = useDrive()
  const [blindKeys, setBlindKeys] = useState((status.blindPeerKeys || []).join('\n'))

  const storage = status.storage || {
    quotaMode: 'limited',
    quotaBytes: 10 * 1024 * 1024 * 1024,
    usedBytes: 0,
    availableBytes: 10 * 1024 * 1024 * 1024,
    freeDiskBytes: 50 * 1024 * 1024 * 1024
  }

  const [mode, setMode] = useState<'limited' | 'all'>(storage.quotaMode || 'limited')
  const [quotaGb, setQuotaGb] = useState<number>(
    Math.max(1, Math.round(storage.quotaBytes / (1024 * 1024 * 1024)))
  )
  const [savingStorage, setSavingStorage] = useState(false)

  useEffect(() => {
    setBlindKeys((status.blindPeerKeys || []).join('\n'))
  }, [status.blindPeerKeys])

  useEffect(() => {
    if (status.storage) {
      setMode(status.storage.quotaMode)
      if (status.storage.quotaBytes) {
        setQuotaGb(Math.max(0.5, Number((status.storage.quotaBytes / (1024 * 1024 * 1024)).toFixed(1))))
      }
    }
  }, [status.storage])

  const effectiveLimitBytes =
    mode === 'all'
      ? storage.freeDiskBytes
      : Math.round(quotaGb * 1024 * 1024 * 1024)

  const usedPercent =
    effectiveLimitBytes > 0
      ? Math.min(100, Math.round((storage.usedBytes / effectiveLimitBytes) * 100))
      : 0

  const handleSaveStorage = async () => {
    setSavingStorage(true)
    try {
      const bytes = Math.round(quotaGb * 1024 * 1024 * 1024)
      await setStorageQuota(mode, bytes)
    } finally {
      setSavingStorage(false)
    }
  }

  return (
    <div className="mx-auto max-w-[760px] pb-12">
      <p className="meta-label text-leaf">Preferences</p>
      <h2 className="display-heading m-0 mt-2 text-[34px]">Settings</h2>

      {/* Identity Card */}
      <div className="panel-surface mt-6 overflow-hidden">
        <div className="iris-wash px-5 py-4">
          <h3 className="display-title m-0 text-lg">Identity</h3>
        </div>
        <div className="grid gap-3 border-t border-line p-5">
          <code className="break-all font-mono text-xs text-soft">{status.identity || '—'}</code>
          <p className="m-0 text-sm text-mute">
            Drive key:{' '}
            <code className="font-mono text-xs text-leaf">{status.driveKey || '—'}</code>
          </p>
          <LogoutButton />
        </div>
      </div>

      {/* Storage Allocation Card */}
      <div className="liquid-panel mt-6 grid gap-5 p-6 border border-line bg-moss/50 rounded-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-soil border border-line text-leaf">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white m-0">Node Storage Allocation</h3>
              <p className="m-0 text-xs text-mute">Decide how much disk space this device contributes to P2P networks</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-leaf/30 bg-fern/30 px-3 py-1 text-xs font-mono text-leaf">
            <Database className="h-3 w-3" />
            <span>Used: {formatBytes(storage.usedBytes)}</span>
          </span>
        </div>

        {/* Live Storage Meter */}
        <div className="space-y-2 rounded-xl bg-soil/70 border border-line p-4">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-mute">
              {mode === 'all' ? 'Dynamic All Available' : `Limit: ${quotaGb} GB`}
            </span>
            <span className="text-leaf font-bold">
              {usedPercent}% used ({formatBytes(storage.usedBytes)} / {formatBytes(effectiveLimitBytes)})
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-moss/80">
            <div
              className="h-full bg-linear-to-r from-fern via-leaf to-emerald-400 transition-all duration-300"
              style={{ width: `${Math.max(2, usedPercent)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-mute pt-1">
            <span>Free space on host drive: <strong className="text-soft font-mono">{formatBytes(storage.freeDiskBytes)}</strong></span>
            <span>Safety buffer: <strong className="text-soft font-mono">2 GB</strong></span>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode('limited')}
            className={`flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              mode === 'limited'
                ? 'border-leaf bg-fern/30 shadow-md shadow-leaf/10'
                : 'border-line bg-moss/40 hover:border-line-hover text-mute'
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-sm font-semibold text-white">Limited Quota</span>
              {mode === 'limited' && <Check className="h-4 w-4 text-leaf" />}
            </div>
            <p className="mt-1 text-xs text-mute">
              Cap storage to a specific size. Rejects peer chunks when the quota is reached.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('all')}
            className={`flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
              mode === 'all'
                ? 'border-leaf bg-fern/30 shadow-md shadow-leaf/10'
                : 'border-line bg-moss/40 hover:border-line-hover text-mute'
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                <span>Allocate All</span>
                <Sparkles className="h-3 w-3 text-leaf" />
              </span>
              {mode === 'all' && <Check className="h-4 w-4 text-leaf" />}
            </div>
            <p className="mt-1 text-xs text-mute">
              Dynamically allocate available space while preserving host system safety headroom.
            </p>
          </button>
        </div>

        {/* Custom Limit Slider & Presets (Visible only in Limited Mode) */}
        {mode === 'limited' && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-mute">QUICK PRESETS</span>
              <span className="text-sm font-bold font-mono text-leaf">{quotaGb} GB</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const gb = Number((p.bytes / (1024 * 1024 * 1024)).toFixed(1))
                const isSelected = Math.abs(quotaGb - gb) < 0.1
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setQuotaGb(gb)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-leaf bg-leaf text-soil font-bold'
                        : 'border-line bg-soil/80 text-mute hover:border-leaf/50 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>

            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-mute">
                <span>Adjust Capacity</span>
                <span className="font-mono">{quotaGb} GB</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="200"
                step="0.5"
                value={quotaGb}
                onChange={(e) => setQuotaGb(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-moss rounded-lg appearance-none cursor-pointer accent-leaf"
              />
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleSaveStorage}
            disabled={savingStorage}
            className="flex items-center justify-center gap-2 rounded-xl bg-leaf px-4 py-2.5 text-sm font-semibold text-soil hover:bg-leaf/90 transition-all shadow-md shadow-leaf/20 cursor-pointer disabled:opacity-50"
          >
            {savingStorage ? (
              <span>Saving Preferences...</span>
            ) : (
              <>
                <Shield className="h-4 w-4" />
                <span>Save Storage Preferences</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Blind Peers Card */}
      <div className="liquid-panel mt-6 grid gap-3 p-5">
        <h3 className="meta-label m-0 text-leaf">Blind peers</h3>
        <p className="m-0 text-sm leading-relaxed text-mute">
          Pin encrypted replicas to blind peers so files stay reachable when your devices are
          offline. Paste one public key per line.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="blind-keys" className="sr-only">
            Blind peer keys
          </Label>
          <Textarea
            id="blind-keys"
            rows={4}
            placeholder="z32… blind peer keys"
            value={blindKeys}
            onChange={(e) => setBlindKeys(e.target.value)}
          />
        </div>
        <SaveBlindPeersButton value={blindKeys} />
      </div>
    </div>
  )
}
