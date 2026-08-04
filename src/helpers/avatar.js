import { Avatar, Style } from '@dicebear/core'
import avataaars from '@dicebear/styles/avataaars.json' with { type: 'json' }

import { getRandomId } from '#helpers/misc.js'

const style = new Style(avataaars)

export const getSvgAvatar = function (seed = getRandomId()) {
  return new Avatar(style, {
    borderRadius: 50,
    idRandomization: true,
    seed
  }).toString()
}

// Accepts only self-contained images and explicit HTTP(S) image URLs.
export const isValidAvatarPicture = function (picture) {
  if (typeof picture !== 'string' || picture.length === 0 || picture.trim() !== picture) return false

  const isDataImage = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*(?:;base64)?,/i.test(picture)
  const isHttpImageUrl = /^(https?:\/\/)[^\s?#]+\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)(?:[?#].*)?$/i.test(picture)

  return isDataImage || isHttpImageUrl
}
