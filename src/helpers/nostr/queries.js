import nostrRelays, { seedRelays, freeRelays } from '#services/nostr-relays.js'
import { npubEncode } from '#helpers/nostr/nip19.js'
import { getSvgAvatar } from '#helpers/avatar.js'
import { getRandomId } from '#helpers/misc.js'
import { maybeUnref } from '#helpers/timer.js'

const profilesByPubkey = {}
/**
 * Fetches profiles for multiple pubkeys efficiently.
 * Use the minimum set of relays that cover all pubkeys, limiting each pubkey to 2 relays at most.
 */
export async function getProfiles (pubkeys,
  { _nostrRelays = nostrRelays, _getRelaysByPubkey = getRelaysByPubkey, _getSvgAvatar = getSvgAvatar } = {}
) {
  const missingPubkeys = [...new Set(pubkeys)].filter(pk => !profilesByPubkey[pk])
  if (missingPubkeys.length > 0) {
    const relaysByAuthor = await _getRelaysByPubkey(missingPubkeys)

    const pkToPossibleRelays = new Map()
    for (const pk of missingPubkeys) {
      const wr = relaysByAuthor[pk].write
      pkToPossibleRelays.set(pk, new Set(wr.length > 0 ? wr : freeRelays.slice(0, 2)))
    }

    const uncovered = new Set(missingPubkeys)
    const selectedRelays = new Set()

    while (uncovered.size > 0) {
      const relayCounts = new Map()
      for (const pk of uncovered) {
        for (const r of pkToPossibleRelays.get(pk)) {
          relayCounts.set(r, (relayCounts.get(r) || 0) + 1)
        }
      }

      let bestRelay = null
      let maxCount = -1
      for (const [r, count] of relayCounts) {
        if (count > maxCount) {
          maxCount = count
          bestRelay = r
        }
      }

      if (!bestRelay) break

      selectedRelays.add(bestRelay)
      for (const pk of [...uncovered]) {
        if (pkToPossibleRelays.get(pk).has(bestRelay)) {
          uncovered.delete(pk)
        }
      }
    }

    const relayToAuthors = new Map()
    for (const r of selectedRelays) relayToAuthors.set(r, [])

    for (const pk of missingPubkeys) {
      let count = 0
      for (const r of selectedRelays) {
        if (pkToPossibleRelays.get(pk).has(r)) {
          relayToAuthors.get(r).push(pk)
          count++
          if (count >= 2) break
        }
      }
    }

    const results = await Promise.all(
      [...relayToAuthors.entries()]
        .filter(([_, authors]) => authors.length > 0)
        .map(([relay, authors]) =>
          _nostrRelays.getEvents({ kinds: [0], authors }, [relay], 5000)
        )
    )
    const allEvents = results.flatMap(r => r.result)

    const latestByPk = {}
    for (const event of allEvents) {
      if (!latestByPk[event.pubkey] || event.created_at > latestByPk[event.pubkey].created_at) {
        latestByPk[event.pubkey] = event
      }
    }

    for (const pk of missingPubkeys) {
      const event = latestByPk[pk]
      if (event) {
        profilesByPubkey[pk] = await eventToProfile(event, { _getSvgAvatar })
        maybeUnref(setTimeout(
          () => { delete profilesByPubkey[pk] },
          3 * 60 * 1000
        ))
      }
    }
  }

  const finalResults = {}
  for (const pk of pubkeys) {
    if (profilesByPubkey[pk]) {
      finalResults[pk] = profilesByPubkey[pk]
    } else {
      finalResults[pk] = {
        name: `User#${getRandomId().slice(0, 5)}`,
        about: '',
        picture: `data:image/svg+xml;charset=utf-8,${
          window.encodeURIComponent(await _getSvgAvatar(pk))
        }`,
        npub: npubEncode(pk),
        meta: { events: [] }
      }
    }
  }
  return finalResults
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
        window.encodeURIComponent(await _getSvgAvatar(event.pubkey))
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
