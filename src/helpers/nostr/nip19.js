import { bytesToBase16, base16ToBytes } from '#helpers/base16.js'
import { bytesToBase62, base62ToBytes, BASE62_ALPHABET } from '#helpers/base62.js'
import { isNostrAppDTagSafe } from '#helpers/app.js'
import { bech32 } from '@scure/base'

const MAX_SIZE = 5000
export const NAPP_ENTITY_REGEX = new RegExp(`^\\+{1,3}[${BASE62_ALPHABET}]{48,${MAX_SIZE}}$`)
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const kindByChannel = {
  main: 37448,
  next: 37449,
  draft: 37450
}
const channelByKind = Object.fromEntries(
  Object.entries(kindByChannel).map(([k, v]) => [v, k])
)
const prefixByChannel = {
  main: '+',
  next: '++',
  draft: '+++'
}
const channelByPrefix = Object.fromEntries(
  Object.entries(prefixByChannel).map(([k, v]) => [v, k])
)
export function appEncode (ref) {
  if (!isNostrAppDTagSafe(ref.dTag)) { throw new Error('Invalid deduplication tag') }
  const channel = ref.channel ? (prefixByChannel[ref.channel] && ref.channel) : channelByKind[ref.kind]
  if (!channel) throw new Error('Wrong channel')
  const tlv = toTlv([
    [textEncoder.encode(ref.dTag)], // type 0 (the array index)
    (ref.relays || []).map(url => textEncoder.encode(url)), // type 1
    [base16ToBytes(ref.pubkey)] // type 2
  ])
  const base62 = bytesToBase62(tlv)
  const prefix = prefixByChannel[channel]
  return `${prefix}${base62}`
}

export function appDecode (entity) {
  const prefix = entity.match(/^\+*/)[0]
  const channel = channelByPrefix[prefix]
  if (!channel) throw new Error('Invalid channel')
  const base62 = entity.slice(prefix.length)
  const tlv = tlvToObj(base62ToBytes(base62))
  if (!tlv[0]?.[0]) throw new Error('Missing deduplication tag')
  if (!tlv[2]?.[0]) throw new Error('Missing author pubkey')
  if (tlv[2][0].length !== 32) throw new Error('Author pubkey should be 32 bytes')
  const dTag = textDecoder.decode(tlv[0][0])
  if (!isNostrAppDTagSafe(dTag)) { throw new Error('Invalid deduplication tag') }

  return {
    dTag,
    pubkey: bytesToBase16(tlv[2][0]),
    kind: kindByChannel[channel],
    channel,
    relays: tlv[1] ? tlv[1].map(url => textDecoder.decode(url)) : []
  }
}

function toTlv (tlvConfig) {
  const arrays = []
  tlvConfig
    .map((v, i) => [i, v])
    .reverse() // if the first type is 0, entity always starts with the '0' char
    .forEach(([type, values]) => {
      // just non-empty values will be included
      values.forEach(v => {
        if (v.length > 255) throw new Error('Value is too big')
        const array = new Uint8Array(v.length + 2)
        array.set([type], 0) // t
        array.set([v.length], 1) // l
        array.set(v, 2) // v
        arrays.push(array)
      })
    })
  return new Uint8Array(arrays.reduce((r, v) => [...r, ...v]))
}

// { 0: [t0v0], 1: [t1v0, t1v2], 3: [t3v0] }
function tlvToObj (tlv) {
  const ret = {}
  let rest = tlv
  let t, l, v
  while (rest.length > 0) {
    t = rest[0]
    l = rest[1]
    v = rest.slice(2, 2 + l)
    rest = rest.slice(2 + l)
    if (v.length < l) throw new Error(`not enough data to read on TLV ${t}`)
    ret[t] ??= []
    ret[t].push(v)
  }
  return ret
}

export function npubEncode (hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('Invalid pubkey hex string')
  }
  const bytes = base16ToBytes(hex)
  const words = bech32.toWords(bytes)
  return bech32.encode('npub', words)
}

export function npubDecode (npub) {
  if (typeof npub !== 'string' || !npub.startsWith('npub1')) {
    throw new Error('Invalid npub format')
  }
  try {
    const { prefix, words } = bech32.decode(npub)
    if (prefix !== 'npub') throw new Error('Invalid npub prefix')
    const bytes = new Uint8Array(bech32.fromWords(words))
    if (bytes.length !== 32) throw new Error('Invalid pubkey length')
    return bytesToBase16(bytes)
  } catch (error) {
    throw new Error(`Failed to decode npub: ${error.message}`)
  }
}
