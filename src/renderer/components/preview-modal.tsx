import { useDrive } from '@/context/drive-context'

export function PreviewModal() {
  const { previewModal, closePreviewModal } = useDrive()

  if (!previewModal.open) return null

  const { name, url, mime, content, error } = previewModal

  const isImage = mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name)
  const isPdf = mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  const isVideo = mime?.startsWith('video/') || /\.(mp4|webm|mkv)$/i.test(name)
  const isAudio = mime?.startsWith('audio/') || /\.(mp3|wav|ogg)$/i.test(name)
  const isText =
    content !== null ||
    mime?.startsWith('text/') ||
    /\.(txt|md|js|json|ts|py|html|css|json)$/i.test(name)

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6'>
      <div className='flex h-[85vh] w-[90vw] max-w-5xl flex-col rounded-3xl border border-line bg-moss shadow-2xl overflow-hidden'>
        {/* Header */}
        <div className='flex items-center justify-between border-b border-line bg-soil/40 px-6 py-4'>
          <div>
            <h3 className='display-heading m-0 text-xl text-sand'>{name}</h3>
            <p className='m-0 font-mono text-xs text-mute'>{mime || 'File preview'}</p>
          </div>
          <button
            onClick={closePreviewModal}
            className='rounded-xl border border-line bg-soil px-4 py-2 font-mono text-xs text-sand hover:border-leaf hover:bg-soil/80 transition-all'
          >
            ✕ Close
          </button>
        </div>

        {/* Content Body */}
        <div className='flex-1 overflow-auto p-6 flex items-center justify-center bg-soil/20'>
          {error ? (
            <div className='max-w-md rounded-2xl border border-red-500/30 bg-red-950/40 p-6 text-center'>
              <p className='m-0 text-lg font-bold text-red-400'>Preview Failed</p>
              <p className='mt-2 text-sm text-mute'>{error}</p>
            </div>
          ) : isImage && url ? (
            <img
              src={url}
              alt={name}
              className='max-h-full max-w-full rounded-2xl object-contain shadow-lg'
            />
          ) : isPdf && url ? (
            <iframe
              src={url}
              title={name}
              className='h-full w-full rounded-2xl border border-line'
            />
          ) : isVideo && url ? (
            <video controls src={url} className='max-h-full max-w-full rounded-2xl' />
          ) : isAudio && url ? (
            <audio controls src={url} className='w-full max-w-md' />
          ) : isText && content ? (
            <pre className='h-full w-full overflow-auto rounded-2xl border border-line bg-soil/80 p-6 font-mono text-xs text-sand whitespace-pre-wrap'>
              {content}
            </pre>
          ) : (
            <div className='text-center text-mute font-mono text-sm'>
              No direct preview available for this file type. Click Download to save locally.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
