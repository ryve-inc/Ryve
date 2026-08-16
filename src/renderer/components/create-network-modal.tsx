import { useDrive } from '@/context/drive-context'
import { Copy, ArrowRight, ShieldCheck, X } from 'lucide-react'

export function CreateNetworkModal() {
  const { createNetworkModal, closeCreateNetworkModal, copyClipboard, showApp } = useDrive()

  if (!createNetworkModal.open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-soil p-6 shadow-2xl">
        <button
          onClick={closeCreateNetworkModal}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-mute hover:bg-moss/40 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-leaf/30 bg-fern/30 px-3 py-1 text-xs text-leaf">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Private Network Created</span>
        </div>

        <h2 className="text-xl font-bold text-white">Your P2P Drive Network is Ready!</h2>
        <p className="mt-1 text-sm text-mute">
          Share this unique network link with authorized devices. Only peers with this link can join and access the shared storage pool.
        </p>

        <div className="mt-5 space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-mute">Network Invite Link</label>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-moss/50 p-2.5">
            <input
              type="text"
              readOnly
              value={createNetworkModal.inviteLink}
              className="w-full bg-transparent font-mono text-xs text-white outline-none select-all"
            />
            <button
              onClick={() => copyClipboard(createNetworkModal.inviteLink)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-leaf/20 px-3 py-1.5 text-xs font-semibold text-leaf hover:bg-leaf/30 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </button>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => {
              closeCreateNetworkModal()
              showApp()
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-leaf px-4 py-2.5 text-sm font-semibold text-soil hover:bg-leaf/90 transition-colors"
          >
            <span>Enter Network Drive</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
