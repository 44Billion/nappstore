import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getSvgAvatar } from '#helpers/avatar.js'

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
})
