import type { AppStatus, ChunkManifest, DriveEntry } from '../../shared/types.ts'

export type AuthPanel = 'boot' | 'home' | 'name' | 'create' | 'confirm' | 'unlock'
export type NavName = 'home' | 'files' | 'shared' | 'settings'

export type SelectedEntry = {
  path: string
  source: 'vault' | 'share'
  shareId?: string | null
  manifest?: ChunkManifest
}

export type InviteModalState = {
  open: boolean
  title: string
  body: string
  invite: string
}

export type PromptMode = 'text' | 'confirm' | 'choice'

export type PromptChoice = { label: string; value: string }

export type PromptState = {
  open: boolean
  title: string
  body: string
  defaultValue: string
  okLabel: string
  cancelLabel: string
  mode: PromptMode
  choices: PromptChoice[]
}

export type PreviewModalState = {
  open: boolean
  name: string
  url: string | null
  mime: string | null
  content: string | null
  error: string | null
}

export type DriveContextValue = {
  status: AppStatus
  view: 'auth' | 'app'
  authPanel: AuthPanel
  authFlowActive: boolean
  pendingMnemonic: string
  displayName: string
  setDisplayName: (val: string) => void
  currentNav: NavName
  currentDir: string
  entries: DriveEntry[]
  selectedEntry: SelectedEntry | null
  detailOpen: boolean
  detailName: string
  detailMeta: string
  chunkList: string
  toast: string | null
  prompt: PromptState
  dragging: boolean
  createNetworkModal: { open: boolean; inviteLink: string }
  joinNetworkModal: { open: boolean }
  networkInfoModal: { open: boolean }
  networkSettingsModal: { open: boolean; networkId: string | null }
  setDragging: (value: boolean) => void
  showToast: (msg: string) => void
  setAuthPanel: (panel: AuthPanel) => void
  setPendingMnemonic: (value: string) => void
  setAuthFlowActive: (value: boolean) => void
  navigate: (name: NavName) => void
  refreshFiles: () => Promise<void>
  setCurrentDir: (dir: string) => void
  onEntryClick: (entry: DriveEntry) => Promise<void>
  showDetail: (path: string) => Promise<void>
  closeDetail: () => void
  uploadPaths: (opts?: { isPrivate?: boolean }) => Promise<void>
  uploadFiles: (fileList: FileList | File[], opts?: { isPrivate?: boolean }) => Promise<void>
  switchNetwork: (id: string) => Promise<void>
  removeNetwork: (id: string) => Promise<void>
  askDialog: (opts: {
    title: string
    body?: string
    defaultValue?: string
    okLabel?: string
    cancelLabel?: string
    mode?: PromptMode
    choices?: PromptChoice[]
  }) => Promise<string | boolean | null>
  askText: (title: string, defaultValue?: string, body?: string) => Promise<string | null>
  askConfirm: (title: string, body?: string) => Promise<boolean>
  closePrompt: (value: string | boolean | null) => void
  resolveAuth: (unlocked: boolean, nextStatus?: AppStatus | null) => void
  showAuthHome: () => void
  showApp: () => void
  createNetwork: (name?: string) => Promise<unknown>
  joinNetwork: (link: string) => Promise<void>
  openCreateNetworkModal: (inviteLink: string) => void
  closeCreateNetworkModal: () => void
  openJoinNetworkModal: () => void
  closeJoinNetworkModal: () => void
  openNetworkInfoModal: () => void
  closeNetworkInfoModal: () => void
  openNetworkSettingsModal: (networkId: string) => void
  closeNetworkSettingsModal: () => void
  createAccount: (name?: string) => Promise<void>
  confirmCreateAccount: (typed: string) => Promise<void>
  unlock: (mnemonic: string) => Promise<void>
  logout: () => Promise<void>
  saveBlindPeers: (keysText: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
  downloadSelected: () => Promise<void>
  previewSelected: () => Promise<void>
  previewModal: PreviewModalState
  closePreviewModal: () => void
  deleteSelected: () => Promise<void>
  copyClipboard: (text: string) => void
  setStorageQuota: (mode: 'limited' | 'all', quotaBytes?: number) => Promise<void>
  setNetworkStorageAllocation: (networkId: string, allocatedBytes: number) => Promise<void>
}

export const emptyStatus: AppStatus = {
  unlocked: false,
  identity: null,
  displayName: null,
  driveKey: null,
  peers: 0,
  blindPeerKeys: [],
  network: {
    networkLink: null,
    networkKeyHex: null,
    topicHex: null,
    joined: false,
    activeId: null,
    networks: []
  },
  storage: {
    totalAllocatedBytes: 0,
    totalUsedBytes: 0,
    totalFreeDiskBytes: 50 * 1024 * 1024 * 1024,
    remainingDriveBytes: 50 * 1024 * 1024 * 1024,
    reservedSystemBytes: 2 * 1024 * 1024 * 1024,
    networks: {}
  }
}

export const closedInvite: InviteModalState = {
  open: false,
  title: '',
  body: '',
  invite: ''
}

export const closedPrompt: PromptState = {
  open: false,
  title: '',
  body: '',
  defaultValue: '',
  okLabel: 'OK',
  cancelLabel: 'Cancel',
  mode: 'text',
  choices: []
}
