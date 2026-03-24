export const NOSTR_APP_D_TAG_MAX_LENGTH = 260

// Validates if a string is safe to use as a Nostr app dTag
export function isNostrAppDTagSafe (string) {
  return typeof string === 'string' && string.length <= NOSTR_APP_D_TAG_MAX_LENGTH
}
