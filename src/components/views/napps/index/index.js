import { f, useStore, useTask, useSignal } from '#f'
import '#f/components/f-to-signals.js'
import { appEncode } from '#helpers/nostr/nip19.js'
import { getRelaysByPubkey, getProfiles } from '#helpers/nostr/queries.js'
import nostrRelays from '#services/nostr-relays.js'
import { fetchFileDataUrl } from '#services/app-metadata-fetcher.js'
import { cssVars } from '#assets/styles/theme.js'
import lru from '#services/lru.js'
import '#shared/app-icon.js'
import '#shared/avatar.js'

const B_RELAY = 'wss://relay.44billion.net'
const APPS_PER_PAGE = 20
const DEFAULT_BUNDLE_KIND = 37448
const MAX_ICON_SIZE_BYTES = 5.5 * 1024 * 1024

function getTagValue (tags, key) {
  if (!Array.isArray(tags)) return null
  const tag = tags.find(entry => Array.isArray(entry) && entry[0] === key)
  return tag ? tag.slice(1) : null
}

function trimOrEmpty (value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Lazy lists all apps
f('nappsIndex', function () {
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

    // Streams stall events from the relay and updates the UI as each arrives
    async loadMoreApps () {
      if (this.isLoading$() || !this.hasMore$()) return

      this.isLoading$(true)

      try {
        let retryWithSpam = true

        while (retryWithSpam) {
          retryWithSpam = false

          const filter = {
            kinds: [37348],
            until: this.oldestTimestamp$(),
            limit: APPS_PER_PAGE
          }

          if (this.includingSpam$()) {
            filter.search = 'is:spam'
          }

          const existingKeys = new Set(
            this.apps$().map(app => `${app.pubkey}:${app.dTag}`)
          )
          const pendingStallEvents = []
          let rawEventCount = 0
          let newAppCount = 0
          let oldestCreatedAt = this.oldestTimestamp$()

          // Stream events from the relay, adding apps to the UI as they arrive
          const generator = nostrRelays.getEventsGenerator(
            filter,
            [B_RELAY],
            { timeout: 20000 }
          )

          for await (const item of generator) {
            if (item.type !== 'event') continue
            const event = item.event
            rawEventCount++

            if (event.created_at < oldestCreatedAt) {
              oldestCreatedAt = event.created_at
            }

            const dTagValue = getTagValue(event.tags, 'd')?.[0]
            if (!dTagValue) continue

            const key = `${event.pubkey}:${dTagValue}`
            if (existingKeys.has(key)) continue
            existingKeys.add(key)

            const app = this.createAppFromStallEvent(event)
            if (!app) continue
            newAppCount++
            pendingStallEvents.push(event)

            // Append to store immediately so the UI refreshes per event
            this.apps$([...this.apps$(), app])
          }

          // Update pagination cursor
          if (rawEventCount > 0) {
            this.oldestTimestamp$(oldestCreatedAt - 1)
          }

          const seemsExhausted = rawEventCount === 0 ||
            (newAppCount < APPS_PER_PAGE / 2 && rawEventCount < APPS_PER_PAGE)

          if (seemsExhausted && !this.includingSpam$()) {
            // Non-spam appears exhausted, retry including spam-flagged events
            this.includingSpam$(true)
            this.oldestTimestamp$(Math.floor(Date.now() / 1000))
            retryWithSpam = true
            continue
          }

          if (seemsExhausted) {
            this.hasMore$(false)
          }

          // Fetch icons and profiles in the background (fire-and-forget)
          if (pendingStallEvents.length > 0) {
            this.fetchIconsAndProfiles(pendingStallEvents)
          }
        }

        this.isFirstLoad$(false)
      } catch (err) {
        console.error('Failed to load apps:', err)
      } finally {
        this.isLoading$(false)
      }
    },

    // Builds a lightweight app object from a stall event (no icon yet)
    createAppFromStallEvent (stallEvent) {
      const dTagArray = getTagValue(stallEvent.tags, 'd')
      if (!dTagArray?.[0]) return null
      const dTag = dTagArray[0]

      const channelTag = getTagValue(stallEvent.tags, 'c')
      const channelValue = trimOrEmpty(channelTag?.[0]).toLowerCase()

      let bundleKind = DEFAULT_BUNDLE_KIND
      if (channelValue === 'next') bundleKind = 37449
      if (channelValue === 'draft') bundleKind = 37450

      const encodedApp = appEncode({
        dTag,
        pubkey: stallEvent.pubkey,
        kind: bundleKind
      })

      const nameTag = getTagValue(stallEvent.tags, 'name')
      const summaryTag = getTagValue(stallEvent.tags, 'summary')
      const iconTag = getTagValue(stallEvent.tags, 'icon')

      return {
        id: encodedApp,
        dTag,
        pubkey: stallEvent.pubkey,
        kind: bundleKind,
        name: trimOrEmpty(nameTag?.[0]) || dTag,
        description: trimOrEmpty(summaryTag?.[0]) || 'No description',
        iconFx: iconTag?.[0] || null,
        uploadedAt: stallEvent.created_at * 1000
      }
    },

    // Background task: fetches relay metadata, profiles, and icons for a batch of stall events
    async fetchIconsAndProfiles (stallEvents) {
      try {
        const authorPubkeys = [...new Set(stallEvents.map(e => e.pubkey))]

        const [relaysByAuthor] = await Promise.all([
          getRelaysByPubkey(authorPubkeys),
          this.loadProfiles(authorPubkeys)
        ])

        const iconCache = lru.ns('apps')

        await Promise.all(
          stallEvents.map(async (stallEvent) => {
            try {
              const iconTag = getTagValue(stallEvent.tags, 'icon')
              if (!iconTag?.[0]) return

              const [iconRootHash, iconMimeType] = iconTag
              const app = this.createAppFromStallEvent(stallEvent)
              if (!app) return

              const cacheKey = `appById_${app.id}_icon`
              const cachedIcon = iconCache.getItem(cacheKey)

              if (cachedIcon?.fx === iconRootHash && cachedIcon?.url) return

              const iconUrl = await fetchFileDataUrl({
                pubkey: stallEvent.pubkey,
                rootHash: iconRootHash,
                mimeType: iconMimeType,
                relays: [...new Set([...relaysByAuthor[stallEvent.pubkey].write, B_RELAY])],
                maxSizeBytes: MAX_ICON_SIZE_BYTES
              })

              if (iconUrl) {
                try {
                  iconCache.setItem(cacheKey, { fx: iconRootHash, url: iconUrl })
                } catch (err) {
                  console.error('Failed to cache icon:', err)
                }
              }
            } catch (err) {
              console.error('Failed to fetch icon:', err)
            }
          })
        )
      } catch (err) {
        console.error('Failed to fetch icons and profiles:', err)
      }
    },

    async loadProfiles (pubkeys) {
      const profileCache = this.profileCache$()
      const uniquePubkeys = [...new Set(pubkeys)].filter(pk => !profileCache[pk])

      if (uniquePubkeys.length === 0) return

      try {
        const results = await getProfiles(uniquePubkeys)
        this.profileCache$({ ...profileCache, ...results })
      } catch (err) {
        console.error('Failed to load profiles:', err)
      }
    },

    handleOpenApp (app) {
      this.showOpenFeedback(app.id)
      const encodedApp = appEncode({
        dTag: app.dTag,
        pubkey: app.pubkey,
        kind: app.kind
      })
      const url = `${IS_PRODUCTION ? 'https://44billion.net' : 'http://localhost:10000'}/${encodedApp}`
      window.open(url, '_blank')
    }
  }))

  // Intersection observer for infinite scroll
  const observerTarget$ = useSignal(null)

  useTask(({ track }) => {
    const target = track(observerTarget$)
    if (!target) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !store.isLoading$() && store.hasMore$()) {
          store.loadMoreApps()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(target)

    return () => observer.disconnect()
  })

  // Load initial apps
  useTask(async () => {
    await store.loadMoreApps()
  })

  useTask(() => {
    return () => {
      const timeoutId = store.pendingOpenTimeoutId$()
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  })

  const apps = store.apps$()
  const isLoading = store.isLoading$()
  const hasMore = store.hasMore$()
  const profileCache = store.profileCache$()
  const isFirstLoad = store.isFirstLoad$()
  const pendingOpenAppId = store.pendingOpenAppId$()

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
      </style>
      <!-- Header -->
      <div style=${{
        fontSize: '21px',
        fontWeight: 'bold',
        color: cssVars.colors.fg,
        paddingBottom: '5px'
      }}>
        Discover Apps
      </div>

      <!-- Apps Grid -->
      ${
  apps.length === 0 && !isLoading
    ? this.h`
        <div style=${{
          display: 'flex',
          justifyContent: 'center',
          padding: '60px 20px',
          color: cssVars.colors.fg2,
          fontSize: '14px'
        }}>
          No apps found
        </div>
      `
    : apps.map((app, index) => {
      const profile = profileCache[app.pubkey] || {}
      const authorName = profile.name || profile.display_name || 'Anonymous'
      const key = app.id
      const isPendingOpen = pendingOpenAppId === app.id

      return this.h({ key })`
          <f-to-signals
            key=${key}
            props=${{
              from: ['app'],
              app: { id: app.id, index: index + 1, fx: app.iconFx },
              render: props => this.h`
                <div
                  onclick=${() => store.handleOpenApp(app)}
                  style=${{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '12px',
                    backgroundColor: cssVars.colors.bg2,
                    borderRadius: '12px',
                    border: '2px solid ' + cssVars.colors.bg2,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                  onmouseenter=${(e) => {
                    e.currentTarget.style.borderColor = cssVars.colors.bgSelected
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }}
                  onmouseleave=${(e) => {
                    e.currentTarget.style.borderColor = cssVars.colors.bg2
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}
                >
                  ${
                    isPendingOpen
                      ? this.h`
                        <div style=${{
                          position: 'absolute',
                          inset: '0',
                          borderRadius: '12px',
                          backgroundColor: cssVars.colors.bgSelected,
                          pointerEvents: 'none',
                          animation: 'feedbackPulse 1.2s ease-in-out infinite',
                          opacity: 0.2,
                          zIndex: 1
                        }} />
                      `
                      : ''
                  }
                  <!-- App Icon -->
                  <div style=${{
                    width: '56px',
                    height: '56px',
                    flexShrink: 0,
                    backgroundColor: cssVars.colors.bgAvatar,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    color: cssVars.colors.fg2
                  }}>
                    <app-icon props=${props} />
                  </div>

                  <!-- App Info -->
                  <div style=${{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    minWidth: 0
                  }}>
                    <!-- App Name -->
                    <div style=${{
                      fontSize: '16px',
                      fontWeight: 'bold',
                      color: cssVars.colors.fg2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      ${app.name}
                    </div>

                    <!-- App Description -->
                    <div style=${{
                      fontSize: '13px',
                      color: cssVars.colors.fg2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      ${app.description}
                    </div>

                    <!-- Author Info -->
                    <div style=${{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: 'auto',
                      position: 'relative',
                      bottom: '5px'
                    }}>
                      <div style=${{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        overflow: 'hidden',
                        backgroundColor: cssVars.colors.bgAvatar,
                        flexShrink: 0
                      }}>
                        <a-avatar
                          props=${{
                            pk: app.pubkey,
                            style: `svg {
                              width: 100%;
                              height: 100%;
                              border-radius: 50%;
                            }`
                          }}
                        />
                      </div>
                      <div style=${{
                        fontSize: '12px',
                        color: cssVars.colors.fg2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        by ${authorName}
                      </div>
                    </div>
                  </div>
                </div>
              `
            }}
          />
        `
    })
}

      <!-- Loading Indicator -->
      ${
  isLoading
    ? this.h`
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
          <div style=${{
            fontSize: '14px',
            color: cssVars.colors.fg2
          }}>
            ${isFirstLoad ? 'Loading apps...' : 'Loading more apps...'}
          </div>
        </div>
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      `
    : ''
}

      <!-- Intersection Observer Target -->
      ${
  hasMore
    ? this.h`
        <div
          ref=${observerTarget$}
          style=${{
            height: '20px',
            visibility: 'hidden'
          }}
        />
      `
    : this.h`
        <div style=${{
          display: 'flex',
          justifyContent: 'center',
          padding: '20px',
          color: cssVars.colors.fg2,
          fontSize: '12px'
        }}>
          No more apps to load
        </div>
      `
}
    </div>
  `
})
