import path from 'bare-path'
import fs from 'bare-fs'
import b4a from 'b4a'

export type PublicFileManifest = {
  path: string
  name: string
  byteLength: number
  mime: string | null
  uploadedAt: number
  uploaderIdentity: string | null
  networkKeyHex: string
  nonce: string
  encryptedSize: number
  originalSize: number
  erasureCoding?: any
  chunks: Array<{ index: number; isParity: boolean; offset: number; length: number; hash: string }>
  isPrivate: false
}

class PublicCatalogManager {
  storageDir: string
  catalogDir: string
  catalogs: Map<string, Map<string, PublicFileManifest>>

  constructor(storageDir: string) {
    this.storageDir = storageDir
    this.catalogDir = path.join(storageDir, 'public-catalogs')
    this.catalogs = new Map()
  }

  async init() {
    await fs.promises.mkdir(this.catalogDir, { recursive: true }).catch(() => {})
  }

  private catalogFilePath(networkKeyHex: string): string {
    return path.join(this.catalogDir, `${networkKeyHex.slice(0, 16)}.json`)
  }

  async loadCatalog(networkKeyHex: string): Promise<Map<string, PublicFileManifest>> {
    if (this.catalogs.has(networkKeyHex)) {
      return this.catalogs.get(networkKeyHex)!
    }

    const map = new Map<string, PublicFileManifest>()
    const filePath = this.catalogFilePath(networkKeyHex)
    try {
      const raw = await fs.promises.readFile(filePath)
      const list = JSON.parse(b4a.toString(raw)) as PublicFileManifest[]
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.path) {
            map.set(item.path, item)
          }
        }
      }
    } catch {}

    this.catalogs.set(networkKeyHex, map)
    return map
  }

  async saveCatalog(networkKeyHex: string): Promise<void> {
    const map = this.catalogs.get(networkKeyHex)
    if (!map) return
    const filePath = this.catalogFilePath(networkKeyHex)
    const list = Array.from(map.values())
    const tmp = filePath + '.tmp-' + Math.random().toString(16).slice(2)
    const payload = b4a.from(JSON.stringify(list, null, 2))
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {})
    await fs.promises.writeFile(tmp, payload)
    await fs.promises.rename(tmp, filePath)
  }

  async addPublicFile(networkKeyHex: string, manifest: PublicFileManifest): Promise<void> {
    const map = await this.loadCatalog(networkKeyHex)
    map.set(manifest.path, manifest)
    await this.saveCatalog(networkKeyHex)
  }

  async removePublicFile(networkKeyHex: string, entryPath: string): Promise<void> {
    const map = await this.loadCatalog(networkKeyHex)
    map.delete(entryPath)
    await this.saveCatalog(networkKeyHex)
  }

  getPublicFilesSync(networkKeyHex: string): PublicFileManifest[] {
    const map = this.catalogs.get(networkKeyHex)
    return map ? Array.from(map.values()) : []
  }

  getAllFiles(networkKeyHex: string): PublicFileManifest[] {
    const map = this.catalogs.get(networkKeyHex)
    return map ? Array.from(map.values()) : []
  }

  async getPublicFiles(networkKeyHex: string): Promise<PublicFileManifest[]> {
    const map = await this.loadCatalog(networkKeyHex)
    return Array.from(map.values())
  }

  async getPublicManifest(networkKeyHex: string, entryPath: string): Promise<PublicFileManifest | null> {
    const map = await this.loadCatalog(networkKeyHex)
    return map.get(entryPath) || null
  }

  async mergeRemoteManifests(networkKeyHex: string, manifests: PublicFileManifest[]): Promise<boolean> {
    const map = await this.loadCatalog(networkKeyHex)
    let added = false
    for (const manifest of manifests) {
      if (manifest && manifest.path && !map.has(manifest.path)) {
        map.set(manifest.path, manifest)
        added = true
      }
    }
    if (added) {
      await this.saveCatalog(networkKeyHex)
    }
    return added
  }
}

export { PublicCatalogManager }
