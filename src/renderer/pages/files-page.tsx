import { FileRow } from '@/components/file-row'
import { formatBytes, parentOf } from '@/lib/format'
import { useDrive } from '@/context/drive-context'

export function FilesPage() {
  const { currentDir, entries, setCurrentDir, refreshFiles, onEntryClick, showToast } = useDrive()

  return (
    <div>
      {entries.length === 0 && currentDir === '/' ? (
        <div className="panel-surface border-dashed p-14 text-center">
          <p className="display-heading m-0 text-3xl">Drop files</p>
          <p className="mt-2 text-sm text-mute">or use Upload. No seats, no surprises.</p>
        </div>
      ) : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {currentDir !== '/' ? (
          <FileRow
            title=".."
            meta="Parent folder"
            onClick={() => {
              setCurrentDir(parentOf(currentDir))
              refreshFiles().catch((err) => showToast(err.message))
            }}
          />
        ) : null}
        {entries.map((entry) => {
          const meta = entry.isDirectory
            ? 'Folder'
            : `${formatBytes(entry.byteLength)} · ${entry.chunkCount || 0} chunks`
          return (
            <FileRow
              key={entry.path}
              title={`${entry.name}${entry.isDirectory ? '/' : ''}`}
              meta={meta}
              onClick={() => onEntryClick(entry).catch((err) => showToast(err.message))}
            />
          )
        })}
      </ul>
    </div>
  )
}
