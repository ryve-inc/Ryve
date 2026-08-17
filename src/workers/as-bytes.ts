export function asBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') {
    throw new Error('Expected binary file contents')
  }
  return data
}
