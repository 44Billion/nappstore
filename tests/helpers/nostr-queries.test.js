import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  eventToProfile,
  getBlossomServersByPubkey,
  getProfiles,
  getRelaysByPubkey,
  selectPreferredProfile
} from '#helpers/nostr/queries.js'

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
    assert.equal(profile.name, 'Alice')
    assert.equal(profile.meta.generatedName, false)
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
    assert.equal(first[pubkey].meta.generatedName, true)
  })

  it('marks whitespace-only profile names as generated', async () => {
    const profile = await eventToProfile({
      kind: 0,
      pubkey: 'e'.repeat(64),
      tags: [['name', '   ']],
      content: JSON.stringify({ display_name: '\t' })
    }, {
      _getSvgAvatar: () => '<svg />'
    })

    assert.match(profile.name, /^User#/)
    assert.equal(profile.meta.generatedName, true)
  })

  it('selects the newest profile across both relays with the NIP-01 tie break', async () => {
    const pubkey = 'd'.repeat(64)
    const eventsByRelay = {
      'wss://one.test': [
        { id: 'f'.repeat(64), kind: 0, pubkey, created_at: 10, tags: [], content: '{"name":"Old"}' },
        { id: 'b'.repeat(64), kind: 0, pubkey, created_at: 20, tags: [], content: '{"name":"Tie loser"}' }
      ],
      'wss://two.test': [
        { id: 'a'.repeat(64), kind: 0, pubkey, created_at: 20, tags: [], content: '{"name":"Newest"}' }
      ]
    }

    const profiles = await getProfiles([pubkey], {
      _nostrRelays: {
        async getEvents (_filter, relays) {
          return { result: eventsByRelay[relays[0]] }
        }
      },
      async _getRelaysByPubkey () {
        return { [pubkey]: { write: Object.keys(eventsByRelay) } }
      },
      _getSvgAvatar: () => '<svg />'
    })

    assert.equal(profiles[pubkey].name, 'Newest')
    assert.equal(profiles[pubkey].meta.events[0].id, 'a'.repeat(64))
  })

  it('preserves a real cached profile when a refresh only produces a fallback', () => {
    const cached = {
      picture: 'https://cdn.test/cached',
      meta: { events: [{ id: 'a'.repeat(64), kind: 0, created_at: 10 }] }
    }
    const fallback = {
      picture: 'data:image/svg+xml,fallback',
      meta: { events: [], generatedPicture: true }
    }

    assert.equal(selectPreferredProfile(cached, fallback), cached)
  })

  it('refreshes derived metadata when both profiles came from the same event', () => {
    const event = { id: 'a'.repeat(64), kind: 0, created_at: 10 }
    const cached = { picture: 'data:image/svg+xml,legacy', meta: { events: [event] } }
    const fresh = { picture: 'data:image/svg+xml,current', meta: { events: [event], generatedPicture: true } }
    assert.equal(selectPreferredProfile(cached, fresh), fresh)
  })
})

describe('Nostr service discovery', () => {
  it('shares concurrent relay-list queries and caches the fallback', async () => {
    const pubkey = '1'.repeat(64)
    let calls = 0
    let release
    const gate = new Promise(resolve => { release = resolve })
    const dependencies = {
      _nostrRelays: {
        async getEvents () {
          calls++
          return gate
        }
      }
    }
    const first = getRelaysByPubkey([pubkey], dependencies)
    const second = getRelaysByPubkey([pubkey], dependencies)
    release({ result: [], errors: [] })
    const [firstResult, secondResult] = await Promise.all([first, second])
    const cached = await getRelaysByPubkey([pubkey], dependencies)
    assert.equal(calls, 1)
    assert.equal(firstResult[pubkey], secondResult[pubkey])
    assert.equal(secondResult[pubkey], cached[pubkey])
  })

  it('shares concurrent Blossom server queries', async () => {
    const pubkey = '2'.repeat(64)
    let relayMapCalls = 0
    let eventCalls = 0
    let release
    const gate = new Promise(resolve => { release = resolve })
    const dependencies = {
      async _getRelaysByPubkey () {
        relayMapCalls++
        return { [pubkey]: { read: ['wss://relay.test'], write: ['wss://relay.test'] } }
      },
      _nostrRelays: {
        async getEvents () {
          eventCalls++
          return gate
        }
      }
    }
    const first = getBlossomServersByPubkey([pubkey], dependencies)
    const second = getBlossomServersByPubkey([pubkey], dependencies)
    release({
      result: [{
        id: 'a'.repeat(64), kind: 10063, pubkey, created_at: 1,
        tags: [
          ['server', 'http://localhost:3000'],
          ['server', 'https://blossom.test/'],
          ['server', 'https://blossom.test/path']
        ]
      }]
    })
    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.equal(relayMapCalls, 1)
    assert.equal(eventCalls, 1)
    assert.deepEqual(firstResult[pubkey], ['https://blossom.test'])
    assert.equal(firstResult[pubkey], secondResult[pubkey])
  })
})
