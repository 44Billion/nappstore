import { f, useStore, useTask, useSignal } from '#f'
import '#f/components/f-to-signals.js'
import { appEncode } from 'libp2r2p/nip19'
import { getRelaysByPubkey, getBlossomServersByPubkey, getProfiles } from '#helpers/nostr/queries.js'
import nostrRelays, { nappRelays } from '#services/nostr-relays.js'
import { fetchAppMetadata, needsHtmlMetadataFallback } from '#services/app-metadata-fetcher.js'
import { findMarkedManifestAsset, getManifestMetadata } from '#helpers/manifest.js'
import { getAppIconLogPrefix } from '#helpers/app.js'
import { cssVars } from '#assets/styles/theme.js'
import { getAppLauncherUrl } from '#helpers/launcher-url.js'
import lru from '#services/lru.js'
import '#shared/app-icon.js'
import '#shared/avatar.js'

const APPS_PER_PAGE = 20
const DEFAULT_MANIFEST_KIND = 35128

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

          if (this.includingSpam$()) {
            filter.search = 'is:spam'
          }

          const existingKeys = new Set(
            this.apps$().map(app => `${app.pubkey}:${app.kind}:${app.dTag}`)
          )
          const candidateEntries = []
          let rawEventCount = 0
          let oldestCreatedAt = this.oldestTimestamp$()

          // A manifest already carries files, media, and listing metadata.
          const generator = nostrRelays.getEventsGenerator(
            filter,
            nappRelays,
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

          // Update pagination cursor
          if (rawEventCount > 0) {
            this.oldestTimestamp$(oldestCreatedAt - 1)
          }

          // Start work for this batch before pagination potentially continues.
          if (pendingManifestEvents.length > 0) {
            this.fetchMetadataAndProfiles(pendingManifestEvents)
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
      const bundleKind = [35128, 35129, 35130].includes(manifestEvent.kind)
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

              this.apps$(apps => apps.map(current => {
                if (current.id !== app.id) return current
                const description = getAppDescription(metadata.description, current.description)
                return {
                  ...current,
                  name: metadata.name || current.name,
                  description,
                  descriptionResolutionPending: !description && needsHtml,
                  iconFx: metadata.icon?.fx || current.iconFx,
                  // HTML and Web App Manifest discovery may still add icon candidates.
                  iconResolutionPending: needsHtml
                }
              }))

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
              this.apps$(apps => apps.map(current => {
                if (current.id !== app.id) return current
                const description = getAppDescription(metadata?.description, current.description)
                return {
                  ...current,
                  name: metadata?.name || current.name,
                  description,
                  descriptionResolutionPending: false,
                  iconFx: metadata?.icon?.fx || current.iconFx,
                  iconResolutionPending: false
                }
              }))
            }
          }))
        }))
        await profilesPromise
      } catch (err) {
        console.error('Failed to fetch app metadata and profiles:', err)
      } finally {
        this.apps$(apps => apps.map(app => {
          if (!pendingAppIds.has(app.id)) return app
          if (!app.iconResolutionPending && !app.descriptionResolutionPending) return app
          return {
            ...app,
            descriptionResolutionPending: false,
            iconResolutionPending: false
          }
        }))
      }
    },

    async loadProfiles (pubkeys) {
      const profileCache = this.profileCache$()
      const uniquePubkeys = [...new Set(pubkeys)].filter(
        pk => !Object.prototype.hasOwnProperty.call(profileCache, pk)
      )

      if (uniquePubkeys.length === 0) return

      try {
        const results = await getProfiles(uniquePubkeys)
        this.profileCache$(current => ({ ...current, ...results }))
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
        @keyframes metadataTextPulse {
          0% { opacity: 0.35; }
          50% { opacity: 0.7; }
          100% { opacity: 0.35; }
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
    ? [this.h`
        <div style=${{
          display: 'flex',
          justifyContent: 'center',
          padding: '60px 20px',
          color: cssVars.colors.fg2,
          fontSize: '14px'
        }}>
          No apps found
        </div>
      `]
    : apps.map((app, index) => {
      const isAuthorPending = !Object.prototype.hasOwnProperty.call(profileCache, app.pubkey)
      const profile = isAuthorPending ? null : profileCache[app.pubkey] || null
      const publishedAuthorName = profile?.meta?.generatedName
        ? ''
        : [profile?.name, profile?.display_name]
            .find(name => typeof name === 'string' && name.trim())
            ?.trim() || ''
      const isAnonymous = !isAuthorPending && !publishedAuthorName
      const authorName = publishedAuthorName || 'Anonymous'
      const description = getAppDescription(app.description)
      const isDescriptionPending = app.descriptionResolutionPending && !description
      const isDescriptionFallback = !isDescriptionPending && !description
      const key = app.id
      const isPendingOpen = pendingOpenAppId === app.id

      return this.h({ key })`
          <f-to-signals
            props=${{
              from: ['app', 'profile'],
              app: {
                id: app.id,
                index: index + 1,
                name: app.name,
                fx: app.iconFx,
                iconResolutionPending: app.iconResolutionPending
              },
              profile,
              render: ({ h, props }) => h`
                <div
                  data-app-id=${app.id}
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
                      ? h`
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
                      color: isDescriptionPending ? 'transparent' : cssVars.colors.fg2,
                      opacity: isDescriptionFallback ? 0.6 : 1,
                      fontStyle: isDescriptionFallback ? 'italic' : 'normal',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      width: isDescriptionPending ? '65%' : 'auto',
                      maxWidth: '100%',
                      minHeight: '15px',
                      borderRadius: isDescriptionPending ? '7px' : '0',
                      backgroundColor: isDescriptionPending
                        ? cssVars.colors.bgAvatarLoading
                        : 'transparent',
                      animation: isDescriptionPending
                        ? 'metadataTextPulse 1.4s ease-in-out infinite'
                        : 'none'
                    }}>
                      ${isDescriptionPending ? '' : description || 'No description'}
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
                            profile$: props.profile$,
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
                        color: isAuthorPending ? 'transparent' : cssVars.colors.fg2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: isAuthorPending ? '84px' : 'auto',
                        minHeight: '14px',
                        borderRadius: isAuthorPending ? '7px' : '0',
                        backgroundColor: isAuthorPending
                          ? cssVars.colors.bgAvatarLoading
                          : 'transparent',
                        animation: isAuthorPending
                          ? 'metadataTextPulse 1.4s ease-in-out infinite'
                          : 'none'
                      }}>
                        ${isAuthorPending ? '' : 'by '}
                        <span style=${{ fontStyle: isAnonymous ? 'italic' : 'normal' }}>
                          ${isAuthorPending ? '' : authorName}
                        </span>
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
