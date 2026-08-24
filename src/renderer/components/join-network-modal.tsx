import { useState } from 'react'
import { useDrive } from '@/context/drive-context'
import { Link2, ArrowRight, X } from 'lucide-react'

export function JoinNetworkModal() {
  const { joinNetworkModal, closeJoinNetworkModal, joinNetwork, showToast } = useDrive()
  const [linkInput, setLinkInput] = useState('')
  const [joining, setJoining] = useState(false)

  if (!joinNetworkModal.open) return null

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!linkInput.trim()) {
      showToast('Please paste a network invite link.')
      return
    }
    setJoining(true)
    try {
      await joinNetwork(linkInput.trim())
      setLinkInput('')
      closeJoinNetworkModal()
    } catch (err: any) {
      showToast(err.message || 'Failed to join network')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-soil p-6 shadow-2xl">
        <button
          onClick={closeJoinNetworkModal}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-mute hover:bg-moss/40 hover:text-white cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-fern/30 px-3 py-1 text-xs text-soft">
          <Link2 className="h-3.5 w-3.5" />
          <span>Join Network</span>
        </div>

        <h2 className="text-xl font-bold text-white">Join P2P Network</h2>
        <p className="mt-1 text-sm text-mute">
          Paste the unique network link shared by a peer to connect to the network storage pool.
        </p>

        <form onSubmit={handleJoin} className="mt-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-mute">Network Invite Link</label>
            <input
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="p2p-drive://network/..."
              className="w-full rounded-xl border border-line bg-moss/50 px-3.5 py-2.5 font-mono text-xs text-white placeholder-mute outline-none focus:border-leaf"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeJoinNetworkModal}
              className="rounded-xl border border-line bg-transparent px-4 py-2 text-sm font-medium text-mute hover:bg-moss/40 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={joining}
              className="flex items-center gap-2 rounded-xl bg-leaf px-4 py-2 text-sm font-semibold text-soil hover:bg-leaf/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <span>{joining ? 'Connecting…' : 'Join Network'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
