import * as esbuild from 'esbuild'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(path.join(dist, 'workers'), { recursive: true })
mkdirSync(path.join(dist, 'electron'), { recursive: true })

// Electron main — ESM
await esbuild.build({
  entryPoints: [path.join(root, 'src/electron/main.ts')],
  outfile: path.join(dist, 'electron/main.js'),
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true
})

// Preload must be CJS for Electron's sandboxed preload loader
await esbuild.build({
  entryPoints: [path.join(root, 'src/electron/preload.ts')],
  outfile: path.join(dist, 'electron/preload.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  packages: 'external',
  sourcemap: true
})

// Bare worker — single CJS bundle (local modules inlined; Holepunch pkgs external)
await esbuild.build({
  entryPoints: [path.join(root, 'src/workers/main.ts')],
  outfile: path.join(dist, 'workers/main.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  bundle: true,
  packages: 'external',
  sourcemap: true
})

// Guard against parent package.json "type":"module" if anything still loads .js
writeFileSync(
  path.join(dist, 'workers/package.json'),
  JSON.stringify({ type: 'commonjs', private: true }, null, 2) + '\n'
)

await viteBuild({
  root: path.join(root, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.join(root, 'src/renderer')
    }
  },
  build: {
    outDir: path.join(dist, 'renderer'),
    emptyOutDir: true,
    sourcemap: true
  }
})

console.log('build ok → dist/')
