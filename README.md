# Drive

Peer-to-peer encrypted file drive built on [Pear](https://docs.pears.com/) and Electron.

Stack: **TypeScript + ES modules + Tailwind CSS**. Source lives under `src/`; `npm run build` emits `dist/`.

> **Why CommonJS was used before:** the original `hello-pear-electron` template and Bare worker runtime are CJS-first (Holepunch packages ship as `require`). Authors now write **ESM TypeScript**; Electron main is ESM. The Bare worker is compiled to CJS only as a runtime compatibility layer.

## Features

- Create an account or unlock with a **24-word recovery key**
- Encrypted personal **Hyperdrive** vault
- Hyperblobs chunking with **per-chunk BLAKE2b hashes**
- Read-only and collaborative share invites
- Optional **blind peer** pinning

## Develop

```bash
npm install
npm start          # builds then launches Electron
npm run build      # dist/ only
npm run dev:renderer
```

Two local peers:

```bash
npm start -- --storage /tmp/drive-user1
npm start -- --storage /tmp/drive-user2
```

## Layout

| Path            | Role                                            |
| --------------- | ----------------------------------------------- |
| `src/renderer/` | Vite + Tailwind UI                              |
| `src/electron/` | Electron main (ESM) + preload (CJS bundle)      |
| `src/workers/`  | Pear/Bare backend (TS ESM → CJS for Bare)       |
| `dist/`         | Build output (`main` → `dist/electron/main.js`) |
