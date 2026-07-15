import { DetailCloseButton } from '@/components/buttons/detail-close-button'
import { DeleteButton } from '@/components/buttons/delete-button'
import { DownloadButton } from '@/components/buttons/download-button'
import { useDrive } from '@/context/drive-context'

export function DetailPanel() {
  const { detailOpen, detailName, detailMeta, chunkList, selectedEntry } = useDrive()
  if (!detailOpen) return null

  return (
    <aside className="flex w-[min(360px,40vw)] flex-col gap-3 overflow-auto border-l border-line bg-moss/90 p-4 backdrop-blur-xl">
      <DetailCloseButton />
      <h2 className="display-heading m-0 text-2xl">{detailName}</h2>
      <p className="m-0 font-mono text-sm text-mute">{detailMeta}</p>
      <h3 className="meta-label m-0 text-leaf">Chunk hashes</h3>
      <div className="max-h-70 overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-line bg-soil/60 p-3 font-mono text-[0.72rem] text-soft">
        {chunkList}
      </div>
      <div className="flex flex-wrap gap-2">
        <DownloadButton />
        {selectedEntry?.source === 'vault' ? <DeleteButton /> : null}
      </div>
    </aside>
  )
}
