export function bytesToBase16 (uint8aBytes) {
  return Array.from(uint8aBytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function base16ToBytes (base16String) {
  if (base16String.length % 2 !== 0) throw new Error('invalid hex: odd length')
  const arr = new Uint8Array(base16String.length / 2) // create result array
  for (let i = 0; i < arr.length; i++) {
    const j = i * 2
    const h = base16String.slice(j, j + 2)
    const b = Number.parseInt(h, 16) // byte, created from string part
    if (Number.isNaN(b) || b < 0) throw new Error('invalid hex')
    arr[i] = b
  }
  return arr
}
