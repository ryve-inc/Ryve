/**
 * FilesScreen.tsx
 *
 * Main file browser — lists vault contents, supports upload via
 * react-native-document-picker, download, mkdir, and delete.
 *
 * Network / battery mitigations applied here:
 *   - Upload disabled when no peers connected (state.status.peers === 0)
 *   - Download shows peer count warning when 0 peers
 *   - Foreground Service is started via NativeModules.ForegroundService on upload/download
 */
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  ScrollView
} from 'react-native'
import DocumentPicker from 'react-native-document-picker'
import RNFS from 'react-native-fs'
import type { DriveEntry } from '../../../shared/types'
import { useDrive } from '../context/drive-context-mobile'

const C = {
  bg: '#0b0c12',
  surface: '#161927',
  border: '#232739',
  leaf: '#c6f24e',
  iris: '#7c6cff',
  mute: '#8a90a6',
  soft: '#b6bbd0',
  danger: '#ff6b6b',
  white: '#ffffff'
}

// ─── Foreground service helper (Android) ─────────────────────────────────
// ForegroundService native module is implemented in DriveModule.kt (below).
// It wraps a minimal Foreground Service with a persistent notification so
// Android Doze Mode cannot kill the P2P worker during active transfers.
function startFg(title: string) {
  if (Platform.OS === 'android' && NativeModules.DriveModule) {
    NativeModules.DriveModule.startForeground(title)
  }
}
function stopFg() {
  if (Platform.OS === 'android' && NativeModules.DriveModule) {
    NativeModules.DriveModule.stopForeground()
  }
}

// ─── File Row ────────────────────────────────────────────────────────────
function FileRow({
  entry,
  onPress,
  onLongPress
}: {
  entry: DriveEntry
  onPress: () => void
  onLongPress: () => void
}) {
  const icon = entry.isDirectory ? '📁' : '📄'
  const size = entry.isDirectory
    ? ''
    : entry.byteLength > 1024 * 1024
    ? (entry.byteLength / 1024 / 1024).toFixed(1) + ' MB'
    : entry.byteLength > 1024
    ? (entry.byteLength / 1024).toFixed(0) + ' KB'
    : entry.byteLength + ' B'

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.7}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{entry.name}</Text>
        {size ? <Text style={styles.rowSize}>{size}</Text> : null}
      </View>
      {!entry.isDirectory && <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
  )
}

// ─── Name input modal ─────────────────────────────────────────────────────
function InputModal({
  visible,
  title,
  placeholder,
  onConfirm,
  onCancel
}: {
  visible: boolean
  title: string
  placeholder: string
  onConfirm: (v: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TextInput
            style={styles.modalInput}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={C.mute}
            autoFocus
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={() => { onConfirm(value); setValue('') }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: C.leaf }]}
              onPress={() => { onConfirm(value); setValue('') }}>
              <Text style={{ color: C.bg, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }]}
              onPress={onCancel}>
              <Text style={{ color: C.soft }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─── Detail sheet  ────────────────────────────────────────────────────────
function DetailSheet({
  entry,
  onClose,
  onDownload,
  onDelete
}: {
  entry: DriveEntry | null
  onClose: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  if (!entry) return null
  const chunkCount = entry.chunkCount || 0
  return (
    <Modal visible={!!entry} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.heading}>📄 {entry.name}</Text>
          <Text style={styles.metaRow}>
            {entry.byteLength > 0 ? (entry.byteLength / 1024).toFixed(1) + ' KB' : '0 B'}
            {chunkCount > 0 ? `  ·  ${chunkCount} chunks` : ''}
          </Text>
          <Text style={styles.metaLabel}>Vault path</Text>
          <Text style={styles.metaValue}>{entry.path}</Text>

          <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: C.leaf }]} onPress={onDownload}>
            <Text style={{ color: C.bg, fontWeight: '700', fontSize: 15 }}>Download</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: C.danger }]} onPress={onDelete}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sheetClose} onPress={onClose}>
            <Text style={{ color: C.mute }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ─── Header / topbar ──────────────────────────────────────────────────────
function TopBar({ onMkdir, onUpload, peers }: { onMkdir: () => void; onUpload: () => void; peers: number }) {
  return (
    <View style={styles.topbar}>
      <View style={{ flex: 1 }}>
        <Text style={styles.topbarTitle}>My Drive</Text>
        <Text style={styles.topbarSub}>
          <View style={[styles.dot, { backgroundColor: peers > 0 ? C.leaf : C.mute }]} />
          {' '}{peers} peer{peers === 1 ? '' : 's'}
        </Text>
      </View>
      <TouchableOpacity style={styles.iconBtn} onPress={onMkdir}>
        <Text style={styles.iconBtnText}>＋📁</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.iconBtn, { backgroundColor: C.leaf }]} onPress={onUpload}>
        <Text style={[styles.iconBtnText, { color: C.bg }]}>↑ Upload</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────
function Breadcrumb({ dir, setDir }: { dir: string; setDir: (d: string) => void }) {
  if (dir === '/') return null
  const parent = dir.substring(0, dir.lastIndexOf('/')) || '/'
  return (
    <TouchableOpacity onPress={() => setDir(parent)} style={styles.breadcrumb}>
      <Text style={{ color: C.iris }}>← {parent === '/' ? 'Root' : parent.split('/').pop()}</Text>
    </TouchableOpacity>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────
function EmptyState({ uploading }: { uploading: boolean }) {
  return (
    <View style={styles.empty}>
      {uploading ? (
        <>
          <ActivityIndicator color={C.iris} size="large" />
          <Text style={styles.emptyText}>Uploading…</Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 40 }}>📂</Text>
          <Text style={styles.emptyText}>No files yet</Text>
          <Text style={styles.emptyHint}>Tap ↑ Upload to add files</Text>
        </>
      )}
    </View>
  )
}

// ─── Root Screen ─────────────────────────────────────────────────────────
export function FilesScreen() {
  const {
    status, entries, currentDir, refreshFiles, setCurrentDir,
    uploadLocalFile, downloadFile, deleteFile, mkdir, uploading, downloading
  } = useDrive()

  const [mkdirVisible, setMkdirVisible] = useState(false)
  const [selected, setSelected] = useState<DriveEntry | null>(null)

  async function handleUpload() {
    if (status.peers === 0) {
      Alert.alert(
        'No peers connected',
        'Files are encrypted and stored on P2P peers. Connect to at least one peer before uploading.',
        [{ text: 'OK' }]
      )
      return
    }
    try {
      const result = await DocumentPicker.pickSingle({ presentationStyle: 'fullScreen' })
      const localPath = result.uri.replace('file://', '')
      startFg('Uploading ' + result.name)
      await uploadLocalFile(localPath, result.type || null)
    } catch (e) {
      if (!DocumentPicker.isCancel(e)) {
        Alert.alert('Upload error', e instanceof Error ? e.message : String(e))
      }
    } finally {
      stopFg()
    }
  }

  async function handleDownload() {
    if (!selected) return
    if (status.peers === 0) {
      Alert.alert(
        'No peers',
        'No peers connected. File chunks live on peer devices — connect to them first.'
      )
      return
    }
    const fileName = selected.name
    const destPath = RNFS.DownloadDirectoryPath + '/' + fileName
    startFg('Downloading ' + fileName)
    try {
      await downloadFile(selected.path, destPath)
      setSelected(null)
    } catch (e) {
      Alert.alert('Download error', e instanceof Error ? e.message : String(e))
    } finally {
      stopFg()
    }
  }

  async function handleDelete() {
    if (!selected) return
    Alert.alert('Delete file?', selected.path, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFile(selected.path)
            setSelected(null)
          } catch (e) {
            Alert.alert('Delete error', e instanceof Error ? e.message : String(e))
          }
        }
      }
    ])
  }

  function handleEntryPress(entry: DriveEntry) {
    if (entry.isDirectory) {
      setCurrentDir(entry.path)
      refreshFiles()
    } else {
      setSelected(entry)
    }
  }

  return (
    <View style={styles.root}>
      <TopBar onMkdir={() => setMkdirVisible(true)} onUpload={handleUpload} peers={status.peers} />
      <Breadcrumb dir={currentDir} setDir={(d) => { setCurrentDir(d); refreshFiles() }} />

      {(uploading || downloading) && (
        <View style={styles.progressBar}>
          <ActivityIndicator color={C.leaf} size="small" />
          <Text style={{ color: C.leaf, marginLeft: 8, fontSize: 13 }}>
            {uploading ? 'Offloading encrypted chunks to peers…' : 'Fetching chunks from peers…'}
          </Text>
        </View>
      )}

      <FlatList
        data={entries}
        keyExtractor={(e) => e.path}
        renderItem={({ item }) => (
          <FileRow
            entry={item}
            onPress={() => handleEntryPress(item)}
            onLongPress={() => !item.isDirectory && setSelected(item)}
          />
        )}
        ListEmptyComponent={<EmptyState uploading={uploading} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        onRefresh={refreshFiles}
        refreshing={false}
      />

      <InputModal
        visible={mkdirVisible}
        title="New folder"
        placeholder="folder name"
        onConfirm={async (name) => {
          setMkdirVisible(false)
          try { await mkdir(name) } catch (e) { Alert.alert('Error', e instanceof Error ? e.message : String(e)) }
        }}
        onCancel={() => setMkdirVisible(false)}
      />

      <DetailSheet
        entry={selected}
        onClose={() => setSelected(null)}
        onDownload={handleDownload}
        onDelete={handleDelete}
      />
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: C.border,
    gap: 8
  },
  topbarTitle: { fontSize: 20, fontWeight: '700', color: C.white },
  topbarSub: { fontSize: 12, color: C.mute, flexDirection: 'row', alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  iconBtn: {
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border
  },
  iconBtnText: { color: C.soft, fontSize: 13, fontWeight: '600' },
  breadcrumb: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: C.border
  },
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(124,108,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: C.border
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginVertical: 4,
    gap: 12
  },
  rowIcon: { fontSize: 24 },
  rowName: { color: C.white, fontSize: 15, fontWeight: '500' },
  rowSize: { color: C.mute, fontSize: 12, marginTop: 2 },
  chevron: { color: C.mute, fontSize: 20 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { color: C.soft, fontSize: 16, fontWeight: '600' },
  emptyHint: { color: C.mute, fontSize: 13 },
  heading: { fontSize: 18, fontWeight: '700', color: C.white, marginBottom: 4 },
  metaRow: { color: C.mute, fontSize: 13, marginBottom: 8 },
  metaLabel: { color: C.mute, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  metaValue: { color: C.soft, fontSize: 12, fontFamily: 'monospace' },
  sheetBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginVertical: 4 },
  sheetClose: { alignItems: 'center', paddingVertical: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#11131c', borderRadius: 20, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12 },
  modalTitle: { color: C.white, fontWeight: '700', fontSize: 17 },
  modalInput: { backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, color: C.white },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#11131c', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: C.border, padding: 24, gap: 8 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 12 }
})
