import electron from 'electron'
import type { BridgeApi } from '../shared/types.ts'

const { contextBridge, ipcRenderer, webUtils } = electron

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  }
  return Buffer.from(String(data ?? ''))
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
  getPathForFile: (file) => webUtils.getPathForFile(file as unknown as File),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', String(text)),
  chooseDownloadPath: (defaultName) => ipcRenderer.invoke('dialog:savePath', defaultName),
  chooseUploadFiles: () => ipcRenderer.invoke('dialog:openFile')
}

contextBridge.exposeInMainWorld('bridge', bridge)
