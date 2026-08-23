import electron from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import PearRuntime from 'pear-runtime'
import FramedStream from 'framed-stream'
import whichRuntime from 'which-runtime'
import paparam from 'paparam'

const { app, BrowserWindow, ipcMain, dialog, clipboard } = electron
const { isMac, isLinux, isWindows } = whichRuntime
const { command, flag } = paparam

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = require('../../package.json') as {
  name: string
  productName?: string
  version: string
  upgrade: string
}

const { name, productName, version, upgrade } = pkg
const protocol = name
const mainWorkerSpecifier = '/workers/main.cjs'
const workers = new Map<string, InstanceType<typeof FramedStream>>()
const appName = productName ?? name

const cmd = command(
  appName,
  flag('--storage <dir>', 'pass custom storage to pear-runtime'),
  flag('--no-updates', 'start without OTA updates'),
  flag('--no-sandbox', 'start without Chromium sandbox').hide()
)

cmd.parse(app.isPackaged ? process.argv.slice(1) : process.argv.slice(2))

const rawPearStore = cmd.flags.storage as string | undefined
const pearStore = rawPearStore ? path.resolve(rawPearStore) : undefined
const updates = cmd.flags.updates

if (pearStore) app.setPath('userData', pearStore)

function getAppPath(): string | null {
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function sendToAll(channel: string, data: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  }
}

function resolveWorkerEntry(specifier: string) {
  if (specifier !== mainWorkerSpecifier) {
    throw new Error('Invalid worker specifier')
  }
  const root = path.resolve(__dirname, '..')
  const entry = path.resolve(root, 'workers', 'main.cjs')
  const rel = path.relative(root, entry)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Worker path escapes application root')
  }
  return entry
}

function getWorker(specifier: string) {
  if (workers.has(specifier)) return workers.get(specifier)!

  const appPath = getAppPath()
  let dir: string
  if (pearStore) {
    console.log('pear store: ' + pearStore)
    dir = pearStore
  } else if (appPath === null) {
    dir = path.join(os.tmpdir(), 'pear', appName)
  } else {
    const isSnap = !!process.env.SNAP_USER_COMMON
    const linuxConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    dir = isMac
      ? path.join(os.homedir(), 'Library', 'Application Support', appName)
      : isLinux
        ? isSnap
          ? path.join(process.env.SNAP_USER_COMMON!, appName)
          : path.join(linuxConfigHome, appName)
        : path.join(os.homedir(), 'AppData', 'Roaming', appName)
  }

  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'
  const entry = resolveWorkerEntry(specifier)

  const worker = PearRuntime.run(entry, [
    updates,
    version,
    upgrade,
    (productName || name) + extension,
    dir,
    appPath
  ])
  const pipe = new FramedStream(worker)

  const sendWorkerStdout = (data: Buffer) => {
    process.stdout.write(data)
    sendToAll('pear:worker:stdout:' + specifier, data)
  }
  const sendWorkerStderr = (data: Buffer) => {
    process.stderr.write(data)
    sendToAll('pear:worker:stderr:' + specifier, data)
  }
  const sendWorkerIPC = (data: Buffer) => sendToAll('pear:worker:ipc:' + specifier, data)
  const onBeforeQuit = () => pipe.destroy()

  ipcMain.handle('pear:worker:writeIPC:' + specifier, (_evt, data) => pipe.write(data))
  workers.set(specifier, pipe)
  pipe.on('data', sendWorkerIPC)
  worker.stdout.on('data', sendWorkerStdout)
  worker.stderr.on('data', sendWorkerStderr)
  worker.once('exit', (code: number) => {
    app.removeListener('before-quit', onBeforeQuit)
    ipcMain.removeHandler('pear:worker:writeIPC:' + specifier)
    pipe.removeListener('data', sendWorkerIPC)
    worker.stdout.removeListener('data', sendWorkerStdout)
    worker.stderr.removeListener('data', sendWorkerStderr)
    sendToAll('pear:worker:exit:' + specifier, code)
    workers.delete(specifier)
  })
  app.on('before-quit', onBeforeQuit)
  return pipe
}

ipcMain.handle('dialog:savePath', async (evt, defaultName?: string) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  const ext = defaultName && defaultName.includes('.') ? defaultName.split('.').pop() : null
  const options: Electron.SaveDialogOptions = {
    title: 'Download File',
    defaultPath: defaultName || 'download',
    filters: ext
      ? [
          { name: `${ext.toUpperCase()} File (*.${ext})`, extensions: [ext] },
          { name: 'All Files (*.*)', extensions: ['*'] }
        ]
      : undefined
  }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  let filePath = result.filePath
  if (ext && !path.extname(filePath)) {
    filePath += '.' + ext
  }
  return filePath
})

ipcMain.handle('dialog:openFile', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender)
  const options: Electron.OpenDialogOptions = {
    title: 'Select File to Upload',
    properties: ['openFile', 'multiSelections']
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths) return []
  return result.filePaths
})

ipcMain.handle('clipboard:write', (_evt, text: string) => {
  clipboard.writeText(text)
})

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: productName || 'Drive',
    backgroundColor: '#0f1410',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const devServerUrl = process.env.PEAR_DEV_SERVER_URL
  if (devServerUrl) {
    await win.loadURL(devServerUrl)
    win.webContents.openDevTools()
    return
  }

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

ipcMain.handle('pear:applyUpdate', () => {
  const pipe = getWorker(mainWorkerSpecifier)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pipe.removeListener('data', onData)
      reject(new Error('Update timed out'))
    }, 120_000)

    function onData(data: Buffer) {
      if (data.toString() === 'pear:updateApplied') {
        clearTimeout(timer)
        pipe.removeListener('data', onData)
        resolve()
      }
    }
    pipe.on('data', onData)
    pipe.write('pear:applyUpdate')
  })
})

ipcMain.handle('pear:startWorker', (_evt, filename: string) => {
  if (filename !== mainWorkerSpecifier) {
    throw new Error('Invalid worker specifier')
  }
  getWorker(filename)
  return true
})

ipcMain.handle('app:afterUpdate', () => {
  if (isLinux && process.env.APPIMAGE) {
    app.relaunch({
      execPath: process.env.APPIMAGE,
      args: [
        '--appimage-extract-and-run',
        ...process.argv.slice(1).filter((arg) => arg !== '--appimage-extract-and-run')
      ]
    })
  } else {
    // Windows packaged builds still benefit from relaunch when possible.
    app.relaunch()
  }
  app.quit()
})

function focusMainWindow() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

function handleDeepLink(url: string) {
  console.log('deep link:', url)
  focusMainWindow()
  sendToAll('pear:deepLink', url)
}

app.setAsDefaultProtocolClient(protocol)

app.on('open-url', (evt, url) => {
  evt.preventDefault()
  handleDeepLink(url)
})

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (_evt, args) => {
    focusMainWindow()
    const url = args.find((arg) => arg.startsWith(protocol + '://'))
    if (url) handleDeepLink(url)
  })

  app.whenReady().then(() => {
    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err) => console.error('Failed to create window:', err))
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
