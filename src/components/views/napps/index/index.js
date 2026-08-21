import { f, useCallback, useStore, useTask, useSignal, useGlobalSignal, useLocation } from '#f'
import '#f/components/f-to-signals.js'
import { appEncode, naddrEncode } from 'libp2r2p/nip19'
import { SITE_CURATION_SET } from 'libp2r2p/kind'
import { decodeUserReference, resolveUserReference } from 'libp2r2p/nip27'
import {
  isValidPublicRelayUrl,
  normalizeRelayUrl
} from 'libp2r2p/url'
import {
  getBlossomServersByPubkey,
  getProfiles,
  getRelaysByPubkey,
  pickRelaysForPubkeys
} from '#helpers/nostr/queries.js'
import nostrRelays, { nappRelays } from '#services/nostr-relays.js'
import { fetchAppMetadata, needsHtmlMetadataFallback } from '#services/app-metadata-fetcher.js'
import { findMarkedManifestAsset, getManifestMetadata } from '#helpers/manifest.js'
import { getAppIconLogPrefix } from '#helpers/app.js'
import { cssVars } from '#assets/styles/theme.js'
import { getAppLauncherUrl, getAppLauncherUrlForApp, getStoreShareUrl } from '#helpers/launcher-url.js'
import { useUserCuration } from '#helpers/use-user-curation.js'
import { useToast } from '#shared/toast.js'
import lru from '#services/lru.js'
import '#shared/app-icon.js'
import '#shared/avatar.js'
import '#shared/icons/icon-filter.js'
import '#shared/icons/icon-share.js'
import '#shared/icons/icon-x.js'
import '#views/napps/index/app-list-item.js'
import '#views/napps/index/curation-set-card.js'

const APPS_PER_PAGE = 20
const DEFAULT_MANIFEST_KIND = 35128
const PROFILE_RETRY_DELAY_MS = 15000
const MANIFEST_KINDS = [35128, 35129, 35130]
const DEFAULT_CURATION_D_TAG = 'starred'

function getTagValue (tags, key) {
  if (!Array.isArray(tags)) return null
  const tag = tags.find(entry => Array.isArray(entry) && entry[0] === key)
  return tag ? tag.slice(1) : null
}

// Returns the first non-empty description without exposing temporary fallbacks.
function getAppDescription (...values) {
  return values
    .find(value => typeof value === 'string' && value.trim())
    ?.trim() || ''
}

function appAddress (app) {
  return `${app.kind}:${app.pubkey}:${app.dTag}`
}

function normalizeStoreRelay (value) {
  try {
    const normalized = normalizeRelayUrl(value)
    const url = new URL(normalized)
    const isDev = typeof IS_DEVELOPMENT !== 'undefined' && IS_DEVELOPMENT
    const isLocalHost = url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.endsWith('.localhost')
    if (isLocalHost && !isDev) return null
    if (url.protocol === 'ws:' && !(isLocalHost && isDev)) return null
    if (!isLocalHost && !isValidPublicRelayUrl(normalized)) return null
    return normalized
  } catch {
    return null
  }
}

function formatAccountLabel (label) {
  if (typeof label !== 'string' || !label) return ''
  return label
}

function shortAccountLabel (label) {
  const formatted = formatAccountLabel(label)
  if (formatted.length <= 20) return formatted
  if (label.startsWith('npub1') || label.startsWith('nprofile1') || /^[0-9a-f]{64}$/.test(label)) {
    return `${formatted.slice(0, 20)}…`
  }
  return formatted
}

// Lazy lists apps with optional `by` (author/curation), `is` (publisher or
// curation d tag) and `at` (explicit relay) sections.
f('nappsIndex', function () {
  const loc = useLocation()
  const filterBarOpen$ = useGlobalSignal('nappstore-filter-bar', false)
  const { showToast } = useToast()
  const userCuration = useUserCuration()

  const store = useStore(() => ({
    apps$: [],
    isLoading$: false,
    hasMore$: true,
    oldestTimestamp$: Math.floor(Date.now() / 1000),
    profileCache$: {},
    includingSpam$: false,
    isFirstLoad$: true,
    pendingOpenAppId$: null,
    pendingOpenTimeoutId$: null,
    pendingProfileRetryPubkeys$: [],
    retriedProfilePubkeys$: [],
    profileRetryTimeoutId$: null,

    byAuthors$: [],
    byApps$: [],
    byIsLoading$: false,
    byHasMore$: true,
    byOldestTimestamp$: Math.floor(Date.now() / 1000),
    bySeenKeys$: [],
    byStarredLoaded$: false,
    byResolving$: false,
    curationGroups$: [],

    atRelays$: [],
    atApps$: [],
    atIsLoading$: false,
    atHasMore$: true,
    atOldestTimestamp$: Math.floor(Date.now() / 1000),
    atSeenKeys$: [],

    isFilters$: [],
    asFilters$: [],
    noFilters$: [],
    syncToken$: 0,
    lastByQueryKey$: '',
    lastAtQueryKey$: '',

    showOpenFeedback (appId) {
      const existingTimeout = this.pendingOpenTimeoutId$()
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }
      this.pendingOpenAppId$(appId)
      const timeoutId = setTimeout(() => {
        this.pendingOpenAppId$(null)
        this.pendingOpenTimeoutId$(null)
      }, 3000)
      this.pendingOpenTimeoutId$(timeoutId)
    },

    updateAppById (appId, updater) {
      for (const key of ['apps$', 'byApps$', 'atApps$']) {
        this[key](list => list.map(app => app.id === appId ? updater(app) : app))
      }
    },

    // Streams unified manifest events from the relay and updates the UI as each arrives.
    async loadMoreApps () {
      if (this.isLoading$() || !this.hasMore$()) return
      this.isLoading$(true)

      try {
        let retryWithSpam = true
        while (retryWithSpam) {
          retryWithSpam = false

          const filter = {
            kinds: [35128],
            until: this.oldestTimestamp$(),
            limit: APPS_PER_PAGE
          }
          if (this.includingSpam$()) filter.search = 'is:spam'

          const existingKeys = new Set(
            this.apps$().map(app => `${app.pubkey}:${app.kind}:${app.dTag}`)
          )
          const candidateEntries = []
          let rawEventCount = 0
          let oldestCreatedAt = this.oldestTimestamp$()

          const generator = nostrRelays.getEventsGenerator(filter, nappRelays, { timeout: 20000 })
          for await (const item of generator) {
            if (item.type !== 'event') continue
            const event = item.event
            rawEventCount++
            if (event.created_at < oldestCreatedAt) oldestCreatedAt = event.created_at

            const dTagValue = getTagValue(event.tags, 'd')?.[0]
            if (!dTagValue) continue
            const key = `${event.pubkey}:${event.kind}:${dTagValue}`
            if (existingKeys.has(key)) continue
            existingKeys.add(key)

            const app = this.createAppFromManifestEvent(event)
            if (!app) continue
            candidateEntries.push({ app, event })
          }

          this.apps$([...this.apps$(), ...candidateEntries.map(entry => entry.app)])
          const pendingManifestEvents = candidateEntries.map(entry => entry.event)
          const newAppCount = candidateEntries.length

          if (rawEventCount > 0) this.oldestTimestamp$(oldestCreatedAt - 1)
          if (pendingManifestEvents.length > 0) this.fetchMetadataAndProfiles(pendingManifestEvents)

          const seemsExhausted = rawEventCount === 0 ||
            (newAppCount < APPS_PER_PAGE / 2 && rawEventCount < APPS_PER_PAGE)
          if (seemsExhausted && !this.includingSpam$()) {
            this.includingSpam$(true)
            this.oldestTimestamp$(Math.floor(Date.now() / 1000))
            retryWithSpam = true
            continue
          }
          if (seemsExhausted) this.hasMore$(false)
        }
        this.isFirstLoad$(false)
      } catch (err) {
        console.error('Failed to load apps:', err)
      } finally {
        this.isLoading$(false)
      }
    },

    // Builds a lightweight app object directly from a unified manifest.
    createAppFromManifestEvent (manifestEvent) {
      const dTagArray = getTagValue(manifestEvent.tags, 'd')
      if (!dTagArray?.[0]) return null
      const dTag = dTagArray[0]
      const bundleKind = MANIFEST_KINDS.includes(manifestEvent.kind)
        ? manifestEvent.kind
        : DEFAULT_MANIFEST_KIND

      const encodedApp = appEncode({
        dTag,
        pubkey: manifestEvent.pubkey,
        kind: bundleKind
      })
      const metadata = getManifestMetadata(manifestEvent)
      const icon = findMarkedManifestAsset(manifestEvent, 'icon')
      const description = getAppDescription(metadata.description, metadata.summary)

      return {
        id: encodedApp,
        dTag,
        pubkey: manifestEvent.pubkey,
        kind: bundleKind,
        name: metadata.name || dTag,
        description,
        descriptionResolutionPending: !description,
        iconFx: icon?.root || null,
        iconResolutionPending: true,
        uploadedAt: manifestEvent.created_at * 1000
      }
    },

    // Background task: resolves HTML/favicon fallbacks and fetches profiles.
    async fetchMetadataAndProfiles (manifestEvents) {
      const pendingAppIds = new Set(
        manifestEvents
          .map(manifestEvent => this.createAppFromManifestEvent(manifestEvent)?.id)
          .filter(Boolean)
      )
      try {
        const authorPubkeys = [...new Set(manifestEvents.map(e => e.pubkey))]
        const profilesPromise = this.loadProfiles(authorPubkeys)

        const iconCache = lru.ns('apps')
        const manifestsByAuthor = new Map()
        for (const manifestEvent of manifestEvents) {
          const events = manifestsByAuthor.get(manifestEvent.pubkey) || []
          events.push(manifestEvent)
          manifestsByAuthor.set(manifestEvent.pubkey, events)
        }

        await Promise.all([...manifestsByAuthor].map(async ([pubkey, authorEvents]) => {
          let relaysByAuthor
          let blossomServersByAuthor
          try {
            relaysByAuthor = await getRelaysByPubkey([pubkey])
            blossomServersByAuthor = await getBlossomServersByPubkey([pubkey], {
              _getRelaysByPubkey: async () => relaysByAuthor
            })
          } catch (err) {
            const logPrefixes = authorEvents
              .map(event => this.createAppFromManifestEvent(event)?.id)
              .filter(Boolean)
              .map(getAppIconLogPrefix)
              .join(' ')
            console.error(`${logPrefixes || getAppIconLogPrefix(null)} Failed to fetch app author services:`, err)
          }

          const relays = [...new Set([
            ...(relaysByAuthor?.[pubkey]?.write || []),
            ...nappRelays
          ])]
          const blossomServers = blossomServersByAuthor?.[pubkey] || []

          await Promise.all(authorEvents.map(async manifestEvent => {
            const app = this.createAppFromManifestEvent(manifestEvent)
            if (!app) return
            const cacheKey = `appById_${app.id}_icon`
            let metadata
            try {
              metadata = await fetchAppMetadata(manifestEvent, relays, {
                blossomServers,
                cachedIcon: iconCache.getItem(cacheKey),
                skipHtml: true,
                appId: app.id
              })
              if (metadata.icon) iconCache.setItem(cacheKey, metadata.icon)
              const needsHtml = needsHtmlMetadataFallback(metadata)

              this.updateAppById(app.id, current => {
                const description = getAppDescription(metadata.description, current.description)
                return {
                  ...current,
                  name: metadata.name || current.name,
                  description,
                  descriptionResolutionPending: !description && needsHtml,
                  iconFx: metadata.icon?.fx || current.iconFx,
                  iconResolutionPending: needsHtml
                }
              })

              if (needsHtml) {
                metadata = await fetchAppMetadata(manifestEvent, relays, {
                  blossomServers,
                  cachedIcon: metadata.icon,
                  appId: app.id
                })
                if (metadata.icon) iconCache.setItem(cacheKey, metadata.icon)
              }
            } catch (err) {
              console.error(`${getAppIconLogPrefix(app.id)} Failed to fetch app metadata:`, err)
            } finally {
              this.updateAppById(app.id, current => {
                const description = getAppDescription(metadata?.description, current.description)
                return {
                  ...current,
                  name: metadata?.name || current.name,
                  description,
                  descriptionResolutionPending: false,
                  iconFx: metadata?.icon?.fx || current.iconFx,
                  iconResolutionPending: false
                }
              })
            }
          }))
        }))
        await profilesPromise
      } catch (err) {
        console.error('Failed to fetch app metadata and profiles:', err)
      } finally {
        for (const appId of pendingAppIds) {
          this.updateAppById(appId, app => {
            if (!app.iconResolutionPending && !app.descriptionResolutionPending) return app
            return {
              ...app,
              descriptionResolutionPending: false,
              iconResolutionPending: false
            }
          })
        }
      }
    },

    scheduleProfileRetry (pubkeys) {
      const alreadyRetried = new Set(this.retriedProfilePubkeys$())
      const queued = new Set(this.pendingProfileRetryPubkeys$())
      for (const pubkey of pubkeys) {
        if (!alreadyRetried.has(pubkey)) queued.add(pubkey)
      }
      this.pendingProfileRetryPubkeys$([...queued])
      if (!queued.size || this.profileRetryTimeoutId$()) return

      const timeoutId = setTimeout(() => {
        this.profileRetryTimeoutId$(null)
        const pending = this.pendingProfileRetryPubkeys$()
        this.pendingProfileRetryPubkeys$([])
        this.retriedProfilePubkeys$([...new Set([
          ...this.retriedProfilePubkeys$(),
          ...pending
        ])])
        this.loadProfiles(pending, { retryGenerated: true })
      }, PROFILE_RETRY_DELAY_MS)
      this.profileRetryTimeoutId$(timeoutId)
    },

    async loadProfiles (pubkeys, { retryGenerated = false } = {}) {
      const profileCache = this.profileCache$()
      const uniquePubkeys = [...new Set(pubkeys)].filter(
        pk => !Object.prototype.hasOwnProperty.call(profileCache, pk) ||
          (retryGenerated && profileCache[pk]?.meta?.generatedName)
      )
      if (uniquePubkeys.length === 0) return

      try {
        const results = await getProfiles(uniquePubkeys)
        this.profileCache$(current => ({ ...current, ...results }))
        if (!retryGenerated) {
          this.scheduleProfileRetry(uniquePubkeys.filter(
            pubkey => results[pubkey]?.meta?.generatedName
          ))
        }
      } catch (err) {
        console.error('Failed to load profiles:', err)
        this.profileCache$(current => {
          const next = { ...current }
          for (const pubkey of uniquePubkeys) {
            if (!Object.prototype.hasOwnProperty.call(next, pubkey)) {
              next[pubkey] = {
                name: '',
                meta: { events: [], generatedName: true, loadFailed: true }
              }
            }
          }
          return next
        })
        if (!retryGenerated) this.scheduleProfileRetry(uniquePubkeys)
      }
    },

    handleOpenApp (app) {
      this.showOpenFeedback(app.id)
      const encodedApp = appEncode({
        dTag: app.dTag,
        pubkey: app.pubkey,
        kind: app.kind
      })
      window.open(getAppLauncherUrl(encodedApp), '_blank')
    },

    async copyAppUrl (app) {
      const profile = this.profileCache$()[app.pubkey] || null
      const url = getAppLauncherUrlForApp({
        dTag: app.dTag,
        pubkey: app.pubkey,
        kind: app.kind,
        nip05: profile?.nip05 || null
      })
      try {
        await navigator.clipboard.writeText(url)
        showToast('URL copied to clipboard!', 'success')
      } catch {
        showToast('Could not copy URL', 'error')
      }
    },

    async toggleStar (app) {
      await userCuration.load()
      if (!userCuration.userPubkey$()) {
        showToast('Sign in to star apps', 'info')
        return
      }
      try {
        await userCuration.toggleStar(appAddress(app))
      } catch {
        showToast('Failed to update starred apps', 'error')
      }
    },

    resetBySection () {
      this.byApps$([])
      this.byIsLoading$(false)
      this.byHasMore$(true)
      this.byOldestTimestamp$(Math.floor(Date.now() / 1000))
      this.bySeenKeys$([])
      this.byStarredLoaded$(false)
      this.curationGroups$([])
    },

    resetAtSection () {
      this.atApps$([])
      this.atIsLoading$(false)
      this.atHasMore$(true)
      this.atOldestTimestamp$(Math.floor(Date.now() / 1000))
      this.atSeenKeys$([])
    },

    syncFromQuery (params) {
      const byValues = params.getAll('by').map(value => value.trim()).filter(Boolean)
      const atValues = params.getAll('at').map(value => value.trim()).filter(Boolean)
      const asValues = params.getAll('as')
        .map(value => value.trim())
        .filter(value => value === 'publisher')
      const isValues = params.getAll('is')
        .map(value => value.trim())
        .filter(Boolean)
      const noValues = params.getAll('no')
        .map(value => value.trim())
        .filter(value => value === 'as' || value === 'is')
      const activeIs = byValues.length ? isValues : []
      const activeAs = byValues.length ? asValues : []
      const activeNo = byValues.length ? noValues : []
      const queryKey = JSON.stringify({
        by: byValues,
        as: asValues,
        is: isValues,
        no: noValues,
        at: atValues
      })
      const byKey = JSON.stringify({
        by: byValues,
        as: activeAs,
        is: activeIs,
        no: activeNo
      })
      const atKey = JSON.stringify({ at: atValues })

      // Each section only reloads when its own inputs changed.
      if (atKey !== this.lastAtQueryKey$()) {
        this.lastAtQueryKey$(atKey)
        this.atRelays$(atValues.map(normalizeStoreRelay).filter(Boolean))
        this.resetAtSection()
        if (this.atRelays$().length) this.loadMoreAtApps()
      }

      if (byKey === this.lastByQueryKey$()) return
      this.lastByQueryKey$(byKey)
      this.isFilters$(activeIs)
      this.asFilters$(activeAs)
      this.noFilters$(activeNo)
      this.byAuthors$([])
      this.resetBySection()
      if (!byValues.length) return

      const token = this.syncToken$() + 1
      this.syncToken$(token)
      this.byResolving$(true)
      Promise.all(byValues.map(async value => {
        try {
          const resolved = await resolveUserReference(value)
          return resolved ? { pubkey: resolved.pubkey, label: resolved.label } : null
        } catch {
          return null
        }
      })).then(results => {
        if (this.syncToken$() !== token) return
        const authors = results.filter(Boolean)
        this.byAuthors$(authors)
        this.byResolving$(false)
        if (authors.length) {
          this.loadProfiles(authors.map(author => author.pubkey))
          this.loadMoreByApps()
        }
        const canonicalBy = authors.map(author => author.label)
        const canonicalQueryKey = JSON.stringify({
          by: canonicalBy,
          as: asValues,
          is: isValues,
          no: noValues,
          at: atValues
        })
        if (canonicalQueryKey !== queryKey) {
          const canonicalByKey = JSON.stringify({
            by: canonicalBy,
            as: activeAs,
            is: activeIs,
            no: activeNo
          })
          this.lastByQueryKey$(canonicalByKey)
          loc.replaceState(null, '', this.buildQueryUrl({
            by: canonicalBy,
            as: asValues,
            is: isValues,
            no: noValues,
            at: atValues
          }))
        }
      })
    },

    async loadStarredApps () {
      const authors = this.byAuthors$()
      if (!authors.length) return
      const authorPubkeys = authors.map(author => author.pubkey)
      const relaysByAuthor = await getRelaysByPubkey(authorPubkeys)
      const relayToAuthors = pickRelaysForPubkeys(authorPubkeys, relaysByAuthor)
      const relays = [...new Set([...relayToAuthors.keys(), ...nappRelays])]
      const isFilters = this.isFilters$()
      const as = this.asFilters$()
      const no = this.noFilters$()
      const defaultMode = as.length === 0 && isFilters.length === 0
      const curationDTags = isFilters.length ? isFilters : null
      const includePublisher = defaultMode
        ? !no.includes('as')
        : as.includes('publisher')
      const splitMode = includePublisher

      const filter = {
        kinds: [SITE_CURATION_SET],
        authors: authorPubkeys,
        limit: 100
      }
      if (curationDTags) filter['#d'] = curationDTags
      const { result: events } = await nostrRelays.getEvents(filter, relays)

      const latestByAddress = {}
      for (const event of events || []) {
        const dTag = getTagValue(event.tags, 'd')?.[0]
        if (!dTag || (curationDTags && !curationDTags.includes(dTag))) continue
        const addressKey = `${event.pubkey}:${dTag}`
        const current = latestByAddress[addressKey]
        if (!current ||
          event.created_at > current.created_at ||
          (event.created_at === current.created_at && event.id > current.id)) {
          latestByAddress[addressKey] = event
        }
      }

      const groups = new Map()
      const addresses = []
      for (const event of Object.values(latestByAddress)) {
        const dTag = getTagValue(event.tags, 'd')?.[0]
        if (!dTag) continue
        let group = groups.get(dTag)
        if (!group) group = { dTag, title: null, description: null, addresses: [] }
        if (!group.authorPubkey) group.authorPubkey = event.pubkey
        const title = getTagValue(event.tags, 'title')?.[0]
        const description = getTagValue(event.tags, 'description')?.[0]
        if (!group.title && title) group.title = title
        if (!group.description && description) group.description = description
        for (const tag of event?.tags || []) {
          if (tag?.[0] !== 'a' || typeof tag[1] !== 'string') continue
          const match = tag[1].match(/^(\d+):([0-9a-f]{64}):(.+)$/)
          if (!match || !MANIFEST_KINDS.includes(Number(match[1]))) continue
          group.addresses.push(tag[1])
          addresses.push({
            kind: Number(match[1]),
            pubkey: match[2],
            dTag: match[3]
          })
        }
        groups.set(dTag, group)
      }
      const orderedGroups = [...groups.values()].map(group => ({
        ...group,
        authorRelays: (relaysByAuthor[group.authorPubkey]?.write || []).slice(0, 2),
        addresses: [...new Set(group.addresses)]
      }))
      const order = isFilters.length ? isFilters : [DEFAULT_CURATION_D_TAG]
      orderedGroups.sort((left, right) => {
        const leftIndex = order.indexOf(left.dTag)
        const rightIndex = order.indexOf(right.dTag)
        if (leftIndex === -1 && rightIndex === -1) return left.dTag.localeCompare(right.dTag)
        if (leftIndex === -1) return 1
        if (rightIndex === -1) return -1
        return leftIndex - rightIndex
      })
      this.curationGroups$(orderedGroups)

      const uniqueAddresses = [...new Map(
        addresses.map(address => [`${address.kind}:${address.pubkey}:${address.dTag}`, address])
      ).values()]
      if (!uniqueAddresses.length) return

      const appAuthors = [...new Set(uniqueAddresses.map(address => address.pubkey))]
      const appRelaysByAuthor = await getRelaysByPubkey(appAuthors)
      const appRelayToAuthors = pickRelaysForPubkeys(appAuthors, appRelaysByAuthor)
      const appRelays = [...new Set([...appRelayToAuthors.keys(), ...nappRelays])]
      const { result: manifests } = await nostrRelays.getEvents(
        {
          kinds: [...new Set(uniqueAddresses.map(address => address.kind))],
          authors: appAuthors,
          '#d': [...new Set(uniqueAddresses.map(address => address.dTag))],
          limit: uniqueAddresses.length * 2
        },
        appRelays
      )

      const seen = new Set(this.bySeenKeys$())
      const wanted = new Set(uniqueAddresses.map(address =>
        `${address.kind}:${address.pubkey}:${address.dTag}`
      ))
      const candidateEntries = []
      for (const event of manifests || []) {
        const dTag = getTagValue(event.tags, 'd')?.[0]
        if (!dTag) continue
        const address = `${event.kind}:${event.pubkey}:${dTag}`
        const key = splitMode ? `curated:${address}` : address
        if (!wanted.has(address) || seen.has(key)) continue
        seen.add(key)
        const app = this.createAppFromManifestEvent(event)
        if (app) {
          app.source = 'curated'
          candidateEntries.push({ app, event })
        }
      }
      this.bySeenKeys$([...seen])
      this.byApps$([...this.byApps$(), ...candidateEntries.map(entry => entry.app)])
      if (candidateEntries.length) {
        this.fetchMetadataAndProfiles(candidateEntries.map(entry => entry.event))
      }
    },

    async loadMoreByApps () {
      if (this.byIsLoading$() || !this.byHasMore$()) return
      const authors = this.byAuthors$()
      if (!authors.length) return

      const is = this.isFilters$()
      const as = this.asFilters$()
      const no = this.noFilters$()
      const defaultMode = as.length === 0 && is.length === 0
      const includePublisher = defaultMode
        ? !no.includes('as')
        : as.includes('publisher')
      const includeStarred = defaultMode
        ? !no.includes('is')
        : is.length > 0
      const splitMode = includePublisher && includeStarred
      if (!includePublisher && !includeStarred) {
        this.byHasMore$(false)
        return
      }

      this.byIsLoading$(true)
      try {
        if (includeStarred && !this.byStarredLoaded$()) {
          await this.loadStarredApps()
          this.byStarredLoaded$(true)
        }
        if (!includePublisher) {
          this.byHasMore$(false)
          return
        }

        const authorPubkeys = authors.map(author => author.pubkey)
        const relaysByAuthor = await getRelaysByPubkey(authorPubkeys)
        const relayToAuthors = pickRelaysForPubkeys(authorPubkeys, relaysByAuthor)
        const relays = [...new Set([...relayToAuthors.keys(), ...nappRelays])]
        const filter = {
          kinds: [35128],
          authors: authorPubkeys,
          until: this.byOldestTimestamp$(),
          limit: APPS_PER_PAGE
        }

        const existingKeys = new Set(this.bySeenKeys$())
        const candidateEntries = []
        let rawEventCount = 0
        let oldestCreatedAt = this.byOldestTimestamp$()
        const generator = nostrRelays.getEventsGenerator(filter, relays, { timeout: 20000 })

        for await (const item of generator) {
          if (item.type !== 'event') continue
          const event = item.event
          rawEventCount++
          if (event.created_at < oldestCreatedAt) oldestCreatedAt = event.created_at

          const dTag = getTagValue(event.tags, 'd')?.[0]
          if (!dTag) continue
          const address = `${event.pubkey}:${event.kind}:${dTag}`
          const key = splitMode ? `publisher:${address}` : address
          if (existingKeys.has(key)) continue
          existingKeys.add(key)
          const app = this.createAppFromManifestEvent(event)
          if (app) {
            app.source = 'publisher'
            candidateEntries.push({ app, event })
          }
        }

        this.bySeenKeys$([...existingKeys])
        this.byApps$([...this.byApps$(), ...candidateEntries.map(entry => entry.app)])
        if (rawEventCount > 0) this.byOldestTimestamp$(oldestCreatedAt - 1)
        if (candidateEntries.length) {
          this.fetchMetadataAndProfiles(candidateEntries.map(entry => entry.event))
        }
        if (rawEventCount === 0 ||
          (candidateEntries.length < APPS_PER_PAGE / 2 && rawEventCount < APPS_PER_PAGE)) {
          this.byHasMore$(false)
        }
      } catch (err) {
        console.error('Failed to load recommended apps:', err)
      } finally {
        this.byIsLoading$(false)
      }
    },

    async loadMoreAtApps () {
      const relays = this.atRelays$()
      if (!relays.length || this.atIsLoading$() || !this.atHasMore$()) return
      this.atIsLoading$(true)

      try {
        const filter = {
          kinds: [35128],
          until: this.atOldestTimestamp$(),
          limit: APPS_PER_PAGE
        }
        const existingKeys = new Set(this.atSeenKeys$())
        const candidateEntries = []
        let rawEventCount = 0
        let oldestCreatedAt = this.atOldestTimestamp$()
        const generator = nostrRelays.getEventsGenerator(filter, relays, { timeout: 20000 })

        for await (const item of generator) {
          if (item.type !== 'event') continue
          const event = item.event
          rawEventCount++
          if (event.created_at < oldestCreatedAt) oldestCreatedAt = event.created_at

          const dTag = getTagValue(event.tags, 'd')?.[0]
          if (!dTag) continue
          const key = `${event.pubkey}:${event.kind}:${dTag}`
          if (existingKeys.has(key)) continue
          existingKeys.add(key)
          const app = this.createAppFromManifestEvent(event)
          if (app) candidateEntries.push({ app, event })
        }

        this.atSeenKeys$([...existingKeys])
        this.atApps$([...this.atApps$(), ...candidateEntries.map(entry => entry.app)])
        if (rawEventCount > 0) this.atOldestTimestamp$(oldestCreatedAt - 1)
        if (candidateEntries.length) {
          this.fetchMetadataAndProfiles(candidateEntries.map(entry => entry.event))
        }
        if (rawEventCount === 0 ||
          (candidateEntries.length < APPS_PER_PAGE / 2 && rawEventCount < APPS_PER_PAGE)) {
          this.atHasMore$(false)
        }
      } catch (err) {
        console.error('Failed to load apps from selected relays:', err)
      } finally {
        this.atIsLoading$(false)
      }
    },

    // The lists pill cycles through Starred -> All Lists -> No Lists.
    cycleIs () {
      const is = this.isFilters$()
      const as = this.asFilters$()
      const no = this.noFilters$()
      const state = is.includes('starred')
        ? 'starred'
        : (is.length === 0 && (as.length > 0 || no.includes('is'))
            ? 'none'
            : 'all')
      if (state === 'starred') {
        const publisherOn = as.includes('publisher')
        this.asFilters$([])
        this.isFilters$([])
        this.noFilters$([
          ...(publisherOn ? [] : ['as']),
          ...no.filter(item => item !== 'as' && item !== 'is')
        ])
      } else if (state === 'all') {
        this.asFilters$([])
        this.isFilters$([])
        this.noFilters$([...new Set([...no, 'is'])])
      } else {
        const publisherOn = as.includes('publisher') || !no.includes('as')
        this.asFilters$(publisherOn ? ['publisher'] : [])
        this.isFilters$(['starred'])
        this.noFilters$([])
      }
      this.pushFiltersToUrl()
    },

    toggleAs (value) {
      const is = this.isFilters$()
      const as = this.asFilters$()
      const no = this.noFilters$()
      const isState = is.includes('starred')
        ? 'starred'
        : (is.length === 0 && (as.length > 0 || no.includes('is'))
            ? 'none'
            : 'all')
      const publisherOn = as.includes(value) ||
        (is.length === 0 && !no.includes('as'))
      if (publisherOn) {
        if (isState === 'starred') {
          this.asFilters$(as.filter(item => item !== value))
          this.isFilters$(is)
          this.noFilters$([])
        } else if (isState === 'all') {
          this.asFilters$([])
          this.isFilters$([])
          this.noFilters$([...new Set([...no.filter(item => item !== 'is'), 'as'])])
        } else {
          this.asFilters$(as.filter(item => item !== value))
          this.isFilters$([])
          this.noFilters$([...new Set([...no, 'as', 'is'])])
        }
      } else {
        if (isState === 'starred') {
          this.asFilters$([...as, value])
          this.isFilters$(is)
          this.noFilters$([])
        } else if (isState === 'all') {
          this.asFilters$([])
          this.isFilters$([])
          this.noFilters$(no.filter(item => item !== 'as'))
        } else {
          this.asFilters$([...as, value])
          this.isFilters$([])
          this.noFilters$([])
        }
      }
      this.pushFiltersToUrl()
    },

    async addAuthor (value) {
      const text = value.trim()
      if (!text) return
      if (!decodeUserReference(text)) {
        showToast('Invalid author reference', 'error')
        return
      }
      try {
        const resolved = await resolveUserReference(text)
        if (!resolved) {
          showToast('Could not resolve author', 'error')
          return
        }
        const current = this.byAuthors$()
        if (current.some(author => author.pubkey === resolved.pubkey)) {
          showToast('Author already added', 'info')
          return
        }
        const hadAuthors = current.length > 0
        this.byAuthors$([...current, { pubkey: resolved.pubkey, label: resolved.label }])
        this.loadProfiles([resolved.pubkey])
        if (!hadAuthors) {
          const as = this.asFilters$()
          const no = this.noFilters$()
          const publisherOn = as.includes('publisher') || !no.includes('as')
          this.asFilters$(publisherOn ? ['publisher'] : [])
          this.isFilters$(['starred'])
          this.noFilters$([])
        }
        this.pushFiltersToUrl()
      } catch {
        showToast('Could not resolve author', 'error')
      }
    },

    removeAuthor (pubkey) {
      this.byAuthors$(this.byAuthors$().filter(author => author.pubkey !== pubkey))
      this.resetBySection()
      this.pushFiltersToUrl()
      if (this.byAuthors$().length) this.loadMoreByApps()
    },

    addRelay (value) {
      const relay = normalizeStoreRelay(value)
      if (!relay) {
        showToast('Invalid relay URL', 'error')
        return
      }
      const current = this.atRelays$()
      if (current.includes(relay)) {
        showToast('Relay already added', 'info')
        return
      }
      this.atRelays$([...current, relay])
      this.resetAtSection()
      this.pushFiltersToUrl()
      this.loadMoreAtApps()
    },

    removeRelay (relay) {
      this.atRelays$(this.atRelays$().filter(value => value !== relay))
      this.resetAtSection()
      this.pushFiltersToUrl()
      if (this.atRelays$().length) this.loadMoreAtApps()
    },

    buildQueryUrl ({ by, as, is, no, at }) {
      const params = new URLSearchParams()
      for (const value of by) params.append('by', value)
      for (const value of as) params.append('as', value)
      for (const value of is) params.append('is', value)
      for (const value of no) params.append('no', value)
      for (const value of at) params.append('at', value)
      const query = params.toString()
      return `${loc.route$().url.pathname}${query ? `?${query}` : ''}`
    },

    pushFiltersToUrl () {
      const url = this.buildQueryUrl({
        by: this.byAuthors$().map(author => author.label),
        as: this.asFilters$(),
        is: this.isFilters$(),
        no: this.noFilters$(),
        at: this.atRelays$()
      })
      loc.pushState(null, '', url)
    },

    shareSection (kind) {
      const by = kind === 'by' ? this.byAuthors$().map(author => author.label) : []
      const as = kind === 'by' ? this.asFilters$() : []
      const is = kind === 'by' ? this.isFilters$() : []
      const no = kind === 'by' ? this.noFilters$() : []
      const at = kind === 'at' ? this.atRelays$() : []
      this.shareUrl(getStoreShareUrl({ by, as, is, no, at }))
    },

    openCurationSet (group) {
      if (!group?.dTag || !group.authorPubkey) return
      const naddr = naddrEncode({
        identifier: group.dTag,
        pubkey: group.authorPubkey,
        kind: SITE_CURATION_SET,
        relays: group.authorRelays || []
      })
      loc.pushState(null, '', `/${naddr}`)
    },

    async shareUrl (url) {
      const shareData = { title: '44billion apps', url }
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share(shareData)
          return
        } catch (err) {
          if (err?.name === 'AbortError') return
        }
      }
      try {
        await navigator.clipboard.writeText(url)
        showToast('Link copied to clipboard!', 'success')
      } catch {
        showToast('Could not copy link', 'error')
      }
    }
  }))

  // Intersection observers for infinite scroll on each section.
  const observerTarget$ = useSignal(null)
  const byObserverTarget$ = useSignal(null)
  const atObserverTarget$ = useSignal(null)
  const authorInputRef$ = useSignal(null)
  const relayInputRef$ = useSignal(null)

  const observeTarget = useCallback((target$, loadMore) => {
    useTask(({ track }) => {
      const target = track(target$)
      if (!target) return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) loadMore()
        },
        { threshold: 0.1 }
      )
      observer.observe(target)
      return () => observer.disconnect()
    })
  })
  observeTarget(observerTarget$, () => {
    if (!store.isLoading$() && store.hasMore$()) store.loadMoreApps()
  })
  observeTarget(byObserverTarget$, () => {
    if (!store.byIsLoading$() && store.byHasMore$()) store.loadMoreByApps()
  })
  observeTarget(atObserverTarget$, () => {
    if (!store.atIsLoading$() && store.atHasMore$()) store.loadMoreAtApps()
  })

  // Keep sections in sync with the shareable query string.
  useTask(({ track }) => {
    const route = track(() => loc.route$())
    store.syncFromQuery(new URLSearchParams(route.url.search))
  })

  // Load the current user's starred curation set once.
  useTask(async () => {
    await userCuration.load()
  })

  useTask(() => {
    return () => {
      const timeoutId = store.pendingOpenTimeoutId$()
      if (timeoutId) clearTimeout(timeoutId)
      const profileRetryTimeoutId = store.profileRetryTimeoutId$()
      if (profileRetryTimeoutId) clearTimeout(profileRetryTimeoutId)
    }
  })

  const apps = store.apps$()
  const filterBarOpen = filterBarOpen$()
  const isLoading = store.isLoading$()
  const hasMore = store.hasMore$()
  const profileCache = store.profileCache$()
  const byAuthors = store.byAuthors$()
  const byApps = store.byApps$()
  const byIsLoading = store.byIsLoading$()
  const byHasMore = store.byHasMore$()
  const atRelays = store.atRelays$()
  const atApps = store.atApps$()
  const atIsLoading = store.atIsLoading$()
  const atHasMore = store.atHasMore$()
  const isFilters = store.isFilters$()
  const asFilters = store.asFilters$()
  const noFilters = store.noFilters$()
  const defaultUnion = asFilters.length === 0 && isFilters.length === 0
  const includePublisher = defaultUnion
    ? !noFilters.includes('as')
    : asFilters.includes('publisher')
  const includeStarred = defaultUnion
    ? !noFilters.includes('is')
    : isFilters.length > 0
  const publisherActive = asFilters.includes('publisher') ||
    (defaultUnion && !noFilters.includes('as'))
  const isPillState = isFilters.includes('starred')
    ? 'starred'
    : (isFilters.length === 0 && (asFilters.length > 0 || noFilters.includes('is'))
        ? 'none'
        : 'all')
  const isPillLabel = isPillState === 'starred'
    ? 'Starred'
    : (isPillState === 'all' ? 'All Lists' : 'No Lists')
  const starredActive = isPillState !== 'none'
  const splitMode = includePublisher && includeStarred
  const curationGroups = store.curationGroups$()
  const curatedApps = byApps.filter(app => app.source === 'curated')
  const publisherApps = splitMode
    ? byApps.filter(app => app.source === 'publisher')
    : byApps
  const bySectionReady = store.byResolving$()
    ? false
    : (byAuthors.length > 0 ? !store.byIsLoading$() : true)
  const atSectionReady = atRelays.length > 0 ? !store.atIsLoading$() : true
  const defaultReady = bySectionReady && atSectionReady

  const renderSpinner = useCallback((isFirst) => this.h`
    <div style=${{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      gap: '16px'
    }}>
      <div style=${{
        width: '40px',
        height: '40px',
        border: '3px solid ' + cssVars.colors.bg2,
        borderTop: '3px solid ' + cssVars.colors.bgSelected,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
      <div style=${{ fontSize: '14px', color: cssVars.colors.fg2 }}>
        ${isFirst ? 'Loading apps...' : 'Loading more apps...'}
      </div>
    </div>
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `)

  const renderList = useCallback((listId, listApps, listIsLoading, listHasMore, target$, emptyText) => {
    const currentProfileCache = store.profileCache$()
    const currentStarredAddresses = userCuration.starredAddresses$()
    const currentHasUser = Boolean(userCuration.userPubkey$())
    const currentPendingOpenAppId = store.pendingOpenAppId$()
    return this.h`
      <div class="nappstore-list-anchor" style="display: contents"></div>
      ${
        listApps.length === 0 && !listIsLoading && !listHasMore
          ? [this.h`
              <div style=${{
                display: 'flex',
                justifyContent: 'center',
                padding: '60px 20px',
                color: cssVars.colors.fg2,
                fontSize: '14px'
              }}>
                ${emptyText}
              </div>
            `]
          : listApps.map(app => this.h({ key: `${listId}:${app.id}` })`
              <f-to-signals
                props=${{
                  from: ['app', 'profile', 'isStarred', 'hasUser', 'isPendingOpen'],
                  app,
                  profile: Object.prototype.hasOwnProperty.call(currentProfileCache, app.pubkey)
                    ? currentProfileCache[app.pubkey]
                    : null,
                  isStarred: currentStarredAddresses.includes(appAddress(app)),
                  hasUser: currentHasUser,
                  isPendingOpen: currentPendingOpenAppId === app.id,
                  onOpen: () => store.handleOpenApp(app),
                  onToggleStar: () => store.toggleStar(app),
                  onCopyUrl: () => store.copyAppUrl(app),
                  render: ({ h, props }) => h`
                    <app-list-item
                      props=${{
                        app$: props.app$,
                        profile$: props.profile$,
                        isStarred$: props.isStarred$,
                        hasUser$: props.hasUser$,
                        isPendingOpen$: props.isPendingOpen$,
                        onOpen: props.onOpen,
                        onToggleStar: props.onToggleStar,
                        onCopyUrl: props.onCopyUrl
                      }}
                    />
                  `
                }}
              />
            `)
      }
      ${listIsLoading ? renderSpinner(listApps.length === 0) : ''}
      ${
        listHasMore
          ? [this.h`
              <div
                ref=${target$}
                style=${{ height: '20px', visibility: 'hidden' }}
              />
            `]
          : []
      }
    `
  })

  const shareIcon = useCallback(() => this.h`
    <icon-share props=${{ size: '18px' }} />
  `)

  const sectionHeader = useCallback((title, onShare) => this.h`
    <div style=${{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      paddingBottom: '5px'
    }}>
      <div style=${{
        fontSize: '21px',
        fontWeight: 'bold',
        color: cssVars.colors.fg
      }}>
        ${title}
      </div>
      <button
        title='Share section'
        onclick=${onShare}
        style=${{
          cursor: 'pointer',
          border: '1px solid ' + cssVars.colors.bg2,
          backgroundColor: cssVars.colors.bgSelected2,
          color: cssVars.colors.fg,
          borderRadius: '50%',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        ${shareIcon()}
      </button>
    </div>
  `)

  const byTitle = byAuthors
    .map(author => profileCache[author.pubkey]?.name || shortAccountLabel(author.label))
    .join(', ')
  const bySectionVisible = byAuthors.length > 0 || store.byResolving$()
  const atSectionVisible = atRelays.length > 0

  return this.h`
    <div style=${{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '20px',
      maxWidth: '900px',
      margin: '0 auto'
    }}>
      <style>
        @keyframes feedbackPulse {
          0% { opacity: 0.2; }
          50% { opacity: 0.5; }
          100% { opacity: 0.2; }
        }
        @keyframes metadataTextPulse {
          0% { opacity: 0.35; }
          50% { opacity: 0.7; }
          100% { opacity: 0.35; }
        }
        .nappstore-curation-card {
          flex: 1 1 100%;
        }
        .nappstore-filter-bar {
          display: flex;
        }
        .nappstore-filter-pill {
          max-width: 100%;
        }
        .nappstore-filter-bar-icon {
          flex-shrink: 0;
        }
        .nappstore-filter-input {
          flex: 0 1 180px;
        }
        .nappstore-filter-pill-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 0 1 auto;
        }
        .nappstore-filter-pill-remove {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
        }
        @media (min-width: 719px) {
          .nappstore-curation-card {
            flex: 1 1 calc(50% - 6px);
          }
          .nappstore-filter-pill {
            max-width: 260px;
          }
        }
        @media (max-width: 718px) {
          .nappstore-filter-bar {
            display: none;
          }
          .nappstore-filter-bar.open {
            display: flex;
          }
          .nappstore-filter-bar-icon {
            display: none;
          }
          .nappstore-filter-input {
            flex: 1 1 0;
          }
        }
      </style>

      <!-- Filter bar -->
      <div
        class=${filterBarOpen ? 'nappstore-filter-bar open' : 'nappstore-filter-bar'}
        style=${{
          flexWrap: 'wrap',
          gap: '8px',
          alignItems: 'center',
          padding: '10px 12px',
          backgroundColor: cssVars.colors.bg2,
          borderRadius: '12px'
        }}
      >
        <icon-filter
          props=${{
            class: 'nappstore-filter-bar-icon',
            size: '16px',
            color: cssVars.colors.fg3,
            style: 'svg { flex-shrink: 0; }'
          }}
        />
        ${
          byAuthors.length > 0
            ? this.h`
                <button
                  onclick=${() => store.cycleIs()}
                  style=${{
                    cursor: 'pointer',
                    border: '1px solid ' + cssVars.colors.bg2,
                    borderRadius: '16px',
                    padding: '6px 14px',
                    fontSize: '13px',
                    fontWeight: '600',
                    backgroundColor: starredActive
                      ? cssVars.colors.bgSelected
                      : cssVars.colors.bgSelected2,
                    color: starredActive
                      ? cssVars.colors.fgOnAccent
                      : cssVars.colors.fg
                  }}
                >
                  ${isPillLabel}
                </button>
                <button
                  onclick=${() => store.toggleAs('publisher')}
                  style=${{
                    cursor: 'pointer',
                    border: '1px solid ' + cssVars.colors.bg2,
                    borderRadius: '16px',
                    padding: '6px 14px',
                    fontSize: '13px',
                    fontWeight: '600',
                    backgroundColor: publisherActive
                      ? cssVars.colors.bgSelected
                      : cssVars.colors.bgSelected2,
                    color: publisherActive
                      ? cssVars.colors.fgOnAccent
                      : cssVars.colors.fg
                  }}
                >
                  Publisher
                </button>
              `
            : ''
        }
        ${
          byAuthors.map(author => this.h`
            <button
              class='nappstore-filter-pill'
              onclick=${() => store.removeAuthor(author.pubkey)}
              title='Remove author'
              style=${{
                cursor: 'pointer',
                border: '1px solid ' + cssVars.colors.bg2,
                borderRadius: '16px',
                padding: '6px 10px',
                fontSize: '13px',
                backgroundColor: cssVars.colors.bgSelected2,
                color: cssVars.colors.fg,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span class='nappstore-filter-pill-label'>${formatAccountLabel(author.label)}</span>
              <span class='nappstore-filter-pill-remove'>
                <icon-x props=${{ size: '12px' }} />
              </span>
            </button>
          `)
        }
        ${
          atRelays.map(relay => this.h`
            <button
              class='nappstore-filter-pill'
              onclick=${() => store.removeRelay(relay)}
              title='Remove relay'
              style=${{
                cursor: 'pointer',
                border: '1px solid ' + cssVars.colors.bg2,
                borderRadius: '16px',
                padding: '6px 10px',
                fontSize: '13px',
                backgroundColor: cssVars.colors.bgSelected2,
                color: cssVars.colors.fg,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span class='nappstore-filter-pill-label'>${relay}</span>
              <span class='nappstore-filter-pill-remove'>
                <icon-x props=${{ size: '14px' }} />
              </span>
            </button>
          `)
        }
        <input
          class='nappstore-filter-input'
          ref=${authorInputRef$}
          placeholder='Add Author'
          onkeydown=${(e) => {
            if (e.key === 'Enter') {
              store.addAuthor(e.currentTarget.value)
              e.currentTarget.value = ''
            }
          }}
          onblur=${(e) => {
            if (e.currentTarget.value.trim()) {
              store.addAuthor(e.currentTarget.value)
              e.currentTarget.value = ''
            }
          }}
          style=${{
            border: '1px solid ' + cssVars.colors.bg2,
            borderRadius: '16px',
            padding: '6px 14px',
            fontSize: '13px',
            backgroundColor: cssVars.colors.bg,
            color: cssVars.colors.fg,
            minWidth: '120px'
          }}
        />
        <input
          class='nappstore-filter-input'
          ref=${relayInputRef$}
          placeholder='Add Relay'
          onkeydown=${(e) => {
            if (e.key === 'Enter') {
              store.addRelay(e.currentTarget.value)
              e.currentTarget.value = ''
            }
          }}
          onblur=${(e) => {
            if (e.currentTarget.value.trim()) {
              store.addRelay(e.currentTarget.value)
              e.currentTarget.value = ''
            }
          }}
          style=${{
            border: '1px solid ' + cssVars.colors.bg2,
            borderRadius: '16px',
            padding: '6px 14px',
            fontSize: '13px',
            backgroundColor: cssVars.colors.bg,
            color: cssVars.colors.fg,
            minWidth: '120px'
          }}
        />
      </div>

      <!-- Recommended by -->
      ${
        bySectionVisible
          ? this.h`
              ${sectionHeader(`Apps recommended by ${byTitle || '…'}`, () => store.shareSection('by'))}
              ${
                splitMode
                  ? this.h`
                      ${
                        curationGroups.length
                          ? this.h`
                              <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                                ${
                                  curationGroups.map(group => {
                                    const authorProfile = group.authorPubkey
                                      ? profileCache[group.authorPubkey] || null
                                      : null
                                    const authorPending = Boolean(group.authorPubkey) && !authorProfile
                                    const publishedAuthorName = authorProfile?.meta?.generatedName
                                      ? ''
                                      : [authorProfile?.name, authorProfile?.display_name]
                                          .find(name => typeof name === 'string' && name.trim())
                                          ?.trim() || ''
                                    return this.h({ key: group.dTag })`
                                      <f-to-signals
                                        props=${{
                                          from: ['group', 'apps', 'author'],
                                          group,
                                          apps: curatedApps,
                                          author: {
                                            pubkey: group.authorPubkey,
                                            name: publishedAuthorName,
                                            pending: authorPending
                                          },
                                          onOpenApp: (app) => store.handleOpenApp(app),
                                          onOpenCard: (g) => store.openCurationSet(g),
                                          render: ({ h, props }) => h`
                                            <curation-set-card
                                              props=${{
                                                group$: props.group$,
                                                apps$: props.apps$,
                                                author$: props.author$,
                                                onOpenApp: props.onOpenApp,
                                                onOpenCard: props.onOpenCard
                                              }}
                                            />
                                          `
                                        }}
                                      />
                                    `
                                  })
                                }
                              </div>
                            `
                          : (byIsLoading || store.byResolving$() ? renderSpinner(true) : '')
                      }
                      <div style=${{
                        fontSize: '17px',
                        fontWeight: 'bold',
                        color: cssVars.colors.fg2,
                        paddingTop: '8px'
                      }}>
                        Published by ${byTitle}
                      </div>
                      ${renderList(
                        'by-publisher',
                        publisherApps,
                        byIsLoading || store.byResolving$(),
                        byHasMore,
                        byObserverTarget$,
                        'No apps found'
                      )}
                    `
                  : renderList(
                      'by',
                      byApps,
                      byIsLoading || store.byResolving$(),
                      byHasMore,
                      byObserverTarget$,
                      'No recommended apps found'
                    )
              }
            `
          : ''
      }

      <!-- Selected relays -->
      ${
        atSectionVisible
          ? this.h`
              ${sectionHeader('Apps from selected relays', () => store.shareSection('at'))}
              ${renderList('at', atApps, atIsLoading, atHasMore, atObserverTarget$, 'No apps found on these relays')}
            `
          : ''
      }

      <!-- Default Discover -->
      <div style=${{ fontSize: '21px', fontWeight: 'bold', color: cssVars.colors.fg, paddingBottom: '5px' }}>
        Discover Apps
      </div>
      ${
        defaultReady
          ? renderList('discover', apps, isLoading, hasMore, observerTarget$, 'No apps found')
          : ''
      }
    </div>
  `
})
