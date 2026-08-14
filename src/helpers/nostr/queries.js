import nostrRelays, { seedRelays, freeRelays } from '#services/nostr-relays.js'
import { npubEncode } from 'libp2r2p/nip19'
import { pickRelaysForPubkeys } from 'libp2r2p/relay'
import { isValidPublicBlossomServerUrl, normalizeBlossomServerUrl } from 'libp2r2p/url'
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
    meta: { events: [], generatedName: true, generatedPicture: true }
  }
}

// Applies NIP-01 ordering for replaceable events.
export function isNewerReplaceableEvent (candidate, current) {
  if (!candidate) return false
  if (!current) return true
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at
  if (typeof candidate.id !== 'string') return false
  return typeof current.id !== 'string' || candidate.id < current.id
}

// Returns the kind 0 event that supplied a normalized profile.
export function getProfileEvent (profile) {
  return profile?.meta?.events?.find(event => event?.kind === 0) || null
}

// Keeps a real newer profile over stale data or a temporary generated fallback.
export function selectPreferredProfile (cachedProfile, freshProfile) {
  if (!cachedProfile) return freshProfile || null
  if (!freshProfile) return cachedProfile

  const cachedEvent = getProfileEvent(cachedProfile)
  const freshEvent = getProfileEvent(freshProfile)
  if (cachedEvent && freshEvent) {
    if (cachedEvent.id && cachedEvent.id === freshEvent.id) return freshProfile
    return isNewerReplaceableEvent(freshEvent, cachedEvent) ? freshProfile : cachedProfile
  }
  if (freshEvent) return freshProfile
  if (cachedEvent) return cachedProfile
  return freshProfile
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
    if (isNewerReplaceableEvent(event, latestByPk[event.pubkey])) latestByPk[event.pubkey] = event
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
  const publishedPicture =
    [event.tags.find(t => t[0] === 'picture')]
      .filter(Boolean)
      .map(t => t[1]?.trim?.())[0] ||
    eventContent.picture?.trim?.() ||
    null
  const picture = publishedPicture || `data:image/svg+xml;charset=utf-8,${
    encodeURIComponent(await _getSvgAvatar(event.pubkey))
  }`
  const publishedName =
    event.tags
      .filter(t => ['name', 'display_name'].includes(t[0]) && t[1]?.trim?.())
      .sort((a, b) => (b[0] === 'display_name' ? -1 : 1) - (a[0] === 'display_name' ? -1 : 1))[0]
      ?.[1]?.trim?.() ||
    eventContent.name?.trim?.() ||
    eventContent.display_name?.trim?.() ||
    null

  return {
    name: publishedName || `User#${getRandomId().slice(0, 5)}`,
    about:
      [event.tags.find(t => t[0] === 'about')]
        .filter(Boolean)
        .map(t => t[1]?.trim?.())[0] ||
      eventContent.about?.trim?.() ||
      '',
    picture,
    npub: npubEncode(event.pubkey),
    meta: {
      events: [event],
      generatedName: !publishedName,
      generatedPicture: !publishedPicture
    }
  }
}

const relaysByPubkey = {}
const relayRequestsByPubkey = new Map()

function cacheRelays (pubkey, relays) {
  relaysByPubkey[pubkey] = relays
  maybeUnref(setTimeout(() => {
    if (relaysByPubkey[pubkey] === relays) delete relaysByPubkey[pubkey]
  }, PROFILE_CACHE_TTL))
}

async function loadMissingRelays (pubkeys, nostrRelays) {
  const { result: getEventsResult, errors } = await nostrRelays.getEvents(
    { kinds: [10002], authors: pubkeys, limit: pubkeys.length },
    seedRelays
  )
  if (errors.length) console.log(errors)

  const latestByPubkey = {}
  for (const event of getEventsResult) {
    if (isNewerReplaceableEvent(event, latestByPubkey[event.pubkey])) latestByPubkey[event.pubkey] = event
  }

  for (const pubkey of pubkeys) {
    const event = latestByPubkey[pubkey]
    cacheRelays(pubkey, event
      ? eventToRelays(event)
      : { read: freeRelays.slice(0, 2), write: freeRelays.slice(0, 2), meta: { events: [] } }
    )
  }
}

// Returns a mapping of pubkeys to their relays.
export async function getRelaysByPubkey (pubkeys, { _nostrRelays = nostrRelays } = {}) {
  const uniquePubkeys = [...new Set(pubkeys)]
  const missingPubkeys = uniquePubkeys.filter(pk => !relaysByPubkey[pk])
  const pubkeysToLoad = missingPubkeys.filter(pk => !relayRequestsByPubkey.has(pk))
  if (pubkeysToLoad.length > 0) {
    const request = loadMissingRelays(pubkeysToLoad, _nostrRelays).finally(() => {
      for (const pubkey of pubkeysToLoad) {
        if (relayRequestsByPubkey.get(pubkey) === request) relayRequestsByPubkey.delete(pubkey)
      }
    })
    for (const pubkey of pubkeysToLoad) relayRequestsByPubkey.set(pubkey, request)
  }

  await Promise.all([...new Set(
    missingPubkeys.map(pk => relayRequestsByPubkey.get(pk)).filter(Boolean)
  )])

  return pubkeys.reduce((acc, pubkey) => {
    acc[pubkey] = relaysByPubkey[pubkey]
    return acc
  }, {})
}

// Returns the relays for a single pubkey.
export async function getRelays (pubkey, { _nostrRelays = nostrRelays } = {}) {
  const relaysByPubkeyResult = await getRelaysByPubkey([pubkey], { _nostrRelays })
  return relaysByPubkeyResult[pubkey]
}
const blossomServersByPubkey = {}
const blossomRequestsByPubkey = new Map()

function cacheBlossomServers (pubkey, servers) {
  blossomServersByPubkey[pubkey] = servers
  maybeUnref(setTimeout(() => {
    if (blossomServersByPubkey[pubkey] === servers) delete blossomServersByPubkey[pubkey]
  }, PROFILE_CACHE_TTL))
}

async function loadMissingBlossomServers (pubkeys, { nostrRelays, getRelaysByPubkey }) {
  const relaysByAuthor = await getRelaysByPubkey(pubkeys)
  const relayToAuthors = pickRelaysForPubkeys(pubkeys, relaysByAuthor)
  const results = await Promise.all(
    [...relayToAuthors.entries()].map(([relay, authors]) =>
      nostrRelays.getEvents({ kinds: [10063], authors }, [relay])
    )
  )
  const latestByPubkey = {}
  for (const event of results.flatMap(result => result.result)) {
    if (isNewerReplaceableEvent(event, latestByPubkey[event.pubkey])) latestByPubkey[event.pubkey] = event
  }
  for (const pubkey of pubkeys) {
    const event = latestByPubkey[pubkey]
    cacheBlossomServers(pubkey, event
      ? event.tags
        .filter(tag => tag[0] === 'server' && isValidPublicBlossomServerUrl(tag[1]))
        .map(tag => normalizeBlossomServerUrl(tag[1]))
      : []
    )
  }
}

// Returns a mapping of pubkeys to their blossom server URLs (kind 10063).
export async function getBlossomServersByPubkey (pubkeys, { _nostrRelays = nostrRelays, _getRelaysByPubkey = getRelaysByPubkey } = {}) {
  const uniquePubkeys = [...new Set(pubkeys)]
  const missingPubkeys = uniquePubkeys.filter(pk => !blossomServersByPubkey[pk])
  const pubkeysToLoad = missingPubkeys.filter(pk => !blossomRequestsByPubkey.has(pk))
  if (pubkeysToLoad.length > 0) {
    const request = loadMissingBlossomServers(pubkeysToLoad, {
      nostrRelays: _nostrRelays,
      getRelaysByPubkey: _getRelaysByPubkey
    }).finally(() => {
      for (const pubkey of pubkeysToLoad) {
        if (blossomRequestsByPubkey.get(pubkey) === request) blossomRequestsByPubkey.delete(pubkey)
      }
    })
    for (const pubkey of pubkeysToLoad) blossomRequestsByPubkey.set(pubkey, request)
  }

  await Promise.all([...new Set(
    missingPubkeys.map(pk => blossomRequestsByPubkey.get(pk)).filter(Boolean)
  )])

  return pubkeys.reduce((acc, pubkey) => {
    acc[pubkey] = blossomServersByPubkey[pubkey]
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
