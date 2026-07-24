import electron from 'electron'
import type { BridgeApi } from '../shared/types.ts'

const { contextBridge, ipcRenderer, webUtils, clipboard } = electron

function toBuffer(data: unknown) {
  if (data === null || data === undefined || typeof data === 'number') return data as never
  const view = data as ArrayBufferView
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength)
}

const bridge: BridgeApi = {
  applyUpdate: () => ipcRenderer.invoke('pear:applyUpdate'),
  appAfterUpdate: () => ipcRenderer.invoke('app:afterUpdate'),
  startWorker: (specifier) => ipcRenderer.invoke('pear:startWorker', specifier),
  onWorkerStdout: (specifier, listener) => {
    const wrap = (_evt: Electron.IpcRendererEvent, data: unknown) => listener(toBuffer(data))
    ipcRenderer.on('pear:worker:stdout:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stdout:' + specifier, wrap)
  },
  onWorkerStderr: (specifier, listener) => {
    const wrap = (_evt: Electron.IpcRendererEvent, data: unknown) => listener(toBuffer(data))
    ipcRenderer.on('pear:worker:stderr:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:stderr:' + specifier, wrap)
  },
  onWorkerIPC: (specifier, listener) => {
    const wrap = (_evt: Electron.IpcRendererEvent, data: unknown) => listener(toBuffer(data))
    ipcRenderer.on('pear:worker:ipc:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:ipc:' + specifier, wrap)
  },
  onWorkerExit: (specifier, listener) => {
    const wrap = (_evt: Electron.IpcRendererEvent, code: number) => listener(code)
    ipcRenderer.on('pear:worker:exit:' + specifier, wrap)
    return () => ipcRenderer.removeListener('pear:worker:exit:' + specifier, wrap)
  },
  writeWorkerIPC: (specifier, data) =>
    ipcRenderer.invoke('pear:worker:writeIPC:' + specifier, data),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  writeClipboard: (text) => clipboard.writeText(String(text)),
  chooseDownloadPath: (defaultName) => ipcRenderer.invoke('dialog:savePath', defaultName),
  chooseUploadFiles: () => ipcRenderer.invoke('dialog:openFile')
}

contextBridge.exposeInMainWorld('bridge', bridge)
