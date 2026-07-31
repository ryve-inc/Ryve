/**
 * AuthScreen.tsx
 * Handles boot → home → create → confirm → unlock auth flow.
 */
import React, { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  Clipboard
} from 'react-native'
import { useDrive } from '../context/drive-context-mobile'

const C = {
  bg: '#0b0c12',
  surface: '#11131c',
  border: '#232739',
  leaf: '#c6f24e',
  iris: '#7c6cff',
  mute: '#8a90a6',
  soft: '#b6bbd0',
  danger: '#ff6b6b',
  white: '#ffffff'
}

// ─── Shared primitives ────────────────────────────────────────────────────
function PrimaryButton({
  label,
  onPress,
  loading = false,
  danger = false
}: {
  label: string
  onPress: () => void
  loading?: boolean
  danger?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, danger ? styles.btnDanger : styles.btnPrimary]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color="#0b0c12" size="small" />
      ) : (
        <Text style={[styles.btnText, danger && { color: '#0b0c12' }]}>{label}</Text>
      )}
    </TouchableOpacity>
  )
}

function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.ghostBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.ghostBtnText}>{label}</Text>
    </TouchableOpacity>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>
}

// ─── Boot Panel ───────────────────────────────────────────────────────────
function BootPanel() {
  return (
    <View style={styles.centered}>
      <View style={styles.logoBadge}>
        <Text style={styles.logoGlyph}>✦</Text>
      </View>
      <Text style={styles.displayTitle}>Drive</Text>
      <Text style={styles.subtitle}>Starting…</Text>
      <ActivityIndicator color={C.iris} style={{ marginTop: 24 }} />
    </View>
  )
}

// ─── Home Panel ───────────────────────────────────────────────────────────
function HomePanel() {
  const { createAccount, setAuthPanel } = useDrive()
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    setLoading(true)
    try {
      await createAccount()
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <View style={styles.logoBadge}>
        <Text style={styles.logoGlyph}>✦</Text>
      </View>
      <Text style={styles.displayTitle}>Drive</Text>
      <Text style={[styles.subtitle, { marginBottom: 24 }]}>
        P2P encrypted file storage
      </Text>
      <PrimaryButton label="Create new Drive" onPress={handleCreate} loading={loading} />
      <GhostButton label="Unlock existing Drive" onPress={() => setAuthPanel('unlock')} />
    </Card>
  )
}

// ─── Create Panel (show mnemonic) ─────────────────────────────────────────
function CreatePanel() {
  const { pendingMnemonic, setAuthPanel } = useDrive()
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    Clipboard.setString(pendingMnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <Text style={styles.heading}>Your recovery key</Text>
      <Text style={styles.body}>
        Write down these 24 words. They are the only way to access your drive.
        Never share them with anyone.
      </Text>
      <View style={styles.mnemonicBox}>
        <Text style={styles.mnemonicText}>{pendingMnemonic}</Text>
      </View>
      <PrimaryButton label={copied ? 'Copied ✓' : 'Copy to clipboard'} onPress={handleCopy} />
      <GhostButton label="I've saved it →" onPress={() => setAuthPanel('confirm')} />
    </Card>
  )
}

// ─── Confirm Panel ────────────────────────────────────────────────────────
function ConfirmPanel() {
  const { confirmCreateAccount, setAuthPanel } = useDrive()
  const [typed, setTyped] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    try {
      await confirmCreateAccount(typed)
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <Text style={styles.heading}>Verify recovery key</Text>
      <Text style={styles.body}>
        Type your 24-word recovery key to confirm you have saved it.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="word1 word2 word3 …"
        placeholderTextColor={C.mute}
        value={typed}
        onChangeText={setTyped}
        multiline
        numberOfLines={4}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      <PrimaryButton label="Confirm & open Drive" onPress={handleConfirm} loading={loading} />
      <GhostButton label="← Back" onPress={() => setAuthPanel('create')} />
    </Card>
  )
}

// ─── Unlock Panel ─────────────────────────────────────────────────────────
function UnlockPanel() {
  const { unlock, setAuthPanel } = useDrive()
  const [mnemonic, setMnemonic] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleUnlock() {
    setLoading(true)
    try {
      await unlock(mnemonic)
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <Text style={styles.heading}>Unlock Drive</Text>
      <Text style={styles.body}>Enter your 24-word recovery key.</Text>
      <TextInput
        style={styles.input}
        placeholder="word1 word2 word3 …"
        placeholderTextColor={C.mute}
        value={mnemonic}
        onChangeText={setMnemonic}
        multiline
        numberOfLines={4}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      <PrimaryButton label="Unlock" onPress={handleUnlock} loading={loading} />
      <GhostButton label="← Back" onPress={() => setAuthPanel('home')} />
    </Card>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────
export function AuthScreen() {
  const { authPanel } = useDrive()

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {authPanel === 'boot' && <BootPanel />}
      {authPanel === 'home' && <HomePanel />}
      {authPanel === 'create' && <CreatePanel />}
      {authPanel === 'confirm' && <ConfirmPanel />}
      {authPanel === 'unlock' && <UnlockPanel />}
    </ScrollView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
    gap: 12
  },
  logoBadge: {
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.leaf,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  logoGlyph: { fontSize: 22, color: C.bg, fontWeight: '700' },
  displayTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: C.white,
    textAlign: 'center',
    letterSpacing: -0.5
  },
  heading: { fontSize: 20, fontWeight: '700', color: C.white, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, color: C.mute, textAlign: 'center' },
  body: { fontSize: 14, color: C.soft, lineHeight: 20 },
  mnemonicBox: {
    backgroundColor: 'rgba(11,12,18,0.65)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16
  },
  mnemonicText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: C.soft,
    lineHeight: 22
  },
  input: {
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    color: C.white,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
    textAlignVertical: 'top',
    minHeight: 100
  },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  btnPrimary: { backgroundColor: C.leaf },
  btnDanger: { backgroundColor: C.danger },
  btnText: { fontWeight: '700', fontSize: 15, color: C.bg, letterSpacing: 0.2 },
  ghostBtn: { alignItems: 'center', paddingVertical: 10 },
  ghostBtnText: { color: C.mute, fontSize: 14 }
})
