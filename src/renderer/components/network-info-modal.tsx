import { useDrive } from '@/context/drive-context'
import { Copy, ShieldCheck, Users, X, LogOut, Radio } from 'lucide-react'

export function NetworkInfoModal() {
  const { networkInfoModal, closeNetworkInfoModal, status, copyClipboard, logout, openJoinNetworkModal } = useDrive()

  if (!networkInfoModal.open) return null

  const networkLink = status.network?.networkLink || 'p2p-drive://network/local'
  const peerCount = status.peers || 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-soil p-6 shadow-2xl">
        <button
          onClick={closeNetworkInfoModal}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-mute hover:bg-moss/40 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-leaf/30 bg-fern/30 px-3 py-1 text-xs text-leaf">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Active P2P Network</span>
        </div>

        <h2 className="text-xl font-bold text-white">Network Details</h2>
        <p className="mt-1 text-sm text-mute">
          Only peers with this exact network invite link can join, replicate, and access stored chunks.
        </p>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-mute">Network Invite Link</label>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-moss/50 p-2.5">
              <input
                type="text"
                readOnly
                value={networkLink}
                className="w-full bg-transparent font-mono text-xs text-white outline-none select-all"
              />
              <button
                onClick={() => copyClipboard(networkLink)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-leaf/20 px-3 py-1.5 text-xs font-semibold text-leaf hover:bg-leaf/30 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-moss/40 p-3">
              <div className="flex items-center gap-2 text-xs text-mute">
                <Users className="h-3.5 w-3.5 text-leaf" />
                <span>Active Peers</span>
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-white">{peerCount}</div>
            </div>
            <div className="rounded-xl border border-line bg-moss/40 p-3">
              <div className="flex items-center gap-2 text-xs text-mute">
                <Radio className="h-3.5 w-3.5 text-leaf" />
                <span>Network Swarm</span>
              </div>
              <div className="mt-1 text-xs font-medium text-leaf">Connected & Active</div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 pt-2 border-t border-line">
          <button
            onClick={() => {
              closeNetworkInfoModal()
              openJoinNetworkModal()
            }}
            className="flex-1 rounded-xl border border-line bg-moss/40 px-3 py-2 text-xs font-semibold text-white hover:bg-moss/70 transition-colors"
          >
            Switch / Join Another Network
          </button>
          <button
            onClick={() => {
              closeNetworkInfoModal()
              logout()
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Leave Network</span>
          </button>
        </div>
      </div>
    </div>
  )
}
