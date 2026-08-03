import nostrRelays, { seedRelays, freeRelays } from '#services/nostr-relays.js'
import { npubEncode } from 'libp2r2p/nip19'
import { pickRelaysForPubkeys } from 'libp2r2p/relay'
import { getSvgAvatar } from '#helpers/avatar.js'
import { getRandomId } from '#helpers/misc.js'
import { maybeUnref } from '#helpers/timer.js'

export { pickRelaysForPubkeys }

const PROFILE_CACHE_TTL = 3 * 60 * 1000
const profilesByPubkey = {}
const profileRequestsByPubkey = new Map()

function cacheProfile (pubkey, profile) {
  profilesByPubkey[pubkey] = profile
  maybeUnref(setTimeout(() => {
    if (profilesByPubkey[pubkey] === profile) delete profilesByPubkey[pubkey]
  }, PROFILE_CACHE_TTL))
}

async function createFallbackProfile (pubkey, getAvatar) {
  return {
    name: `User#${getRandomId().slice(0, 5)}`,
    about: '',
    picture: `data:image/svg+xml;charset=utf-8,${
      encodeURIComponent(await getAvatar(pubkey))
    }`,
    npub: npubEncode(pubkey),
    meta: { events: [] }
  }
}

async function loadMissingProfiles (pubkeys, { nostrRelays, getRelaysByPubkey, getAvatar }) {
  const relaysByAuthor = await getRelaysByPubkey(pubkeys)
  const relayToAuthors = pickRelaysForPubkeys(pubkeys, relaysByAuthor)

  const results = await Promise.all(
    [...relayToAuthors.entries()]
      .map(([relay, authors]) =>
        nostrRelays.getEvents({ kinds: [0], authors }, [relay])
      )
  )
  const allEvents = results.flatMap(r => r.result)

  const latestByPk = {}
  for (const event of allEvents) {
    if (!latestByPk[event.pubkey] || event.created_at > latestByPk[event.pubkey].created_at) {
      latestByPk[event.pubkey] = event
    }
  }

  await Promise.all(pubkeys.map(async (pubkey) => {
    const event = latestByPk[pubkey]
    const profile = event
      ? await eventToProfile(event, { _getSvgAvatar: getAvatar })
      : await createFallbackProfile(pubkey, getAvatar)
    cacheProfile(pubkey, profile)
  }))
}

/**
 * Fetches profiles for multiple pubkeys efficiently.
 * Uses the minimum set of write relays that cover all pubkeys.
 */
export async function getProfiles (pubkeys,
  { _nostrRelays = nostrRelays, _getRelaysByPubkey = getRelaysByPubkey, _getSvgAvatar = getSvgAvatar } = {}
) {
  const missingPubkeys = [...new Set(pubkeys)].filter(pk => !profilesByPubkey[pk])
  const pubkeysToLoad = missingPubkeys.filter(pk => !profileRequestsByPubkey.has(pk))

  if (pubkeysToLoad.length > 0) {
    const request = loadMissingProfiles(pubkeysToLoad, {
      nostrRelays: _nostrRelays,
      getRelaysByPubkey: _getRelaysByPubkey,
      getAvatar: _getSvgAvatar
    }).finally(() => {
      for (const pubkey of pubkeysToLoad) {
        if (profileRequestsByPubkey.get(pubkey) === request) {
          profileRequestsByPubkey.delete(pubkey)
        }
      }
    })

    for (const pubkey of pubkeysToLoad) {
      profileRequestsByPubkey.set(pubkey, request)
    }
  }

  await Promise.all([...new Set(
    missingPubkeys.map(pk => profileRequestsByPubkey.get(pk)).filter(Boolean)
  )])

  return pubkeys.reduce((profiles, pubkey) => {
    profiles[pubkey] = profilesByPubkey[pubkey]
    return profiles
  }, {})
}

// Returns the profile for a single pubkey.
export async function getProfile (pubkey,
  { _nostrRelays = nostrRelays, _getRelays = getRelays, _getSvgAvatar = getSvgAvatar } = {}
) {
  const result = await getProfiles([pubkey], {
    _nostrRelays,
    _getRelaysByPubkey: async (pk) => ({ [pk[0]]: await _getRelays(pk[0], { _nostrRelays }) }),
    _getSvgAvatar
  })
  return result[pubkey]
}
export async function eventToProfile (event, { _getSvgAvatar = getSvgAvatar } = {}) {
  if (typeof event !== 'object' || event === null || event.kind !== 0 || typeof event.pubkey !== 'string') {
    throw new Error('invalid event')
  }
  let eventContent = {}
  try {
    eventContent = JSON.parse(event.content)
  } catch (_err) {
    eventContent = {}
  }
  return {
    name:
      event.tags
        .filter(t => ['name', 'display_name'].includes(t[0]) && t[1]?.trim?.())
        .sort((a, b) => (b[0] === 'display_name' ? -1 : 1) - (a[0] === 'display_name' ? -1 : 1))[0]
        ?.[1]?.trim?.() ||
      eventContent.name?.trim?.() ||
      eventContent.display_name?.trim?.() ||
      `User#${getRandomId().slice(0, 5)}`,
    about:
      [event.tags.find(t => t[0] === 'about')]
        .filter(Boolean)
        .map(t => t[1]?.trim?.())[0] ||
      eventContent.about?.trim?.() ||
      '',
    picture:
      [event.tags.find(t => t[0] === 'picture')]
        .filter(Boolean)
        .map(t => t[1]?.trim?.())[0] ||
      eventContent.picture?.trim?.() ||
      `data:image/svg+xml;charset=utf-8,${
        encodeURIComponent(await _getSvgAvatar(event.pubkey))
      }`,
    npub: npubEncode(event.pubkey),
    meta: {
      events: [event]
    }
  }
}

const relaysByPubkey = {}
// Returns a mapping of pubkeys to their relays.
export async function getRelaysByPubkey (pubkeys, { _nostrRelays = nostrRelays } = {}) {
  const missingPubkeys = pubkeys.filter(pk => !relaysByPubkey[pk])
  if (missingPubkeys.length > 0) {
    const { result: getEventsResult, errors } = await _nostrRelays.getEvents({ kinds: [10002], authors: missingPubkeys, limit: missingPubkeys.length }, seedRelays)
    if (errors.length) console.log(errors)

    const latestByPubkey = {}
    for (const event of getEventsResult) {
      if (!latestByPubkey[event.pubkey] || event.created_at > latestByPubkey[event.pubkey].created_at) {
        latestByPubkey[event.pubkey] = event
      }
    }

    for (const pubkey of missingPubkeys) {
      const event = latestByPubkey[pubkey]
      if (event) {
        relaysByPubkey[pubkey] = eventToRelays(event)
        maybeUnref(setTimeout(
          () => { delete relaysByPubkey[pubkey] },
          3 * 60 * 1000
        ))
      }
    }
  }
  return pubkeys.reduce((acc, pubkey) => {
    acc[pubkey] = relaysByPubkey[pubkey] || { read: freeRelays.slice(0, 2), write: freeRelays.slice(0, 2), meta: { events: [] } }
    return acc
  }, {})
}

// Returns the relays for a single pubkey.
export async function getRelays (pubkey, { _nostrRelays = nostrRelays } = {}) {
  const relaysByPubkeyResult = await getRelaysByPubkey([pubkey], { _nostrRelays })
  return relaysByPubkeyResult[pubkey]
}
const blossomServersByPubkey = {}
// Returns a mapping of pubkeys to their blossom server URLs (kind 10063).
export async function getBlossomServersByPubkey (pubkeys, { _nostrRelays = nostrRelays, _getRelaysByPubkey = getRelaysByPubkey } = {}) {
  const missingPubkeys = pubkeys.filter(pk => !blossomServersByPubkey[pk])
  if (missingPubkeys.length > 0) {
    const relaysByAuthor = await _getRelaysByPubkey(missingPubkeys)
    const relayToAuthors = pickRelaysForPubkeys(missingPubkeys, relaysByAuthor)

    const results = await Promise.all(
      [...relayToAuthors.entries()]
        .map(([relay, authors]) =>
          _nostrRelays.getEvents({ kinds: [10063], authors }, [relay])
        )
    )
    const allEvents = results.flatMap(r => r.result)

    const latestByPubkey = {}
    for (const event of allEvents) {
      if (!latestByPubkey[event.pubkey] || event.created_at > latestByPubkey[event.pubkey].created_at) {
        latestByPubkey[event.pubkey] = event
      }
    }

    for (const pubkey of missingPubkeys) {
      const event = latestByPubkey[pubkey]
      if (event) {
        blossomServersByPubkey[pubkey] = event.tags
          .filter(t => t[0] === 'server' && t[1])
          .map(t => t[1])
        maybeUnref(setTimeout(
          () => { delete blossomServersByPubkey[pubkey] },
          3 * 60 * 1000
        ))
      }
    }
  }
  return pubkeys.reduce((acc, pubkey) => {
    acc[pubkey] = blossomServersByPubkey[pubkey] || []
    return acc
  }, {})
}

export function eventToRelays (event) {
  if (typeof event !== 'object' || event === null || event.kind !== 10002 || typeof event.pubkey !== 'string') {
    throw new Error('invalid event')
  }

  const result = event.tags.filter(t => t[0] === 'r').reduce((r, t) => {
    switch (t[2]) {
      case 'read': r.read.push(t[1]); break
      case 'write': r.write.push(t[1]); break
      case '':
      default: r.read.push(t[1]); r.write.push(t[1])
    }
    return r
  }, { read: [], write: [], meta: { events: [event] } })
  result.read = [...new Set(result.read)]
  result.write = [...new Set(result.write)]

  return result
}
