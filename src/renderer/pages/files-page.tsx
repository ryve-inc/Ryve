import { useState } from 'react'
import { FileRow } from '@/components/file-row'
import { formatBytes, parentOf } from '@/lib/format'
import { useDrive } from '@/context/drive-context'
import { Lock, Globe, Folder, ShieldCheck } from 'lucide-react'

export function FilesPage() {
  const { currentDir, entries, setCurrentDir, refreshFiles, onEntryClick, showToast } = useDrive()
  const [filterTab, setFilterTab] = useState<'all' | 'private' | 'public'>('all')

  const filteredEntries = entries.filter((entry) => {
    if (entry.isDirectory) return true
    if (filterTab === 'private') return entry.isPrivate !== false
    if (filterTab === 'public') return entry.isPrivate === false
    return true
  })

  return (
    <div className="flex flex-col gap-4">
      {/* File Visibility Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-line/60 pb-2">
        <button
          onClick={() => setFilterTab('all')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            filterTab === 'all'
              ? 'bg-leaf text-soil shadow-sm'
              : 'text-mute hover:bg-moss/60 hover:text-white'
          }`}
        >
          <span>All Files</span>
          <span className="rounded-full bg-soil/20 px-1.5 py-0.5 text-[10px]">{entries.length}</span>
        </button>

        <button
          onClick={() => setFilterTab('private')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            filterTab === 'private'
              ? 'bg-leaf text-soil shadow-sm'
              : 'text-mute hover:bg-moss/60 hover:text-white'
          }`}
        >
          <Lock className="h-3 w-3" />
          <span>Private Files</span>
          <span className="rounded-full bg-soil/20 px-1.5 py-0.5 text-[10px]">
            {entries.filter((e) => !e.isDirectory && e.isPrivate !== false).length}
          </span>
        </button>

        <button
          onClick={() => setFilterTab('public')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            filterTab === 'public'
              ? 'bg-leaf text-soil shadow-sm'
              : 'text-mute hover:bg-moss/60 hover:text-white'
          }`}
        >
          <Globe className="h-3 w-3" />
          <span>Public Files</span>
          <span className="rounded-full bg-soil/20 px-1.5 py-0.5 text-[10px]">
            {entries.filter((e) => !e.isDirectory && e.isPrivate === false).length}
          </span>
        </button>
      </div>

      {filteredEntries.length === 0 && currentDir === '/' ? (
        <div className="panel-surface border-dashed p-14 text-center">
          <p className="display-heading m-0 text-3xl">Drop files</p>
          <p className="mt-2 text-sm text-mute">
            {filterTab === 'private'
              ? 'No private files. Private files offload chunks to peers with 0 local storage.'
              : filterTab === 'public'
              ? 'No public files. Public files are visible to everyone on the network.'
              : 'or use Upload. No seats, no surprises.'}
          </p>
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
        {filteredEntries.map((entry) => {
          const isPriv = entry.isPrivate !== false
          const meta = entry.isDirectory
            ? 'Folder'
            : `${formatBytes(entry.byteLength)} · ${entry.chunkCount || 0} chunks · ${
                isPriv ? '🔒 Private (0 local chunks)' : '🌐 Public (Seeded)'
              }`
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
