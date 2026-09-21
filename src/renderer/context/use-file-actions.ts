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
    async (path: string) => {
      const requestId = ++detailRequestId.current
      setDetailOpen(true)
      setDetailName(path.split('/').filter(Boolean).pop() || path)
      setChunkList('Loading…')
      try {
        const manifest = await rpc<ChunkManifest>('getChunkManifest', { path })
        if (requestId !== detailRequestId.current) return
        setDetailMeta(`${formatBytes(manifest.byteLength)} · ${manifest.chunks.length} chunks`)
        setChunkList(
          manifest.chunks
            .map((c) => `#${c.index}  ${c.hash}\n  offset=${c.offset}  len=${c.length}`)
            .join('\n\n')
        )
        setSelectedEntry({
          path,
          source: 'vault',
          manifest
        })
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
      setSelectedEntry({ ...entry, source: 'vault' })
      await showDetail(entry.path)
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
    error: null
  })

  const closePreviewModal = useCallback(() => {
    setPreviewModal((p) => {
      if (p.url) URL.revokeObjectURL(p.url)
      return { open: false, name: '', url: null, mime: null, content: null, error: null }
    })
  }, [])

  const previewSelected = useCallback(async () => {
    if (!selectedEntry) return
    const name = selectedEntry.path.split('/').filter(Boolean).pop() || 'file'
    showToast('Fetching chunks from network peers…')
    setPreviewModal({ open: true, name, url: null, mime: null, content: null, error: null })
    try {
      const dest = await getBridge().chooseDownloadPath(name)
      if (!dest) {
        closePreviewModal()
        return
      }
      await rpc<{ verified?: boolean }>('download', {
        path: selectedEntry.path,
        destLocalPath: dest
      })
      showToast('File downloaded & verified!')
      closePreviewModal()
    } catch (err) {
      setPreviewModal({
        open: true,
        name,
        url: null,
        mime: null,
        content: null,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }, [closePreviewModal, selectedEntry, showToast])

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
    if (!selectedEntry || selectedEntry.source !== 'vault') {
      showToast('Delete is only available in My Drive')
      return
    }
    const ok = await askConfirm('Delete file?', selectedEntry.path)
    if (!ok) return
    await rpc('delete', { path: selectedEntry.path })
    closeDetail()
    await refreshFiles()
    rpc<AppStatus>('getStatus').then((s) => setStatus((prev) => ({ ...prev, ...s }))).catch(() => {})
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
