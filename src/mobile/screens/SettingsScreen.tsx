/**
 * SettingsScreen.tsx
 * Blind peer key management + identity display + logout.
 */
import React, { useState } from 'react'
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native'
import { useDrive } from '../context/drive-context-mobile'

const C = {
  bg: '#0b0c12', surface: '#161927', border: '#232739',
  leaf: '#c6f24e', iris: '#7c6cff', mute: '#8a90a6',
  soft: '#b6bbd0', danger: '#ff6b6b', white: '#ffffff'
}

export function SettingsScreen() {
  const { status, saveBlindPeers, logout } = useDrive()
  const [blindKeys, setBlindKeys] = useState(status.blindPeerKeys.join('\n'))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await saveBlindPeers(blindKeys)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function handleLogout() {
    Alert.alert('Log out?', 'Your drive stays encrypted on the network. You can unlock it again with your recovery key.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() }
    ])
  }

  const id = status.identity
  const shortId = id ? id.slice(0, 16) + '…' + id.slice(-12) : 'Unknown'

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 20, gap: 20 }}>
      <Text style={styles.title}>Settings</Text>

      {/* Identity */}
      <View style={styles.card}>
        <Text style={styles.label}>Your identity</Text>
        <Text style={styles.mono}>{shortId}</Text>
        {status.driveKey && (
          <>
            <Text style={[styles.label, { marginTop: 12 }]}>Drive key</Text>
            <Text style={styles.mono}>{status.driveKey.slice(0, 20)}…</Text>
          </>
        )}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
          <View style={[styles.badge, { backgroundColor: status.peers > 0 ? 'rgba(198,242,78,0.15)' : 'rgba(138,144,166,0.15)' }]}>
            <View style={[styles.dot, { backgroundColor: status.peers > 0 ? C.leaf : C.mute }]} />
            <Text style={{ color: status.peers > 0 ? C.leaf : C.mute, fontSize: 13, marginLeft: 6 }}>
              {status.peers} peer{status.peers === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
      </View>

      {/* Blind peers */}
      <View style={styles.card}>
        <Text style={styles.sectionHeading}>Blind peer keys</Text>
        <Text style={styles.body}>
          Blind peers store your encrypted chunks without seeing your files or keys.
          Enter one public key per line.
        </Text>
        <TextInput
          style={styles.textarea}
          value={blindKeys}
          onChangeText={setBlindKeys}
          multiline
          numberOfLines={4}
          placeholder="paste peer key here…"
          placeholderTextColor={C.mute}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: saving ? C.mute : C.leaf }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={{ color: C.bg, fontWeight: '700' }}>{saving ? 'Saving…' : 'Save blind peers'}</Text>
        </TouchableOpacity>
      </View>

      {/* Logout */}
      <TouchableOpacity style={[styles.btn, { backgroundColor: 'rgba(255,107,107,0.15)', borderWidth: 1, borderColor: C.danger }]} onPress={handleLogout}>
        <Text style={{ color: C.danger, fontWeight: '700' }}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  title: { fontSize: 24, fontWeight: '700', color: C.white, marginBottom: 4 },
  card: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 18, gap: 6 },
  label: { fontSize: 11, color: C.mute, letterSpacing: 1, textTransform: 'uppercase' },
  sectionHeading: { fontSize: 16, fontWeight: '700', color: C.white },
  body: { fontSize: 13, color: C.soft, lineHeight: 19 },
  mono: { fontFamily: 'monospace', color: C.soft, fontSize: 13 },
  textarea: { backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12, color: C.white, fontFamily: 'monospace', fontSize: 12, textAlignVertical: 'top', minHeight: 90 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 }
})
