import nostrRelays, { seedRelays, freeRelays } from '#services/nostr-relays.js'
import { npubEncode } from '#helpers/nostr/nip19.js'
import { getSvgAvatar } from 'avatar'
import { getRandomId, maybeUnref } from 'helpers/misc.js'

const profilesByPubkey = {}
export async function getProfile (pubkey,
  { _nostrRelays = nostrRelays, _getRelays = getRelays, _getSvgAvatar = getSvgAvatar } = {}
) {
  if (profilesByPubkey[pubkey]) return profilesByPubkey[pubkey]
  let profile
  let isntFallback
  try {
    const { write: writeRelays } = await _getRelays(pubkey)
    const { result, errors } = await _nostrRelays.getEvents({ kinds: [0], authors: [pubkey], limit: 1 }, writeRelays)
    const event = result.sort((a, b) => b.created_at - a.created_at)[0]
    if (!event) {
      if (errors.length) throw new Error(errors.join('\n'))
      isntFallback = false
    } else {
      profile = eventToProfile(event, { _getSvgAvatar })
      isntFallback = true
    }
  } catch (err) {
    isntFallback = false
    console.log(err.stack)
  }

  if (!profile) {
    profile = {
      name: `User#${getRandomId().slice(0, 5)}`,
      about: '',
      picture: await _getSvgAvatar(pubkey),
      npub: npubEncode(pubkey),
      meta: {
        events: []
      }
    }
  }

  if (isntFallback) {
    profilesByPubkey[pubkey] = profile
    maybeUnref(setTimeout(
      () => { delete profilesByPubkey[pubkey] },
      3 * 60 * 1000
    ))
  }
  return profile
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
      await _getSvgAvatar(event.pubkey),
    npub: npubEncode(event.pubkey),
    meta: {
      events: [event]
    }
  }
}

const relaysByPubkey = {}
export async function getRelays (pubkey, { _nostrRelays = nostrRelays } = {}) {
  if (relaysByPubkey[pubkey]) return relaysByPubkey[pubkey]

  const { result: getEventsResult, errors } = await nostrRelays.getEvents({ kinds: [10002], authors: [pubkey], limit: 1 }, seedRelays)
  const event = getEventsResult.sort((a, b) => b.created_at - a.created_at)[0]
  if (!event) {
    if (errors.length) console.log(errors)
    return { read: freeRelays.slice(0, 2), write: freeRelays.slice(0, 2), meta: { events: [] } }
  }

  const relays = eventToRelays(event)
  relaysByPubkey[pubkey] = relays
  maybeUnref(setTimeout(
    () => { delete relaysByPubkey[pubkey] },
    3 * 60 * 1000
  ))
  return relays
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
