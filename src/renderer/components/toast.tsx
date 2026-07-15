import { useDrive } from '@/context/drive-context'

export function Toast() {
  const { toast } = useDrive()
  if (!toast) return null

  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-fern/95 px-4 py-2.5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <span className="font-mono text-sm text-leaf">{toast}</span>
    </div>
  )
}
