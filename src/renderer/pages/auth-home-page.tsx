import { useDrive } from '@/context/drive-context'
import { PlusCircle, Link2, KeyRound } from 'lucide-react'

export function AuthHomePage() {
  const { createNetwork, openJoinNetworkModal, setAuthPanel } = useDrive()

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm mx-auto">
      <button
        onClick={createNetwork}
        className="group relative flex items-center justify-between rounded-2xl border border-leaf/40 bg-fern/40 p-4 text-left shadow-lg backdrop-blur-xl transition-all duration-200 hover:border-leaf hover:bg-fern/60"
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-leaf text-soil transition-transform group-hover:scale-105">
            <PlusCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-white">Create P2P Network</div>
            <div className="text-xs text-mute">Generate invite link & private drive</div>
          </div>
        </div>
      </button>

      <button
        onClick={openJoinNetworkModal}
        className="group relative flex items-center justify-between rounded-2xl border border-line bg-moss/40 p-4 text-left backdrop-blur-xl transition-all duration-200 hover:border-line/80 hover:bg-moss/70"
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-moss text-white transition-transform group-hover:scale-105">
            <Link2 className="h-5 w-5 text-leaf" />
          </div>
          <div>
            <div className="font-semibold text-white">Join Existing Network</div>
            <div className="text-xs text-mute">Paste invite link to access shared network</div>
          </div>
        </div>
      </button>

      <div className="pt-2 text-center">
        <button
          onClick={() => setAuthPanel('unlock')}
          className="inline-flex items-center gap-1.5 text-xs text-mute hover:text-white transition-colors"
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>Restore with 24-word recovery key</span>
        </button>
      </div>
    </div>
  )
}

