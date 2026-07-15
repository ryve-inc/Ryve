import { JoinShareButton } from '@/components/buttons/join-share-button'
import { NewCollabButton } from '@/components/buttons/new-collab-button'
import { ShareBackButton } from '@/components/buttons/share-back-button'
import { ShareUploadButton } from '@/components/buttons/share-upload-button'
import { FileRow } from '@/components/file-row'
import { formatBytes, parentOf, shortId } from '@/lib/format'
import { useDrive } from '@/context/drive-context'

export function SharedPage() {
  const {
    shares,
    activeShareId,
    activeShare,
    shareDir,
    shareEntries,
    openShare,
    setShareDir,
    refreshShareFiles,
    showDetail,
    showToast
  } = useDrive()

  if (activeShareId && activeShare) {
    const root = activeShare.pathPrefix || '/'
    const showUp = shareDir !== '/' && shareDir !== root

    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <ShareBackButton />
          <ShareUploadButton />
        </div>
        <ul className="m-0 grid list-none gap-2 p-0">
          {showUp ? (
            <FileRow
              title=".."
              meta="Parent"
              onClick={() => {
                setShareDir(parentOf(shareDir))
                refreshShareFiles().catch((err) => showToast(err.message))
              }}
            />
          ) : null}
          {shareEntries.map((entry) => (
            <FileRow
              key={entry.path}
              title={`${entry.name}${entry.isDirectory ? '/' : ''}`}
              meta={entry.isDirectory ? 'Folder' : formatBytes(entry.byteLength)}
              onClick={() => {
                if (entry.isDirectory) {
                  setShareDir(entry.path)
                  refreshShareFiles().catch((err) => showToast(err.message))
                } else {
                  showDetail(entry.path, activeShareId).catch((err) => showToast(err.message))
                }
              }}
            />
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <JoinShareButton />
        <NewCollabButton />
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {!shares.length ? (
          <li className="file-row pointer-events-none">
            <div>
              <div className="display-title text-[15px]">No shares yet</div>
              <div className="mt-0.5 font-mono text-xs text-mute">
                Create a read link, collaborative folder, or join an invite
              </div>
            </div>
          </li>
        ) : (
          shares.map((share) => (
            <FileRow
              key={share.id}
              title={share.name}
              meta={`${share.type} · ${share.writable ? 'read/write' : 'read-only'} · ${shortId(share.id)}`}
              onClick={() => openShare(share).catch((err) => showToast(err.message))}
            />
          ))
        )}
      </ul>
    </div>
  )
}
