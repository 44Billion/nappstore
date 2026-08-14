import { appDecode, appEncode } from 'libp2r2p/nip19'

export const NOSTR_APP_D_TAG_MAX_LENGTH = 260

// Validates if a string is safe to use as a Nostr app dTag
export function isNostrAppDTagSafe (string) {
  return typeof string === 'string' && string.length <= NOSTR_APP_D_TAG_MAX_LENGTH
}

// Removes relay hints while preserving the app entity's address and channel.
export function getCanonicalAppId (appId) {
  try {
    const { dTag, pubkey, kind } = appDecode(appId)
    return appEncode({ dTag, pubkey, kind })
  } catch (_) {
    return typeof appId === 'string' && appId ? appId : 'unknown'
  }
}

// Creates one searchable console prefix for every app icon operation.
export function getAppIconLogPrefix (appId) {
  return `[app-icon ${getCanonicalAppId(appId)}]`
}
