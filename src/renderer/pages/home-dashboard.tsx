import { useState, useEffect } from 'react'
import { useDrive } from '@/context/drive-context'
import { formatBytes } from '@/lib/format'
import {
  Server,
  Users,
  Plus,
  Link as LinkIcon,
  ShieldCheck,
  Folder,
  ArrowRight,
  Sparkles,
  HardDrive,
  Copy,
  Radio,
  Database
} from 'lucide-react'

export function HomeDashboard() {
  const {
    status,
    displayName,
    switchNetwork,
    createNetwork,
    openCreateNetworkModal,
    openJoinNetworkModal,
    navigate,
    showToast,
    copyClipboard,
    setStorageQuota
  } = useDrive()

  const networks = status.network.networks || []
  const activeId = status.network.activeId
  const name = displayName || status.displayName || 'Peer'

  const storage = status.storage || {
    quotaMode: 'limited',
    quotaBytes: 10 * 1024 * 1024 * 1024,
    usedBytes: 0,
    availableBytes: 10 * 1024 * 1024 * 1024,
    freeDiskBytes: 50 * 1024 * 1024 * 1024
  }
  const storageLimit = storage.quotaMode === 'all' ? storage.freeDiskBytes : storage.quotaBytes

  const [mode, setMode] = useState<'limited' | 'all'>(storage.quotaMode || 'limited')
  const [quotaGb, setQuotaGb] = useState<number>(
    Math.max(0.5, Number((storage.quotaBytes / (1024 * 1024 * 1024)).toFixed(1)))
  )
  const [savingStorage, setSavingStorage] = useState(false)
  const [showSetup, setShowSetup] = useState(true)

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

  const PRESETS = [
    { label: '500 MB', gb: 0.5 },
    { label: '2 GB', gb: 2 },
    { label: '10 GB', gb: 10 },
    { label: '25 GB', gb: 25 },
    { label: '50 GB', gb: 50 },
    { label: '100 GB', gb: 100 }
  ]

  return (
    <div className="flex flex-col gap-8 max-w-6xl mx-auto pb-10">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-linear-to-r from-soil via-moss to-fern/30 p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-leaf/40 bg-fern/40 px-3 py-1 text-xs font-semibold text-leaf">
              <Sparkles className="h-3.5 w-3.5" />
              <span>P2P Encrypted Cloud Network</span>
            </div>
            <h1 className="display-heading text-3xl md:text-5xl font-bold tracking-tight text-white">
              Hi {name}, welcome to <span className="text-leaf">RYVE</span>
            </h1>
            <p className="text-sm md:text-base text-mute max-w-xl leading-relaxed">
              Your decentralized peer-to-peer storage hub. Connect to private networks, store files with erasure coding, and seed public catalogs across nodes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => openCreateNetworkModal('')}
              className="flex items-center gap-2 rounded-xl bg-leaf px-4 py-2.5 text-sm font-semibold text-soil hover:bg-leaf/90 transition-all shadow-lg shadow-leaf/20 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Network</span>
            </button>
            <button
              onClick={openJoinNetworkModal}
              className="flex items-center gap-2 rounded-xl border border-line bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:border-leaf/50 transition-colors cursor-pointer"
            >
              <LinkIcon className="h-4 w-4 text-leaf" />
              <span>Join Network</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">JOINED NETWORKS</span>
            <Server className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-3xl font-mono font-bold text-white">
            {networks.length}
          </div>
          <p className="mt-1 text-xs text-mute">Active P2P workspaces</p>
        </div>

        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">ACTIVE PEERS</span>
            <Users className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-3xl font-mono font-bold text-leaf">
            {status.peers}
          </div>
          <p className="mt-1 text-xs text-mute">Connected network nodes</p>
        </div>

        {/* STORAGE ALLOCATED CARD */}
        <div
          onClick={() => setShowSetup((v: boolean) => !v)}
          className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl hover:border-leaf/60 transition-all cursor-pointer group shadow-lg hover:shadow-leaf/5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute group-hover:text-leaf transition-colors">STORAGE ALLOCATED</span>
            <HardDrive className="h-4 w-4 text-leaf group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-3 text-2xl font-mono font-bold text-white">
            {formatBytes(storage.usedBytes)}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs text-mute">
              {storage.quotaMode === 'all' ? 'All available' : `Limit: ${formatBytes(storageLimit)}`}
            </p>
            <span className="text-[11px] font-semibold text-leaf flex items-center gap-1 group-hover:underline">
              <span>{showSetup ? 'Hide Setup' : 'Slide / Adjust'}</span>
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-moss/60 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-mute">STORAGE ENGINE</span>
            <ShieldCheck className="h-4 w-4 text-leaf" />
          </div>
          <div className="mt-3 text-lg font-mono font-bold text-white">
            Reed-Solomon EC
          </div>
          <p className="mt-1 text-xs text-mute">K=2, M=2 Fault Tolerance</p>
        </div>
      </div>

      {/* Storage Allocation Setup Panel (Directly on Dashboard) */}
      {showSetup && (
        <div className="rounded-3xl border border-line/80 bg-moss/40 p-6 backdrop-blur-xl space-y-5 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fern/30 border border-leaf/40 text-leaf">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white m-0 flex items-center gap-2">
                  <span>Node Storage Space Allocation</span>
                  <span className="text-xs font-mono font-normal rounded-full border border-leaf/40 bg-fern/30 px-2.5 py-0.5 text-leaf">
                    Active Setup
                  </span>
                </h2>
                <p className="text-xs text-mute m-0">
                  Slide or select preset capacity to limit how much disk space this node hosts for peer networks
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('settings')}
              className="inline-flex items-center gap-1.5 text-xs text-mute hover:text-leaf transition-colors cursor-pointer self-start sm:self-auto"
            >
              <span>View Full Preferences</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {/* Live Progress Bar */}
          <div className="space-y-2 rounded-2xl bg-soil/80 border border-line p-4">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-mute">
                Mode: <strong className="text-white">{mode === 'all' ? 'Allocate All Available' : 'Limited Quota'}</strong>
              </span>
              <span className="text-leaf font-bold">
                {usedPercent}% used ({formatBytes(storage.usedBytes)} / {formatBytes(effectiveLimitBytes)})
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-moss">
              <div
                className="h-full bg-linear-to-r from-fern via-leaf to-emerald-400 transition-all duration-300"
                style={{ width: `${Math.max(2, usedPercent)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-mute pt-1">
              <span>Host drive free disk: <strong className="text-soft font-mono">{formatBytes(storage.freeDiskBytes)}</strong></span>
              <span>Headroom available: <strong className="text-soft font-mono">{formatBytes(storage.availableBytes)}</strong></span>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('limited')}
              className={`flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                mode === 'limited'
                  ? 'border-leaf bg-fern/30 shadow-md shadow-leaf/10'
                  : 'border-line bg-soil/60 hover:border-line-hover text-mute'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-sm font-semibold text-white">Limited Quota (Slider)</span>
                {mode === 'limited' && <span className="h-2 w-2 rounded-full bg-leaf shadow-[0_0_8px_rgba(52,211,153,0.8)]" />}
              </div>
              <p className="mt-1 text-xs text-mute">
                Set a specific ceiling. Node automatically rejects remote chunks once full.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('all')}
              className={`flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                mode === 'all'
                  ? 'border-leaf bg-fern/30 shadow-md shadow-leaf/10'
                  : 'border-line bg-soil/60 hover:border-line-hover text-mute'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <span>Allocate All Available</span>
                  <Sparkles className="h-3.5 w-3.5 text-leaf" />
                </span>
                {mode === 'all' && <span className="h-2 w-2 rounded-full bg-leaf shadow-[0_0_8px_rgba(52,211,153,0.8)]" />}
              </div>
              <p className="mt-1 text-xs text-mute">
                Dynamically use all available storage space while reserving a 2 GB safety margin for your OS.
              </p>
            </button>
          </div>

          {/* Slider & Presets (Visible only in Limited Mode) */}
          {mode === 'limited' && (
            <div className="space-y-3 rounded-2xl bg-soil/60 border border-line p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-mute">QUICK CAPACITY PRESETS</span>
                <span className="text-base font-bold font-mono text-leaf">{quotaGb} GB</span>
              </div>

              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => {
                  const isSelected = Math.abs(quotaGb - p.gb) < 0.1
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setQuotaGb(p.gb)}
                      className={`px-3.5 py-1.5 rounded-xl border text-xs font-mono transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-leaf bg-leaf text-soil font-bold shadow-md shadow-leaf/20'
                          : 'border-line bg-moss/60 text-mute hover:border-leaf/50 hover:text-white'
                      }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>

              {/* Slider Control */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs text-mute">
                  <span>Slide to Adjust Quota</span>
                  <span className="font-mono text-leaf font-semibold">{quotaGb} GB</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="200"
                  step="0.5"
                  value={quotaGb}
                  onChange={(e) => setQuotaGb(parseFloat(e.target.value))}
                  className="w-full h-2 bg-moss rounded-lg appearance-none cursor-pointer accent-leaf"
                />
                <div className="flex items-center justify-between text-[10px] font-mono text-mute pt-0.5">
                  <span>500 MB</span>
                  <span>50 GB</span>
                  <span>100 GB</span>
                  <span>200 GB</span>
                </div>
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSaveStorage}
              disabled={savingStorage}
              className="flex items-center justify-center gap-2 rounded-xl bg-leaf px-5 py-2.5 text-sm font-semibold text-soil hover:bg-leaf/90 transition-all shadow-md shadow-leaf/20 cursor-pointer disabled:opacity-50"
            >
              {savingStorage ? (
                <span>Saving...</span>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  <span>Apply Storage Allocation</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Networks Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Radio className="h-5 w-5 text-leaf" />
              <span>Your P2P Networks</span>
            </h2>
            <p className="text-xs text-mute">Select a network to open files or invite peers</p>
          </div>
        </div>

        {networks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-8 text-center bg-moss/30">
            <Server className="mx-auto h-8 w-8 text-mute mb-2" />
            <h3 className="text-sm font-semibold text-white">No networks joined yet</h3>
            <p className="text-xs text-mute mt-1 mb-4">Create your first network or join one via an invite link.</p>
            <button
              onClick={() => openCreateNetworkModal('')}
              className="inline-flex items-center gap-2 rounded-xl bg-leaf px-4 py-2 text-xs font-semibold text-soil hover:bg-leaf/90 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Network</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {networks.map((net) => {
              const isActive = net.id === activeId
              return (
                <div
                  key={net.id}
                  className={`relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-200 ${
                    isActive
                      ? 'border-leaf/60 bg-fern/30 shadow-lg shadow-leaf/10'
                      : 'border-line bg-moss/70 hover:border-line-hover'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-soil border border-line font-mono text-xs font-bold text-leaf">
                          {net.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-white truncate max-w-40">{net.name}</h3>
                          <span className="text-[11px] font-mono text-mute">ID: {net.id.slice(0, 8)}</span>
                        </div>
                      </div>

                      {isActive ? (
                        <span className="flex items-center gap-1 rounded-full bg-leaf/20 px-2 py-0.5 text-[10px] font-semibold text-leaf border border-leaf/30">
                          <ShieldCheck className="h-3 w-3" />
                          <span>Active</span>
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between text-xs font-mono text-mute bg-soil/60 rounded-xl px-3 py-2 border border-line/60">
                      <div className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-leaf" />
                        <span>Connected Peers</span>
                      </div>
                      <span className="font-bold text-white">{net.peers || status.peers || 0}</span>
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-line/50 flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await switchNetwork(net.id)
                        navigate('files')
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-leaf/15 hover:bg-leaf hover:text-soil text-leaf text-xs font-semibold py-2 transition-colors cursor-pointer"
                    >
                      <Folder className="h-3.5 w-3.5" />
                      <span>Open Files</span>
                      <ArrowRight className="h-3 w-3 ml-auto" />
                    </button>

                    <button
                      onClick={() => {
                        copyClipboard(net.networkLink)
                        showToast('Invite link copied')
                      }}
                      title="Copy Invite Link"
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-line bg-soil text-mute hover:text-white hover:border-leaf/40 transition-colors cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
