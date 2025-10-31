import { f, useStore, useTask, useSignal } from '#f'
import '#f/components/f-to-signals.js'
import { appEncode } from '#helpers/nostr/nip19.js'
import nostrRelays from '#services/nostr-relays.js'
import { fetchAppMetadata } from '#services/app-metadata-fetcher.js'
import { cssVars } from '#assets/styles/theme.js'
import lru from '#services/lru.js'
import '#shared/app-icon.js'
import '#shared/avatar.js'

const PRIMAL_RELAY = 'wss://relay.primal.net'
const APPS_PER_PAGE = 20

// Lazy lists all apps
f('nappsIndex', function () {
  const store = useStore(() => ({
    apps$: [],
    isLoading$: false,
    hasMore$: true,
    oldestTimestamp$: Math.floor(Date.now() / 1000),
    profileCache$: {},
    isFirstLoad$: true,

    async loadMoreApps () {
      if (this.isLoading$() || !this.hasMore$()) return

      this.isLoading$(true)

      try {
        // Fetch app bundle events (kind 37448) from Primal relay
        const { result: events } = await nostrRelays.getEvents(
          {
            kinds: [37448],
            until: this.oldestTimestamp$(),
            limit: APPS_PER_PAGE
          },
          [PRIMAL_RELAY],
          10000
        )

        if (events.length === 0) {
          this.hasMore$(false)
          this.isLoading$(false)
          return
        }

        // Update oldest timestamp for pagination
        const oldestEvent = events[events.length - 1]
        this.oldestTimestamp$(oldestEvent.created_at - 1)

        // Group by author + d tag to avoid duplicates
        const uniqueApps = new Map()
        const existingApps = this.apps$()

        for (const event of events) {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1]
          if (!dTag) continue

          const key = `${event.pubkey}:${dTag}`

          // Skip if already in our list
          if (existingApps.some(a => `${a.pubkey}:${a.dTag}` === key)) continue

          // Keep only the newest version per author+dTag
          if (!uniqueApps.has(key) || event.created_at > uniqueApps.get(key).created_at) {
            uniqueApps.set(key, event)
          }
        }

        // Fetch metadata for each unique app
        const newApps = await Promise.all(
          Array.from(uniqueApps.values()).map(async (bundleEvent) => {
            try {
              const dTag = bundleEvent.tags.find(t => t[0] === 'd')[1]
              const encodedApp = appEncode({
                dTag,
                pubkey: bundleEvent.pubkey,
                kind: bundleEvent.kind
              })

              const metadata = await fetchAppMetadata(bundleEvent, [PRIMAL_RELAY])

              // Store icon in localStorage for app-icon component
              if (metadata.icon?.url) {
                try {
                  lru.ns('apps').setItem(
                    `appById_${encodedApp}_icon`,
                    { fx: metadata.icon.fx, url: metadata.icon.url }
                  )
                } catch (err) {
                  console.error('Failed to cache icon:', err)
                }
              }

              return {
                id: encodedApp,
                dTag,
                pubkey: bundleEvent.pubkey,
                kind: bundleEvent.kind,
                name: metadata.name || dTag,
                description: metadata.description || 'No description',
                icon: metadata.icon,
                uploadedAt: bundleEvent.created_at * 1000
              }
            } catch (err) {
              console.error('Failed to fetch app metadata:', err)
              return null
            }
          }).filter(Boolean)
        )

        // Filter out failed metadata fetches
        const validApps = newApps.filter(app => app !== null)

        // Fetch profiles for authors
        await this.loadProfiles(validApps.map(app => app.pubkey))

        // Append to existing apps
        this.apps$([...existingApps, ...validApps])

        // If we got fewer apps than requested, we've reached the end
        if (validApps.length < APPS_PER_PAGE / 2) {
          this.hasMore$(false)
        }

        // After first load, set isFirstLoad to false
        this.isFirstLoad$(false)
      } catch (err) {
        console.error('Failed to load apps:', err)
      } finally {
        this.isLoading$(false)
      }
    },

    async loadProfiles (pubkeys) {
      const profileCache = this.profileCache$()
      const uniquePubkeys = [...new Set(pubkeys)].filter(pk => !profileCache[pk])

      if (uniquePubkeys.length === 0) return

      try {
        const { result: events } = await nostrRelays.getEvents(
          {
            kinds: [0],
            authors: uniquePubkeys
          },
          [PRIMAL_RELAY],
          5000
        )

        // Group by author and keep newest
        const profilesByAuthor = events.reduce((acc, event) => {
          if (!acc[event.pubkey] || event.created_at > acc[event.pubkey].created_at) {
            acc[event.pubkey] = event
          }
          return acc
        }, {})

        // Parse and cache profiles
        const newCache = { ...profileCache }
        for (const [pubkey, event] of Object.entries(profilesByAuthor)) {
          try {
            newCache[pubkey] = JSON.parse(event.content)
          } catch (err) {
            console.error('Failed to parse profile:', err)
            newCache[pubkey] = {}
          }
        }

        // Add empty profiles for authors we couldn't find
        for (const pubkey of uniquePubkeys) {
          if (!newCache[pubkey]) {
            newCache[pubkey] = {}
          }
        }

        this.profileCache$(newCache)
      } catch (err) {
        console.error('Failed to load profiles:', err)
      }
    },

    handleOpenApp (app) {
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

  const apps = store.apps$()
  const isLoading = store.isLoading$()
  const hasMore = store.hasMore$()
  const profileCache = store.profileCache$()
  const isFirstLoad = store.isFirstLoad$()

  return this.h`
    <div style=${{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '20px',
      maxWidth: '900px',
      margin: '0 auto'
    }}>
      <!-- Header -->
      <div style=${{
        fontSize: '21px',
        fontWeight: 'bold',
        color: cssVars.colors.fg,
        paddingBottom: '5px'
      }}>
        Discover Napps
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

      return this.h({ key })`
          <f-to-signals
            key=${key}
            props=${{
              from: ['app'],
              app: { id: app.id, index: index + 1 },
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
                    transition: 'all 0.2s'
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
            ${isFirstLoad ? 'Loading napps...' : 'Loading more napps...'}
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
