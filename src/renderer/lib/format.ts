export function formatBytes(n: number | undefined | null) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

export function shortId(hex: string | null | undefined) {
  if (!hex) return '—'
  return hex.slice(0, 8) + '…' + hex.slice(-6)
}

export function normalizeMnemonic(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function normalizePath(p: string) {
  if (!p || p === '/') return '/'
  const parts: string[] = []
  for (const part of String(p).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new Error('Invalid path: escapes root')
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length ? '/' + parts.join('/') : '/'
}

export function parentOf(p: string) {
  if (!p || p === '/') return '/'
  const parts = normalizePath(p).split('/').filter(Boolean)
  parts.pop()
  return parts.length ? '/' + parts.join('/') : '/'
}

export function joinPath(base: string, name: string) {
  if (!base || base === '/') return normalizePath('/' + name)
  return normalizePath(base + '/' + name)
}

export function assertEntryName(name: string) {
  const n = String(name || '').trim()
  if (!n) throw new Error('Name is required')
  if (n === '.' || n === '..') throw new Error('Invalid name')
  if (/[/\\]/.test(n)) throw new Error('Name cannot contain slashes')
  return n
}
