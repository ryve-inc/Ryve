export function normalizePath(p: string): string {
  if (!p || p === '/') return '/'
  const parts: string[] = []
  for (const part of String(p).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) throw new Error('Invalid path: escapes root')
      parts.pop()
      continue
    }
    if (part.includes('\0')) throw new Error('Invalid path')
    parts.push(part)
  }
  return parts.length ? '/' + parts.join('/') : '/'
}

export function joinPath(base: string, name: string): string {
  if (!base || base === '/') return normalizePath('/' + name)
  return normalizePath(base + '/' + name)
}
