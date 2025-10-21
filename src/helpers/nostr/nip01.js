import { getPublicKey as getPublicKeyFromUint8Array } from 'nostr-tools/pure'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToBase16, base16ToBytes } from '#helpers/base16.js'

// https://github.com/paulmillr/noble-secp256k1/blob/b032053763c0d4ba107c18fee28344f64242b075/index.js#L457
export function generatePrivateKey () {
  const randomBytes = crypto.getRandomValues(new Uint8Array(40))
  const B256 = 2n ** 256n // secp256k1 is short weierstrass curve
  const N = B256 - 0x14551231950b75fc4402da1732fc9bebfn // curve (group) order
  const bytesToNumber = b => BigInt('0x' + (bytesToBase16(b) || '0'))
  const mod = (a, b) => { const r = a % b; return r >= 0n ? r : b + r } // mod division
  const num = mod(bytesToNumber(randomBytes), N - 1n) + 1n // takes at least n+8 bytes
  return num.toString(16).padStart(64, '0')
}

export function getPublicKey (privkey) {
  return getPublicKeyFromUint8Array(privkey)
}

function serializeEvent (event) {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ])
}

function getEventHash (event) {
  return sha256(new TextEncoder().encode(serializeEvent(event)))
}

function getSignature (eventHash, privkey) {
  return bytesToBase16(schnorr.sign(eventHash, privkey))
}

export function finalizeEvent (event, privkey, withSig = true) {
  event.pubkey ??= getPublicKey(privkey)
  const eventHash = event.id ? base16ToBytes(event.id) : getEventHash(event)
  event.id ??= bytesToBase16(eventHash)
  if (withSig) event.sig ??= getSignature(eventHash, privkey)
  else delete event.sig
  return event
}
