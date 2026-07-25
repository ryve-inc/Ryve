/**
 * App.tsx — mobile root
 * Routes between AuthScreen and the main tab navigator (Files / Settings).
 */
import React from 'react'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { DriveProvider, useDrive } from './context/drive-context-mobile'
import { AuthScreen } from './screens/AuthScreen'
import { FilesScreen } from './screens/FilesScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { Toast } from './components/Toast'

const C = { bg: '#0b0c12', border: '#232739', iris: '#7c6cff', leaf: '#c6f24e', mute: '#8a90a6', soft: '#b6bbd0', white: '#ffffff' }

// Simple 2-tab bottom nav (no heavy nav library needed)
type Tab = 'files' | 'settings'

function AppTabs() {
  const [tab, setTab] = React.useState<Tab>('files')
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === 'files' && <FilesScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>
      <View style={styles.tabBar}>
        <TabBtn label="📂  Files" active={tab === 'files'} onPress={() => setTab('files')} />
        <TabBtn label="⚙️  Settings" active={tab === 'settings'} onPress={() => setTab('settings')} />
      </View>
    </View>
  )
}

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tabBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      {active && <View style={styles.tabIndicator} />}
    </TouchableOpacity>
  )
}

function AppViews() {
  const { view, toast } = useDrive()
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {view === 'auth' ? <AuthScreen /> : <AppTabs />}
      {toast && <Toast message={toast} />}
    </SafeAreaView>
  )
}

export function App() {
  return (
    <SafeAreaProvider>
      <DriveProvider>
        <AppViews />
      </DriveProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#11131c',
    borderTopWidth: 1,
    borderColor: C.border,
    paddingBottom: 8
  },
  tabBtn: { flex: 1, alignItems: 'center', paddingTop: 12, paddingBottom: 4, position: 'relative' },
  tabLabel: { fontSize: 13, color: C.mute, fontWeight: '500' },
  tabLabelActive: { color: C.white, fontWeight: '700' },
  tabIndicator: { position: 'absolute', bottom: 0, width: 32, height: 2, borderRadius: 1, backgroundColor: C.leaf }
})
