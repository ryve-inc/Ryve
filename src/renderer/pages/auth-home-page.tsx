import { useDrive } from '@/context/drive-context'
import { KeyRound, ArrowRight, ShieldCheck } from 'lucide-react'

export function AuthHomePage() {
  const { setAuthPanel } = useDrive()

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm mx-auto">
      {/* Primary Join RYVE Button */}
      <button
        onClick={() => setAuthPanel('name')}
        className="group relative flex items-center justify-between rounded-2xl border border-leaf/60 bg-leaf p-4.5 text-left shadow-xl shadow-leaf/20 transition-all duration-200 hover:bg-leaf/90 hover:scale-[1.02] cursor-pointer"
      >
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-soil text-leaf font-bold">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="font-bold text-lg text-soil">Join RYVE</div>
            <div className="text-xs text-soil/80 font-medium">Setup Display Name & 24-Word Key</div>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 text-soil transition-transform group-hover:translate-x-1" />
      </button>

      {/* Unlock existing account link */}
      <div className="pt-3 text-center">
        <button
          onClick={() => setAuthPanel('unlock')}
          className="inline-flex items-center gap-2 text-xs text-mute hover:text-white transition-colors cursor-pointer py-1.5 px-3 rounded-xl border border-line/60 bg-moss/40 hover:border-leaf/40"
        >
          <KeyRound className="h-3.5 w-3.5 text-leaf" />
          <span>Already have an account? Unlock with key</span>
        </button>
      </div>
    </div>
  )
}
