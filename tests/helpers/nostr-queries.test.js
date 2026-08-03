import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { eventToProfile, getProfiles } from '#helpers/nostr/queries.js'

describe('Nostr profiles', () => {
  it('does not generate a fallback when the profile has a picture', async () => {
    let avatarCalls = 0
    const profile = await eventToProfile({
      kind: 0,
      pubkey: 'a'.repeat(64),
      tags: [],
      content: JSON.stringify({
        display_name: 'Alice',
        picture: 'https://example.com/alice.png'
      })
    }, {
      _getSvgAvatar: () => {
        avatarCalls++
        return '<svg />'
      }
    })

    assert.equal(profile.picture, 'https://example.com/alice.png')
    assert.equal(avatarCalls, 0)
  })

  it('generates a local fallback after finding no profile picture', async () => {
    let avatarCalls = 0
    const profile = await eventToProfile({
      kind: 0,
      pubkey: 'b'.repeat(64),
      tags: [],
      content: JSON.stringify({ name: 'Bob' })
    }, {
      _getSvgAvatar: (seed) => {
        avatarCalls++
        assert.equal(seed, 'b'.repeat(64))
        return '<svg data-fallback="true" />'
      }
    })

    assert.equal(avatarCalls, 1)
    assert.equal(
      decodeURIComponent(profile.picture.split(',')[1]),
      '<svg data-fallback="true" />'
    )
  })

  it('shares concurrent profile requests and caches generated fallbacks', async () => {
    const pubkey = 'c'.repeat(64)
    let relayCalls = 0
    let relayMapCalls = 0
    let avatarCalls = 0
    let resolveRelay
    const relayResult = new Promise(resolve => { resolveRelay = resolve })
    const dependencies = {
      _nostrRelays: {
        async getEvents () {
          relayCalls++
          return await relayResult
        }
      },
      async _getRelaysByPubkey (pubkeys) {
        relayMapCalls++
        return Object.fromEntries(pubkeys.map(pk => [pk, { write: ['wss://relay.test'] }]))
      },
      _getSvgAvatar () {
        avatarCalls++
        return '<svg data-fallback="true" />'
      }
    }

    const firstRequest = getProfiles([pubkey], dependencies)
    const secondRequest = getProfiles([pubkey], dependencies)
    resolveRelay({ result: [] })

    const [first, second] = await Promise.all([firstRequest, secondRequest])
    const cached = await getProfiles([pubkey], dependencies)

    assert.equal(relayMapCalls, 1)
    assert.equal(relayCalls, 1)
    assert.equal(avatarCalls, 1)
    assert.equal(first[pubkey], second[pubkey])
    assert.equal(second[pubkey], cached[pubkey])
  })
})
