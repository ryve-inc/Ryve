import { useState, useEffect } from 'react'
import { formatBytes } from '@/lib/format'
import { HardDrive, Check, Sparkles, ShieldCheck, AlertCircle } from 'lucide-react'

interface StorageAllocationSliderProps {
  networkId: string
  networkName: string
  currentAllocatedBytes: number
  currentUsedBytes: number
  freeDiskBytes: number
  remainingDriveBytes: number
  onSave: (bytes: number) => Promise<void>
  compact?: boolean
}

export function StorageAllocationSlider({
  networkName,
  currentAllocatedBytes,
  currentUsedBytes,
  freeDiskBytes,
  remainingDriveBytes,
  onSave,
  compact = false
}: StorageAllocationSliderProps) {
  const initialGb = Math.max(
    0.5,
    Number((currentAllocatedBytes / (1024 * 1024 * 1024)).toFixed(1))
  )
  const [quotaGb, setQuotaGb] = useState<number>(initialGb)
  const [saving, setSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)

  useEffect(() => {
    const gb = Math.max(
      0.5,
      Number((currentAllocatedBytes / (1024 * 1024 * 1024)).toFixed(1))
    )
    setQuotaGb(gb)
  }, [currentAllocatedBytes])

  // Maximum allocation allowed without exceeding physical storage drive capacity
  const maxPossibleBytes = currentAllocatedBytes + remainingDriveBytes
  const maxPossibleGb = Math.max(
    1,
    Number((maxPossibleBytes / (1024 * 1024 * 1024)).toFixed(1))
  )

  const selectedBytes = Math.round(quotaGb * 1024 * 1024 * 1024)
  const isOverLimit = selectedBytes > maxPossibleBytes

  const usedPercent =
    selectedBytes > 0
      ? Math.min(100, Math.round((currentUsedBytes / selectedBytes) * 100))
      : 0

  const handleApply = async () => {
    if (isOverLimit) return
    setSaving(true)
    setSavedSuccess(false)
    try {
      await onSave(selectedBytes)
      setSavedSuccess(true)
      setTimeout(() => setSavedSuccess(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const PRESETS = [
    { label: '500 MB', gb: 0.5 },
    { label: '1 GB (Default)', gb: 1.0 },
    { label: '2 GB', gb: 2.0 },
    { label: '5 GB', gb: 5.0 },
    { label: '10 GB', gb: 10.0 },
    { label: '25 GB', gb: 25.0 },
    { label: '50 GB', gb: 50.0 },
    { label: 'Max Free', gb: Math.min(maxPossibleGb, 100) }
  ].filter((p, idx, arr) => p.gb <= maxPossibleGb || idx === 0)

  return (
    <div className={`space-y-4 rounded-2xl border border-line bg-soil/70 p-4 sm:p-5 backdrop-blur-md ${compact ? 'text-xs' : ''}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line/50 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-fern/30 border border-leaf/30 text-leaf">
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white m-0 truncate max-w-xs">
              Storage Allocation for <span className="text-leaf">{networkName}</span>
            </h4>
            <p className="text-[11px] text-mute m-0">
              Allocated: <strong className="text-white font-mono">{formatBytes(currentAllocatedBytes)}</strong> · Used: <strong className="text-leaf font-mono">{formatBytes(currentUsedBytes)}</strong>
            </p>
          </div>
        </div>

        <span className="self-start sm:self-auto font-mono text-xs font-bold px-2.5 py-1 rounded-full bg-leaf/15 text-leaf border border-leaf/30">
          Target: {quotaGb} GB
        </span>
      </div>

      {/* Live Visual Meter */}
      <div className="space-y-1.5 rounded-xl bg-moss/40 border border-line/60 p-3.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-mute">Quota Utilization:</span>
          <span className="text-leaf font-bold">
            {usedPercent}% used ({formatBytes(currentUsedBytes)} / {formatBytes(selectedBytes)})
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-soil">
          <div
            className={`h-full transition-all duration-300 ${
              usedPercent >= 90
                ? 'bg-rose-500'
                : usedPercent >= 70
                ? 'bg-amber-400'
                : 'bg-linear-to-r from-fern via-leaf to-emerald-400'
            }`}
            style={{ width: `${Math.max(2, usedPercent)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono text-mute pt-0.5">
          <span>Host Drive Free: <strong className="text-soft">{formatBytes(freeDiskBytes)}</strong></span>
          <span>Drive Headroom for this Net: <strong className="text-soft">{formatBytes(maxPossibleBytes)}</strong></span>
        </div>
      </div>

      {/* Preset Buttons */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-mute">CAPACITY PRESETS</span>
          <span className="text-xs text-soft font-mono">Max Drive Limit: {maxPossibleGb} GB</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const isSelected = Math.abs(quotaGb - p.gb) < 0.05
            const exceeds = p.gb * 1024 * 1024 * 1024 > maxPossibleBytes
            return (
              <button
                key={p.label}
                type="button"
                disabled={exceeds}
                onClick={() => setQuotaGb(Math.min(p.gb, maxPossibleGb))}
                className={`px-3 py-1.5 rounded-xl border text-xs font-mono transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'border-leaf bg-leaf text-soil font-bold shadow-md shadow-leaf/20 scale-105'
                    : 'border-line bg-moss/60 text-mute hover:border-leaf/50 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Interactive Slider */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs text-mute">
          <span>Slide to Adjust Storage Contribution</span>
          <span className="font-mono text-leaf font-bold text-sm">{quotaGb} GB</span>
        </div>
        <input
          type="range"
          min="0.5"
          max={Math.max(2, Math.min(maxPossibleGb, 200))}
          step="0.5"
          value={quotaGb}
          onChange={(e) => setQuotaGb(parseFloat(e.target.value))}
          className="w-full h-2 bg-moss rounded-lg appearance-none cursor-pointer accent-leaf"
        />
        <div className="flex items-center justify-between text-[10px] font-mono text-mute">
          <span>500 MB</span>
          <span>{Math.round(maxPossibleGb / 2)} GB</span>
          <span>{maxPossibleGb} GB (Max)</span>
        </div>
      </div>

      {/* Drive Limit Warning */}
      {isOverLimit ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Cannot allocate {quotaGb} GB. Maximum available storage drive headroom is {formatBytes(maxPossibleBytes)}.</span>
        </div>
      ) : null}

      {/* Save Button */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={saving || isOverLimit}
          className="flex items-center justify-center gap-2 rounded-xl bg-leaf px-5 py-2.5 text-xs font-semibold text-soil hover:bg-leaf/90 transition-all shadow-md shadow-leaf/20 cursor-pointer disabled:opacity-50"
        >
          {saving ? (
            <span>Saving Allocation...</span>
          ) : savedSuccess ? (
            <>
              <Check className="h-4 w-4 text-soil" />
              <span>Allocation Saved!</span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" />
              <span>Apply {quotaGb} GB for {networkName}</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
