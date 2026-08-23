import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'
import { Lock, Globe, ChevronDown, Upload } from 'lucide-react'

export function UploadButton() {
  const { uploadPaths, showToast } = useDrive()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative inline-block" ref={menuRef}>
      <div className="flex items-center rounded-xl bg-fern/80 border border-leaf/40 overflow-hidden shadow-sm hover:border-leaf">
        <Button
          onClick={() => {
            uploadPaths({ isPrivate: true }).catch((err) => showToast(err.message))
          }}
          className="rounded-r-none border-0 bg-transparent py-2 px-3 text-xs font-semibold text-leaf hover:bg-leaf/20 transition-colors flex items-center gap-1.5"
        >
          <Lock className="h-3.5 w-3.5" />
          <span>Upload Private</span>
        </Button>
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="border-l border-leaf/30 p-2 text-leaf hover:bg-leaf/20 transition-colors cursor-pointer"
          title="More upload options"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {open ? (
        <div className="absolute right-0 top-full mt-1 z-30 w-56 rounded-xl border border-line bg-soil/95 p-1.5 shadow-2xl backdrop-blur-2xl grid gap-1">
          <button
            onClick={() => {
              setOpen(false)
              uploadPaths({ isPrivate: true }).catch((err) => showToast(err.message))
            }}
            className="flex items-start gap-2.5 rounded-lg p-2 text-left hover:bg-moss/80 transition-colors cursor-pointer"
          >
            <Lock className="h-4 w-4 text-leaf mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-white">Private File</div>
              <div className="text-[10px] text-mute leading-tight">Only you see it. 0 local chunks stored.</div>
            </div>
          </button>
          <button
            onClick={() => {
              setOpen(false)
              uploadPaths({ isPrivate: false }).catch((err) => showToast(err.message))
            }}
            className="flex items-start gap-2.5 rounded-lg p-2 text-left hover:bg-moss/80 transition-colors cursor-pointer"
          >
            <Globe className="h-4 w-4 text-emerald-400 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-white">Public File</div>
              <div className="text-[10px] text-mute leading-tight">Visible to network. Chunks seeded locally & on peers.</div>
            </div>
          </button>
        </div>
      ) : null}
    </div>
  )
}
