import { useState } from 'react'
import { useDrive } from '@/context/drive-context'
import { Copy, ArrowRight, ShieldCheck, X, Plus } from 'lucide-react'

export function CreateNetworkModal() {
  const {
    createNetworkModal,
    closeCreateNetworkModal,
    createNetwork,
    copyClipboard,
    navigate,
    showToast
  } = useDrive()

  const [nameInput, setNameInput] = useState('')
  const [generatedLink, setGeneratedLink] = useState('')
  const [creating, setCreating] = useState(false)

  if (!createNetworkModal.open) return null

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = nameInput.trim() || 'RYVE Workspace'
    setCreating(true)
    try {
      const res = (await createNetwork(name)) as { networkLink?: string }
      if (res && res.networkLink) {
        setGeneratedLink(res.networkLink)
        showToast('P2P Network Created')
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to create network')
    } finally {
      setCreating(false)
    }
  }

  const handleClose = () => {
    setNameInput('')
    setGeneratedLink('')
    closeCreateNetworkModal()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-soil p-6 shadow-2xl">
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-mute hover:bg-moss/40 hover:text-white cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {!generatedLink ? (
          /* STEP 1: Enter Network Name */
          <form onSubmit={handleCreate}>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-leaf/30 bg-fern/30 px-3 py-1 text-xs text-leaf font-medium">
              <Plus className="h-3.5 w-3.5" />
              <span>Create P2P Network</span>
            </div>

            <h2 className="text-xl font-bold text-white">Name Your Network</h2>
            <p className="mt-1 text-sm text-mute">
              Enter a name for your network workspace. An invite link will be generated for peers to join.
            </p>

            <div className="mt-5 space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-mute">Network Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Design Team, Private Sync, Core Network..."
                className="w-full rounded-xl border border-line bg-moss/50 px-3.5 py-2.5 font-mono text-xs text-white placeholder-mute outline-none focus:border-leaf"
                autoFocus
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-line bg-transparent px-4 py-2 text-sm font-medium text-mute hover:bg-moss/40 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 rounded-xl bg-leaf px-4 py-2 text-sm font-semibold text-soil hover:bg-leaf/90 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <span>{creating ? 'Creating…' : 'Create & Generate Link'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        ) : (
          /* STEP 2: Display Generated Link */
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-leaf/30 bg-fern/30 px-3 py-1 text-xs text-leaf font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Network Created</span>
            </div>

            <h2 className="text-xl font-bold text-white">Your Network is Ready!</h2>
            <p className="mt-1 text-sm text-mute">
              Share this unique network link with authorized devices. Only peers with this link can join and access shared files.
            </p>

            <div className="mt-5 space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-mute">Network Invite Link</label>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-moss/50 p-2.5">
                <input
                  type="text"
                  readOnly
                  value={generatedLink}
                  className="w-full bg-transparent font-mono text-xs text-white outline-none select-all"
                />
                <button
                  type="button"
                  onClick={() => {
                    copyClipboard(generatedLink)
                    showToast('Invite link copied')
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-leaf/20 px-3 py-1.5 text-xs font-semibold text-leaf hover:bg-leaf/30 transition-colors cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  handleClose()
                  navigate('files')
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-leaf px-4 py-2.5 text-sm font-semibold text-soil hover:bg-leaf/90 transition-colors cursor-pointer"
              >
                <span>Enter Network Workspace</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
