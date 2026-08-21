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

  it('shares concurrent profile requests without positively caching misses', async () => {
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
      },
      _freeRelays: []
    }

    const firstRequest = getProfiles([pubkey], dependencies)
    const secondRequest = getProfiles([pubkey], dependencies)
    resolveRelay({ result: [] })

    const [first, second] = await Promise.all([firstRequest, secondRequest])
    const retried = await getProfiles([pubkey], dependencies)

    assert.equal(relayMapCalls, 2)
    assert.equal(relayCalls, 2)
    assert.equal(avatarCalls, 2)
    assert.equal(first[pubkey], second[pubkey])
    assert.notEqual(second[pubkey], retried[pubkey])
    assert.equal(first[pubkey].meta.generatedName, true)
  })

  it('batches unresolved authors across remaining write relays and at most three free relays', async () => {
    const pubkeys = ['7'.repeat(64), '8'.repeat(64)]
    const relays = [
      'wss://primary-one.test',
      'wss://primary-two.test',
      'wss://remaining.test'
    ]
    const freeRelayCandidates = [
      'wss://free-one.test',
      'wss://free-two.test',
      'wss://free-three.test',
      'wss://free-four.test'
    ]
    const calls = []

    const profiles = await getProfiles(pubkeys, {
      _nostrRelays: {
        async getEvents (filter, selectedRelays) {
          calls.push({ authors: filter.authors, relay: selectedRelays[0] })
          if (selectedRelays[0] !== 'wss://remaining.test') return { result: [] }
          return {
            result: pubkeys.map((pubkey, index) => ({
              id: String(index + 1).repeat(64),
              kind: 0,
              pubkey,
              created_at: 1,
              tags: [],
              content: JSON.stringify({ name: `Author ${index + 1}` })
            }))
          }
        }
      },
      async _getRelaysByPubkey () {
        return Object.fromEntries(pubkeys.map(pubkey => [pubkey, { write: relays }]))
      },
      _getSvgAvatar: () => '<svg />',
      _freeRelays: freeRelayCandidates
    })

    assert.deepEqual(calls.map(call => call.relay), [
      ...relays,
      ...freeRelayCandidates.slice(0, 3)
    ])
    calls.forEach(call => assert.deepEqual(call.authors, pubkeys))
    assert.equal(profiles[pubkeys[0]].name, 'Author 1')
    assert.equal(profiles[pubkeys[1]].name, 'Author 2')
  })

  it('still queries at most three free relays when NIP-65 discovery fails', async () => {
    const pubkey = '9'.repeat(64)
    const calls = []

    const profiles = await getProfiles([pubkey], {
      async _getRelaysByPubkey () {
        throw new Error('relay discovery unavailable')
      },
      _nostrRelays: {
        async getEvents (filter, selectedRelays) {
          calls.push({ authors: filter.authors, relay: selectedRelays[0] })
          return { result: [] }
        }
      },
      _getSvgAvatar: () => '<svg />',
      _freeRelays: [
        'wss://free-one.test',
        'wss://free-two.test',
        'wss://free-three.test',
        'wss://free-four.test'
      ]
    })

    assert.deepEqual(calls.map(call => call.relay), [
      'wss://free-one.test',
      'wss://free-two.test',
      'wss://free-three.test'
    ])
    calls.forEach(call => assert.deepEqual(call.authors, [pubkey]))
    assert.equal(profiles[pubkey].meta.generatedName, true)
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

  it('exposes a NIP-05 from the profile content or a nip05 tag', async () => {
    const fromContent = await eventToProfile({
      kind: 0,
      pubkey: 'e'.repeat(64),
      tags: [],
      content: JSON.stringify({ name: 'Alice', nip05: 'alice@example.com' })
    }, {
      _getSvgAvatar: () => '<svg />'
    })
    assert.equal(fromContent.nip05, 'alice@example.com')

    const fromTag = await eventToProfile({
      kind: 0,
      pubkey: 'f'.repeat(64),
      tags: [['nip05', 'fiatjaf.com']],
      content: '{}'
    }, {
      _getSvgAvatar: () => '<svg />'
    })
    assert.equal(fromTag.nip05, 'fiatjaf.com')
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
  it('uses the shared relay-list cache for fallback results', async () => {
    const pubkey = '1'.repeat(64)
    let calls = 0
    const dependencies = {
      _nostrRelays: {
        async getEvents () {
          calls++
          return { result: [], errors: [] }
        }
      }
    }
    const firstResult = await getRelaysByPubkey([pubkey], dependencies)
    const cached = await getRelaysByPubkey([pubkey], dependencies)
    assert.equal(calls, 1)
    assert.deepEqual(firstResult[pubkey], cached[pubkey])
    assert.notEqual(firstResult[pubkey], cached[pubkey])
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
