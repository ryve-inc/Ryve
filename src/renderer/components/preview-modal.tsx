import { useDrive } from '@/context/drive-context'
import { formatBytes } from '@/lib/format'
import { Download, FileCode, FileText, Film, Image as ImageIcon, Loader2, Music, X } from 'lucide-react'

export function PreviewModal() {
  const { previewModal, closePreviewModal, downloadSelected } = useDrive()

  if (!previewModal.open) return null

  const { name, url, mime, content, error, loading, supported, byteLength } = previewModal

  const isImage = mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name)
  const isPdf = mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  const isVideo = mime?.startsWith('video/') || /\.(mp4|webm|mkv|mov|ogv)$/i.test(name)
  const isAudio = mime?.startsWith('audio/') || /\.(mp3|wav|ogg|oga|aac|flac|m4a)$/i.test(name)
  const isText =
    content !== null ||
    mime?.startsWith('text/') ||
    mime === 'application/json' ||
    /\.(txt|md|json|js|ts|jsx|tsx|html|css|csv|py|sh|rs|go|c|cpp|h|hpp|java|xml|yaml|yml|log)$/i.test(name)

  const ext = name.split('.').pop()?.toUpperCase() || 'FILE'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="flex h-[88vh] w-[92vw] max-w-5xl flex-col rounded-3xl border border-line bg-moss shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-soil/50 px-6 py-4">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-leaf/10 border border-leaf/30 text-leaf">
              {isImage ? (
                <ImageIcon className="h-5 w-5" />
              ) : isVideo ? (
                <Film className="h-5 w-5" />
              ) : isAudio ? (
                <Music className="h-5 w-5" />
              ) : isText ? (
                <FileCode className="h-5 w-5" />
              ) : (
                <FileText className="h-5 w-5" />
              )}
            </div>
            <div className="truncate">
              <h3 className="display-heading m-0 text-lg sm:text-xl text-sand truncate">{name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-block rounded-md bg-leaf/10 px-1.5 py-0.5 font-mono text-[10px] text-leaf border border-leaf/20">
                  {ext}
                </span>
                {byteLength ? (
                  <span className="font-mono text-xs text-mute">{formatBytes(byteLength)}</span>
                ) : null}
                {mime ? (
                  <span className="hidden sm:inline font-mono text-xs text-mute/70">· {mime}</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={downloadSelected}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-soil px-3.5 py-1.5 font-mono text-xs text-sand hover:border-leaf hover:bg-soil/80 transition-all cursor-pointer shadow-sm"
              title="Download to disk"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>
            <button
              onClick={closePreviewModal}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-soil px-3 py-1.5 font-mono text-xs text-sand hover:border-red-400 hover:text-red-400 transition-all cursor-pointer"
              title="Close Preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto custom-scrollbar p-4 sm:p-6 flex items-center justify-center bg-soil/25">
          {loading ? (
            <div className="flex flex-col items-center gap-4 text-center p-8 max-w-sm">
              <div className="relative flex items-center justify-center">
                <div className="h-16 w-16 rounded-full border-2 border-leaf/20 animate-ping absolute" />
                <Loader2 className="h-10 w-10 text-leaf animate-spin relative z-10" />
              </div>
              <h4 className="text-base font-bold text-sand mt-2">Reassembling Chunks</h4>
              <p className="font-mono text-xs text-mute leading-relaxed">
                Collecting encrypted shards across network peers and decoding file in memory…
              </p>
            </div>
          ) : error ? (
            <div className="max-w-md rounded-2xl border border-red-500/30 bg-red-950/40 p-8 text-center shadow-xl">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 mb-3">
                <X className="h-6 w-6" />
              </div>
              <p className="m-0 text-lg font-bold text-red-400">Preview Failed</p>
              <p className="mt-2 text-xs font-mono text-mute leading-relaxed">{error}</p>
              <button
                onClick={downloadSelected}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-leaf px-4 py-2 font-mono text-xs font-semibold text-soil hover:bg-leaf/90 transition-all cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download File Instead</span>
              </button>
            </div>
          ) : supported === false ? (
            <div className="flex flex-col items-center gap-3 text-center p-8 max-w-md bg-soil/40 rounded-3xl border border-line">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-leaf/10 border border-leaf/20 text-leaf mb-1">
                <FileText className="h-8 w-8" />
              </div>
              <h4 className="text-base font-bold text-sand">Preview Not Supported</h4>
              <p className="font-mono text-xs text-mute leading-relaxed">
                Direct in-app preview is not supported for <strong className="text-sand">.{ext.toLowerCase()}</strong> files. Click Download to save and view the file with your local application.
              </p>
              <button
                onClick={downloadSelected}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-leaf px-5 py-2.5 font-mono text-xs font-semibold text-soil hover:bg-leaf/90 transition-all cursor-pointer shadow-md"
              >
                <Download className="h-4 w-4" />
                <span>Download File {byteLength ? `(${formatBytes(byteLength)})` : ''}</span>
              </button>
            </div>
          ) : isImage && url ? (
            <div className="h-full w-full flex items-center justify-center p-2">
              <img
                src={url}
                alt={name}
                className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl border border-line"
              />
            </div>
          ) : isPdf && url ? (
            <iframe
              src={url}
              title={name}
              className="h-full w-full rounded-2xl border border-line bg-white shadow-2xl"
            />
          ) : isVideo && url ? (
            <div className="h-full w-full flex items-center justify-center">
              <video
                controls
                autoPlay={false}
                src={url}
                className="max-h-full max-w-full rounded-2xl shadow-2xl border border-line bg-black"
              />
            </div>
          ) : isAudio && url ? (
            <div className="flex flex-col items-center gap-6 bg-soil/80 p-8 sm:p-10 rounded-3xl border border-line max-w-md w-full shadow-2xl">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-leaf/15 border border-leaf/30 text-leaf shadow-inner">
                <Music className="h-10 w-10 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="font-mono text-sand text-sm font-semibold truncate max-w-70">{name}</p>
                <p className="font-mono text-mute text-xs mt-0.5">{mime || 'Audio playback'}</p>
              </div>
              <audio controls src={url} className="w-full rounded-xl" autoPlay={false} />
            </div>
          ) : isText && content !== null ? (
            <div className="h-full w-full flex flex-col rounded-2xl border border-line bg-soil/90 overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-4 py-2.5 bg-soil/70 border-b border-line text-xs font-mono text-mute">
                <span className="flex items-center gap-1.5 text-sand">
                  <FileCode className="h-3.5 w-3.5 text-leaf" />
                  <span>{ext} Document</span>
                </span>
                <span>{content.length.toLocaleString()} characters</span>
              </div>
              <pre className="flex-1 overflow-auto custom-scrollbar p-6 font-mono text-xs text-sand whitespace-pre-wrap selection:bg-leaf/30 leading-relaxed">
                {content}
              </pre>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center p-8 max-w-md bg-soil/40 rounded-3xl border border-line">
              <FileText className="h-12 w-12 text-mute" />
              <p className="font-mono text-xs text-mute">
                No preview data available.
              </p>
              <button
                onClick={downloadSelected}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-leaf px-4 py-2 font-mono text-xs font-semibold text-soil hover:bg-leaf/90 transition-all cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download File</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
