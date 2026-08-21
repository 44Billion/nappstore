import nostrRelays, { freeRelays } from '#services/nostr-relays.js'
import { npubEncode } from 'libp2r2p/nip19'
import {
  getLatestEventsByPubkey,
  getRelaysByPubkey as getNip65RelaysByPubkey,
  pickRelaysForPubkeys
} from 'libp2r2p/relay'
import { isValidPublicBlossomServerUrl, normalizeBlossomServerUrl } from 'libp2r2p/url'
import { getSvgAvatar } from '#helpers/avatar.js'
import { getRandomId } from '#helpers/misc.js'
import { maybeUnref } from '#helpers/timer.js'

export { pickRelaysForPubkeys }

const PROFILE_CACHE_TTL = 3 * 60 * 1000
const PROFILE_FALLBACK_RELAY_LIMIT = 3
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
    nip05: null,
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

async function loadMissingProfiles (pubkeys, { nostrRelays, getRelaysByPubkey, getAvatar, fallbackRelays }) {
  const { byPubkey } = await getLatestEventsByPubkey(pubkeys, {
    kinds: [0],
    fallbackRelays: fallbackRelays.slice(0, PROFILE_FALLBACK_RELAY_LIMIT),
    _getRelaysByPubkey: getRelaysByPubkey,
    _getEvents: (filter, relays) => nostrRelays.getEvents(filter, relays)
  })

  const loadedProfiles = {}
  await Promise.all(pubkeys.map(async pubkey => {
    const event = byPubkey[pubkey]
    const profile = event
      ? await eventToProfile(event, { _getSvgAvatar: getAvatar })
      : await createFallbackProfile(pubkey, getAvatar)
    loadedProfiles[pubkey] = profile
    // A generated profile represents a transient miss, not durable metadata.
    if (event) cacheProfile(pubkey, profile)
  }))
  return loadedProfiles
}

/**
 * Fetches profiles for multiple pubkeys efficiently.
 * Batches authors across their primary and fallback relays.
 */
export async function getProfiles (pubkeys,
  {
    _nostrRelays = nostrRelays,
    _getRelaysByPubkey = getRelaysByPubkey,
    _getSvgAvatar = getSvgAvatar,
    _freeRelays = freeRelays
  } = {}
) {
  const missingPubkeys = [...new Set(pubkeys)].filter(pk => !profilesByPubkey[pk])
  const pubkeysToLoad = missingPubkeys.filter(pk => !profileRequestsByPubkey.has(pk))

  if (pubkeysToLoad.length > 0) {
    const request = loadMissingProfiles(pubkeysToLoad, {
      nostrRelays: _nostrRelays,
      getRelaysByPubkey: _getRelaysByPubkey,
      getAvatar: _getSvgAvatar,
      fallbackRelays: _freeRelays
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

  const requestResults = await Promise.all([...new Set(
    missingPubkeys.map(pk => profileRequestsByPubkey.get(pk)).filter(Boolean)
  )])

  return pubkeys.reduce((profiles, pubkey) => {
    profiles[pubkey] = profilesByPubkey[pubkey] || requestResults
      .find(result => Object.prototype.hasOwnProperty.call(result, pubkey))?.[pubkey]
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

  const nip05 =
    [event.tags.find(tag => tag[0] === 'nip05')]
      .filter(Boolean)
      .map(tag => tag[1]?.trim?.())[0] ||
    (typeof eventContent.nip05 === 'string' ? eventContent.nip05.trim() : '') ||
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
    nip05,
    meta: {
      events: [event],
      generatedName: !publishedName,
      generatedPicture: !publishedPicture
    }
  }
}

// Returns a mapping of pubkeys to their relays.
export async function getRelaysByPubkey (pubkeys, { _nostrRelays = nostrRelays } = {}) {
  const options = { cacheMs: PROFILE_CACHE_TTL }
  if (_nostrRelays !== nostrRelays) {
    options._getEvents = (...args) => _nostrRelays.getEvents(...args)
  }
  return await getNip65RelaysByPubkey(pubkeys, options)
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
