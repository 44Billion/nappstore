import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getAvatarImageLoadStatus,
  getSvgAvatar,
  isCacheableAvatarProfile,
  isDataAvatarPicture,
  isValidAvatarPicture
} from '#helpers/avatar.js'

function normalizeRandomIds (svg) {
  const suffix = svg.match(/id="[^"]+-([a-f0-9]{6})"/)?.[1]
  return suffix ? svg.replaceAll(`-${suffix}`, '-RANDOM') : svg
}

describe('local avatars', () => {
  it('generates a circular Avataaars SVG without using the HTTP API', (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', () => {
      throw new Error('unexpected HTTP request')
    })

    const svg = getSvgAvatar('alice')

    assert.match(svg, /^<svg /)
    assert.match(svg, /viewBox="0 0 280 280"/)
    assert.match(svg, /<clipPath /)
    assert.equal(fetchMock.mock.callCount(), 0)
  })

  it('keeps the visual result deterministic while randomizing document IDs', () => {
    const first = getSvgAvatar('same-seed')
    const second = getSvgAvatar('same-seed')

    assert.notEqual(first, second)
    assert.equal(normalizeRandomIds(first), normalizeRandomIds(second))
  })

  it('uses a hexadecimal Nostr pubkey directly as a DiceBear seed', () => {
    const svg = getSvgAvatar('f7922a0adb3fa4dda5eecaa62f6f7ee6159f7f55e08036686c68e08382c34788')
    assert.match(svg, /^<svg /)
  })
})

describe('avatar picture validation', () => {
  it('identifies data images without depending on scheme casing', () => {
    assert.equal(isDataAvatarPicture('data:image/svg+xml,%3Csvg%2F%3E'), true)
    assert.equal(isDataAvatarPicture('DATA:image/png;base64,AAAA'), true)
    assert.equal(isDataAvatarPicture('https://example.test/avatar.png'), false)
  })

  it('accepts supported data and HTTP image sources', () => {
    assert.equal(isValidAvatarPicture('data:image/svg+xml,%3Csvg%3E'), true)
    assert.equal(isValidAvatarPicture('https://example.test/avatar.webp?size=64'), true)
    assert.equal(isValidAvatarPicture('https://example.test/64-character-content-hash'), true)
  })

  it('rejects relative and unsafe-looking values', () => {
    assert.equal(isValidAvatarPicture('/images/avatar.png'), false)
    assert.equal(isValidAvatarPicture('../images/avatar.svg#face'), false)
    assert.equal(isValidAvatarPicture('avatar.png'), false)
    assert.equal(isValidAvatarPicture('javascript:alert(1)'), false)
    assert.equal(isValidAvatarPicture('https://user:secret@example.test/avatar.png'), false)
    assert.equal(isValidAvatarPicture(' avatar.png'), false)
    assert.equal(isValidAvatarPicture({ src: 'avatar.png' }), false)
  })
})

describe('reused avatar images', () => {
  const picture = 'https://example.test/avatar.png'
  const image = ({ src = picture, isConnected = true, complete = true, naturalWidth = 64 } = {}) => ({
    isConnected,
    complete,
    naturalWidth,
    getAttribute: name => name === 'src' ? src : null
  })

  it('recognizes an already-loaded matching image', () => {
    assert.equal(getAvatarImageLoadStatus(image(), picture), 'loaded')
  })

  it('recognizes a completed broken image', () => {
    assert.equal(getAvatarImageLoadStatus(image({ naturalWidth: 0 }), picture), 'failed')
  })

  it('ignores pending, detached and stale images', () => {
    assert.equal(getAvatarImageLoadStatus(image({ complete: false }), picture), 'pending')
    assert.equal(getAvatarImageLoadStatus(image({ isConnected: false }), picture), 'pending')
    assert.equal(getAvatarImageLoadStatus(image({ src: 'https://example.test/old.png' }), picture), 'pending')
  })
})

describe('persistent avatar profile limits', () => {
  const event = { id: 'a'.repeat(64), kind: 0, created_at: 1 }

  it('keeps ordinary profiles but not locally generated fallbacks', () => {
    assert.equal(isCacheableAvatarProfile({
      picture: 'https://cdn.test/content-hash',
      meta: { events: [event], generatedPicture: false }
    }), true)
    assert.equal(isCacheableAvatarProfile({
      picture: 'data:image/svg+xml,fallback',
      meta: { events: [], generatedPicture: true }
    }), false)
  })

  it('rejects oversized embedded pictures and profiles', () => {
    assert.equal(isCacheableAvatarProfile({
      picture: `data:image/png;base64,${'a'.repeat(16 * 1024)}`,
      meta: { events: [event], generatedPicture: false }
    }), false)
    assert.equal(isCacheableAvatarProfile({
      picture: 'https://cdn.test/avatar',
      about: 'a'.repeat(32 * 1024),
      meta: { events: [event], generatedPicture: false }
    }), false)
  })
})
