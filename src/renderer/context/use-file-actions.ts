import { useCallback, useRef, useState } from 'react'
import type { AppStatus, ChunkManifest, DriveEntry } from '../../shared/types.ts'
import type { NavName, PreviewModalState, SelectedEntry } from './types'
import { assertEntryName, formatBytes, joinPath } from '@/lib/format'
import { getBridge, rpc } from '@/lib/rpc'

export function useFileActions({
  showToast,
  askConfirm,
  setStatus
}: {
  showToast: (msg: string) => void
  askConfirm: (title: string, body?: string) => Promise<boolean>
  setStatus: React.Dispatch<React.SetStateAction<AppStatus>>
}) {
  const [currentNav, setCurrentNav] = useState<NavName>('home')
  const [currentDir, setCurrentDirState] = useState('/')
  const [entries, setEntries] = useState<DriveEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailName, setDetailName] = useState('File')
  const [detailMeta, setDetailMeta] = useState('')
  const [chunkList, setChunkList] = useState('')
  const [dragging, setDragging] = useState(false)

  const detailRequestId = useRef(0)
  const currentDirRef = useRef(currentDir)
  currentDirRef.current = currentDir

  const refreshFiles = useCallback(async () => {
    const dir = currentDirRef.current
    const list = await rpc<DriveEntry[]>('list', { dir })
    setEntries(list)
  }, [])

  const showDetail = useCallback(
    async (path: string, entryInfo?: Partial<DriveEntry>) => {
      const requestId = ++detailRequestId.current
      setDetailOpen(true)
      setDetailName(path.split('/').filter(Boolean).pop() || path)
      setChunkList('Loading…')
      setSelectedEntry({
        path,
        source: 'vault',
        name: entryInfo?.name || path.split('/').filter(Boolean).pop() || path,
        isPrivate: entryInfo?.isPrivate,
        uploaderIdentity: entryInfo?.uploaderIdentity,
        isOwner: entryInfo?.isOwner,
        byteLength: entryInfo?.byteLength
      })
      try {
        const manifest = await rpc<ChunkManifest>('getChunkManifest', { path })
        if (requestId !== detailRequestId.current) return
        setDetailMeta(`${formatBytes(manifest.byteLength)} · ${manifest.chunks.length} chunks`)
        setChunkList(
          manifest.chunks
            .map((c) => `#${c.index}  ${c.hash}\n  offset=${c.offset}  len=${c.length}`)
            .join('\n\n')
        )
        setSelectedEntry((prev) => ({
          path,
          source: 'vault',
          name: prev?.name || path.split('/').filter(Boolean).pop() || path,
          isPrivate: prev?.isPrivate !== undefined ? prev.isPrivate : (manifest.metadata?.isPrivate as boolean | undefined),
          uploaderIdentity: prev?.uploaderIdentity || (manifest.metadata?.uploaderIdentity as string | undefined),
          isOwner: prev?.isOwner,
          byteLength: manifest.byteLength,
          manifest
        }))
      } catch (err) {
        if (requestId !== detailRequestId.current) return
        setDetailMeta(err instanceof Error ? err.message : String(err))
        setChunkList('')
      }
    },
    []
  )

  const closeDetail = useCallback(() => {
    detailRequestId.current += 1
    setDetailOpen(false)
    setSelectedEntry(null)
  }, [])

  const onEntryClick = useCallback(
    async (entry: DriveEntry) => {
      if (entry.isDirectory) {
        setCurrentDirState(entry.path)
        currentDirRef.current = entry.path
        await refreshFiles()
        return
      }
      await showDetail(entry.path, entry)
    },
    [refreshFiles, showDetail]
  )

  const uploadPaths = useCallback(
    async (opts: { isPrivate?: boolean } = {}) => {
      const isPrivate = opts.isPrivate !== false
      const bridge = getBridge()
      const paths = await bridge.chooseUploadFiles()
      if (!paths || !paths.length) return
      for (const localPath of paths) {
        const fileName = localPath.split(/[/\\]/).filter(Boolean).pop() || 'file'
        const destPath = joinPath(currentDirRef.current, fileName)
        showToast(`Uploading ${fileName} (${isPrivate ? 'Private' : 'Public'})…`)
        await rpc('upload', { localPath, destPath, mime: null, isPrivate })
      }
      showToast('Upload complete')
      await refreshFiles()
      rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
    },
    [refreshFiles, setStatus, showToast]
  )

  const uploadFiles = useCallback(
    async (fileList: FileList | File[], opts: { isPrivate?: boolean } = {}) => {
      const isPrivate = opts.isPrivate !== false
      const bridge = getBridge()
      const files = [...fileList]
      if (!files.length) return
      for (const file of files) {
        let localPath = bridge.getPathForFile(file)
        if (!localPath) {
          const nativePaths = await bridge.chooseUploadFiles()
          if (!nativePaths || !nativePaths.length) return
          localPath = nativePaths[0]
        }
        const destPath = joinPath(currentDirRef.current, file.name)
        showToast(`Uploading ${file.name} (${isPrivate ? 'Private' : 'Public'})…`)
        await rpc('upload', { localPath, destPath, mime: file.type || null, isPrivate })
      }
      showToast('Upload complete')
      await refreshFiles()
      rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
    },
    [refreshFiles, setStatus, showToast]
  )

  const navigate = useCallback(
    (name: NavName) => {
      setCurrentNav(name)
      setDetailOpen(false)
      if (name === 'files') {
        refreshFiles().catch((err) => showToast(err.message))
      }
    },
    [refreshFiles, showToast]
  )

  const mkdir = useCallback(
    async (name: string) => {
      await rpc('mkdir', { path: joinPath(currentDirRef.current, assertEntryName(name)) })
      await refreshFiles()
    },
    [refreshFiles]
  )

  const [previewModal, setPreviewModal] = useState<PreviewModalState>({
    open: false,
    name: '',
    url: null,
    mime: null,
    content: null,
    error: null,
    loading: false,
    supported: true,
    byteLength: 0
  })

  const closePreviewModal = useCallback(() => {
    setPreviewModal((p) => {
      if (p.url) {
        try {
          URL.revokeObjectURL(p.url)
        } catch {}
      }
      return { open: false, name: '', url: null, mime: null, content: null, error: null, loading: false, supported: true, byteLength: 0 }
    })
  }, [])

  const previewSelected = useCallback(async () => {
    if (!selectedEntry) return
    const name = selectedEntry.path.split('/').filter(Boolean).pop() || 'file'
    setPreviewModal({
      open: true,
      name,
      url: null,
      mime: null,
      content: null,
      error: null,
      loading: true,
      supported: true,
      byteLength: 0
    })

    try {
      const res = await rpc<{
        supported: boolean
        isText?: boolean
        content?: string
        data?: string
        mime: string
        name: string
        byteLength: number
      }>('preview', { path: selectedEntry.path })

      if (!res.supported) {
        setPreviewModal({
          open: true,
          name: res.name || name,
          url: null,
          mime: res.mime || null,
          content: null,
          error: null,
          loading: false,
          supported: false,
          byteLength: res.byteLength || 0
        })
        return
      }

      if (res.isText) {
        setPreviewModal({
          open: true,
          name: res.name || name,
          url: null,
          mime: res.mime || null,
          content: res.content || '',
          error: null,
          loading: false,
          supported: true,
          byteLength: res.byteLength || 0
        })
        return
      }

      if (res.data) {
        const binaryStr = atob(res.data)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }
        let blobType = res.mime || 'application/octet-stream'
        const lowerName = (res.name || name).toLowerCase()
        if (lowerName.endsWith('.mkv') && (!res.mime || res.mime === 'video/x-matroska')) {
          blobType = 'video/webm'
        }
        const blob = new Blob([bytes], { type: blobType })
        const blobUrl = URL.createObjectURL(blob)

        setPreviewModal({
          open: true,
          name: res.name || name,
          url: blobUrl,
          mime: res.mime || null,
          content: null,
          error: null,
          loading: false,
          supported: true,
          byteLength: res.byteLength || 0
        })
        return
      }

      setPreviewModal({
        open: true,
        name: res.name || name,
        url: null,
        mime: res.mime || null,
        content: null,
        error: null,
        loading: false,
        supported: false,
        byteLength: res.byteLength || 0
      })
    } catch (err: any) {
      setPreviewModal({
        open: true,
        name,
        url: null,
        mime: null,
        content: null,
        error: err instanceof Error ? err.message : String(err),
        loading: false,
        supported: false,
        byteLength: 0
      })
    }
  }, [selectedEntry])

  const downloadSelected = useCallback(async () => {
    if (!selectedEntry) return
    const name = selectedEntry.path.split('/').filter(Boolean).pop() || 'download'
    const dest = await getBridge().chooseDownloadPath(name)
    if (!dest) return
    const result = await rpc<{ verified?: boolean }>('download', {
      path: selectedEntry.path,
      destLocalPath: dest
    })
    if (result?.verified === false) {
      showToast('Downloaded, but chunk hashes did not match')
    } else {
      showToast('Downloaded')
    }
  }, [selectedEntry, showToast])

  const deleteSelected = useCallback(async () => {
    if (!selectedEntry) return
    const ok = await askConfirm('Delete file?', selectedEntry.path)
    if (!ok) return
    try {
      await rpc('delete', { path: selectedEntry.path })
      showToast('File deleted')
      closeDetail()
      await refreshFiles()
      rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
    } catch (err: any) {
      showToast(err?.message || 'Delete failed')
    }
  }, [askConfirm, closeDetail, refreshFiles, selectedEntry, setStatus, showToast])

  const setCurrentDir = useCallback((dir: string) => {
    setCurrentDirState(dir)
    currentDirRef.current = dir
  }, [])

  return {
    currentNav,
    setCurrentNav,
    currentDir,
    setCurrentDir,
    entries,
    setEntries,
    selectedEntry,
    setSelectedEntry,
    detailOpen,
    detailName,
    detailMeta,
    chunkList,
    dragging,
    setDragging,
    refreshFiles,
    showDetail,
    closeDetail,
    onEntryClick,
    uploadPaths,
    uploadFiles,
    navigate,
    mkdir,
    previewModal,
    closePreviewModal,
    previewSelected,
    downloadSelected,
    deleteSelected
  }
}
