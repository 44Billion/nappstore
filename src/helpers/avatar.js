import { Avatar, Style } from '@dicebear/core'
import avataaars from '@dicebear/styles/avataaars.json' with { type: 'json' }

import { getRandomId } from '#helpers/misc.js'

const style = new Style(avataaars)
const MAX_CACHED_DATA_URL_BYTES = 16 * 1024
const MAX_CACHED_PROFILE_BYTES = 32 * 1024

export const getSvgAvatar = function (seed = getRandomId()) {
  return new Avatar(style, {
    borderRadius: 50,
    idRandomization: true,
    seed
  }).toString()
}

// Identifies self-contained avatar pictures that require no network request.
export const isDataAvatarPicture = function (picture) {
  return typeof picture === 'string' &&
    /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*(?:;base64)?,/i.test(picture)
}

// Accepts only self-contained images and explicit HTTP(S) image URLs.
export const isValidAvatarPicture = function (picture) {
  if (
    typeof picture !== 'string' ||
    picture.length === 0 ||
    picture.trim() !== picture ||
    /\s/.test(picture)
  ) return false

  if (isDataAvatarPicture(picture)) return true

  try {
    const url = new URL(picture)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch (_) {
    return false
  }
}

// Prevents generated or disproportionately large pictures from consuming localStorage.
export function isCacheableAvatarProfile (profile) {
  if (!profile || typeof profile !== 'object' || profile.meta?.generatedPicture === true) return false
  if (!profile.meta?.events?.some(event => event?.kind === 0)) return false

  try {
    const encoder = new TextEncoder()
    const picture = typeof profile.picture === 'string' ? profile.picture : ''
    if (/^data:/i.test(picture) && encoder.encode(picture).length > MAX_CACHED_DATA_URL_BYTES) return false
    return encoder.encode(JSON.stringify(profile)).length <= MAX_CACHED_PROFILE_BYTES
  } catch (_) {
    return false
  }
}
