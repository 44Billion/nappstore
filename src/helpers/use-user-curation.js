import { useGlobalStore } from '#f'
import { SITE_CURATION_SET } from 'libp2r2p/kind'
import { npubEncode } from 'libp2r2p/nip19'
import { decodeUserReference } from 'libp2r2p/nip27'
import nostrRelays, { nappRelays, sendEventReport } from '#services/nostr-relays.js'
import { getProfiles, getRelays } from '#helpers/nostr/queries.js'
import { maybePeekPublicKey } from '#helpers/nostr/nip07.js'
import { getLauncherOrigin } from '#helpers/launcher-url.js'

const STARRED_D_TAG = 'starred'
const MANIFEST_KINDS = new Set([35128, 35129, 35130])

function parseStarredAddresses (event) {
  if (!event || !Array.isArray(event.tags)) return []
  const addresses = []
  for (const tag of event.tags) {
    if (tag?.[0] !== 'a' || typeof tag[1] !== 'string') continue
    const match = tag[1].match(/^(\d+):([0-9a-f]{64}):(.+)$/)
    if (!match || !MANIFEST_KINDS.has(Number(match[1]))) continue
    addresses.push(tag[1])
  }
  return [...new Set(addresses)]
}

export function useUserCuration () {
  return useGlobalStore('_nappstore_user_curation', () => ({
    userPubkey$: null,
    userNip05$: null,
    starredAddresses$: [],
    starredLoaded$: false,
    starredLoading$: false,

    async load () {
      if (this.starredLoading$() || this.starredLoaded$()) return
      this.starredLoading$(true)
      try {
        const pubkey = await maybePeekPublicKey()
        this.userPubkey$(pubkey)
        if (!pubkey) return

        let relays
        try {
          relays = await getRelays(pubkey)
        } catch {
          relays = { write: [] }
        }
        const allRelays = [...new Set([...(relays?.write || []), ...nappRelays])]
        const { result: events } = await nostrRelays.getEvents(
          {
            kinds: [SITE_CURATION_SET],
            authors: [pubkey],
            '#d': [STARRED_D_TAG],
            limit: 20
          },
          allRelays
        )
        const latest = (events || [])
          .sort((a, b) => b.created_at - a.created_at ||
            String(a.id).localeCompare(String(b.id)))[0]
        this.starredAddresses$(parseStarredAddresses(latest))

        try {
          const profile = (await getProfiles([pubkey]))[pubkey]
          this.userNip05$(typeof profile?.nip05 === 'string' && profile.nip05 ? profile.nip05 : null)
        } catch {
          this.userNip05$(null)
        }
      } catch (err) {
        console.error('Failed to load starred apps:', err)
      } finally {
        this.starredLoaded$(true)
        this.starredLoading$(false)
      }
    },

    async toggleStar (address) {
      const pubkey = this.userPubkey$()
      if (!pubkey) throw new Error('No user')
      const current = this.starredAddresses$()
      const next = current.includes(address)
        ? current.filter(value => value !== address)
        : [...current, address]
      this.starredAddresses$(next)

      try {
        let relays
        try {
          relays = await getRelays(pubkey)
        } catch {
          relays = { write: [] }
        }
        const allRelays = [...new Set([...(relays?.write || []), ...nappRelays])]
        const event = {
          kind: SITE_CURATION_SET,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['d', STARRED_D_TAG],
            ...next.map(address => ['a', address])
          ],
          content: ''
        }
        const signedEvent = await window.nostr.signEvent(event)
        const report = await sendEventReport(signedEvent, allRelays)
        if (report?.errors?.length && report.errors.length >= allRelays.length) {
          this.starredAddresses$(current)
          throw new Error('Failed to publish starred apps')
        }
      } catch (err) {
        this.starredAddresses$(current)
        throw err
      }
    },

    isStarred (address) {
      return this.starredAddresses$().includes(address)
    },

    shareStarredUrl () {
      const pubkey = this.userPubkey$()
      if (!pubkey || this.starredAddresses$().length === 0) return null
      const nip05 = this.userNip05$()
      const by = (nip05 && decodeUserReference(nip05)?.raw) || nip05 || npubEncode(pubkey)
      return `${getLauncherOrigin()}/+apps?by=${encodeURIComponent(by)}&is=starred`
    }
  }))
}
