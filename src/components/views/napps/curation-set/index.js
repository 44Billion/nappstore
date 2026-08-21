import { f, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { appEncode, naddrDecode } from 'libp2r2p/nip19'
import { SITE_CURATION_SET } from 'libp2r2p/kind'
import {
  getProfiles,
  getRelaysByPubkey,
  pickRelaysForPubkeys
} from '#helpers/nostr/queries.js'
import nostrRelays, { nappRelays } from '#services/nostr-relays.js'
import { findMarkedManifestAsset, getManifestMetadata } from '#helpers/manifest.js'
import { getAppLauncherUrl, getAppLauncherUrlForApp } from '#helpers/launcher-url.js'
import { useToast } from '#shared/toast.js'
import { useUserCuration } from '#helpers/use-user-curation.js'
import { useLocation } from '#f'
import '#shared/avatar.js'
import '#shared/icons/icon-share.js'
import '#views/napps/index/app-list-item.js'
import { cssVars } from '#assets/styles/theme.js'

const MANIFEST_KINDS = [35128, 35129, 35130]

function getTagValue (tags, key) {
  if (!Array.isArray(tags)) return null
  const tag = tags.find(entry => Array.isArray(entry) && entry[0] === key)
  return tag ? tag.slice(1) : null
}

function appAddress (app) {
  return `${app.kind}:${app.pubkey}:${app.dTag}`
}

function createAppFromManifestEvent (manifestEvent) {
  const dTagArray = getTagValue(manifestEvent.tags, 'd')
  if (!dTagArray?.[0]) return null
  const dTag = dTagArray[0]
  const bundleKind = MANIFEST_KINDS.includes(manifestEvent.kind)
    ? manifestEvent.kind
    : 35128
  const encodedApp = appEncode({
    dTag,
    pubkey: manifestEvent.pubkey,
    kind: bundleKind
  })
  const metadata = getManifestMetadata(manifestEvent)
  const icon = findMarkedManifestAsset(manifestEvent, 'icon')
  return {
    id: encodedApp,
    dTag,
    pubkey: manifestEvent.pubkey,
    kind: bundleKind,
    name: metadata.name || dTag,
    description: metadata.description || '',
    descriptionResolutionPending: false,
    iconFx: icon?.root || null,
    iconResolutionPending: true,
    uploadedAt: manifestEvent.created_at * 1000
  }
}

// Internal page for a NIP-19 naddr pointing to a 30499 curation set.
f('nappsCurationSet', ({ h }) => {
  const loc = useLocation()
  const { showToast } = useToast()
  const userCuration = useUserCuration()

  const store = useStore(() => ({
    naddr$: null,
    authorPubkey$: null,
    title$: '',
    description$: '',
    apps$: [],
    profileCache$: {},
    isLoading$: false,
    error$: null,
    pendingOpenAppId$: null,
    pendingOpenTimeoutId$: null,

    async load () {
      const naddr = loc.route$().url.pathname.replace(/^\/|\/$/g, '')
      let decoded
      try {
        decoded = naddrDecode(naddr)
      } catch {
        this.error$('Invalid curation set link')
        this.isLoading$(false)
        return
      }
      if (decoded.kind !== SITE_CURATION_SET) {
        this.error$('This link is not a curation set')
        this.isLoading$(false)
        return
      }

      this.naddr$(naddr)
      this.error$(null)
      this.apps$([])
      this.title$('')
      this.description$('')
      this.isLoading$(true)

      try {
        const relaysByAuthor = (await getRelaysByPubkey([decoded.pubkey]))[decoded.pubkey] || { write: [] }
        const relays = [...new Set([
          ...(decoded.relays || []),
          ...(relaysByAuthor.write || []),
          ...nappRelays
        ])]
        const { result: events } = await nostrRelays.getEvents(
          {
            kinds: [decoded.kind],
            authors: [decoded.pubkey],
            '#d': [decoded.identifier],
            limit: 10
          },
          relays
        )
        const event = (events || [])
          .sort((a, b) => b.created_at - a.created_at ||
            String(a.id).localeCompare(String(b.id)))[0]
        if (!event) {
          this.error$('Curation set not found')
          return
        }

        this.authorPubkey$(decoded.pubkey)
        this.title$(
          getTagValue(event.tags, 'title')?.[0] ||
          decoded.identifier.toUpperCase()
        )
        this.description$(
          getTagValue(event.tags, 'description')?.[0] ||
          (decoded.identifier === 'starred' ? 'Apps starred by this author.' : '')
        )

        const addresses = []
        for (const tag of event.tags || []) {
          if (tag?.[0] !== 'a' || typeof tag[1] !== 'string') continue
          const match = tag[1].match(/^(\d+):([0-9a-f]{64}):(.+)$/)
          if (!match || !MANIFEST_KINDS.includes(Number(match[1]))) continue
          addresses.push({
            kind: Number(match[1]),
            pubkey: match[2],
            dTag: match[3]
          })
        }

        if (addresses.length) {
          const appAuthors = [...new Set(addresses.map(address => address.pubkey))]
          const appRelaysByAuthor = await getRelaysByPubkey(appAuthors)
          const appRelayToAuthors = pickRelaysForPubkeys(appAuthors, appRelaysByAuthor)
          const appRelays = [...new Set([...appRelayToAuthors.keys(), ...nappRelays])]
          const { result: manifests } = await nostrRelays.getEvents(
            {
              kinds: [...new Set(addresses.map(address => address.kind))],
              authors: appAuthors,
              '#d': [...new Set(addresses.map(address => address.dTag))],
              limit: addresses.length * 2
            },
            appRelays
          )

          const wanted = new Set(addresses.map(address =>
            `${address.kind}:${address.pubkey}:${address.dTag}`
          ))
          const apps = []
          const seen = new Set()
          for (const manifestEvent of manifests || []) {
            const dTag = getTagValue(manifestEvent.tags, 'd')?.[0]
            if (!dTag) continue
            const address = `${manifestEvent.kind}:${manifestEvent.pubkey}:${dTag}`
            if (!wanted.has(address) || seen.has(address)) continue
            seen.add(address)
            const app = createAppFromManifestEvent(manifestEvent)
            if (app) apps.push(app)
          }
          this.apps$(apps)
          this.loadProfiles([...new Set(apps.map(app => app.pubkey))])
        }
        this.loadProfiles([decoded.pubkey])
      } catch (err) {
        console.error('Failed to load curation set:', err)
        this.error$('Failed to load curation set')
      } finally {
        this.isLoading$(false)
      }
    },

    async loadProfiles (pubkeys) {
      try {
        const results = await getProfiles([...new Set(pubkeys)])
        this.profileCache$(current => ({ ...current, ...results }))
      } catch {
        // Profile metadata is best-effort.
      }
    },

    showOpenFeedback (appId) {
      const existingTimeout = this.pendingOpenTimeoutId$()
      if (existingTimeout) clearTimeout(existingTimeout)
      this.pendingOpenAppId$(appId)
      const timeoutId = setTimeout(() => {
        this.pendingOpenAppId$(null)
        this.pendingOpenTimeoutId$(null)
      }, 3000)
      this.pendingOpenTimeoutId$(timeoutId)
    },

    handleOpenApp (app) {
      this.showOpenFeedback(app.id)
      window.open(getAppLauncherUrl(appEncode({
        dTag: app.dTag,
        pubkey: app.pubkey,
        kind: app.kind
      })), '_blank')
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

    async sharePage () {
      const url = getAppLauncherUrl(`+apps/${this.naddr$()}`)
      const shareData = { title: this.title$() || 'Curation set', url }
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

  useTask(({ track }) => {
    track(() => loc.route$())
    store.load()
  })

  useTask(async () => {
    await userCuration.load()
  })

  useTask(() => {
    return () => {
      const timeoutId = store.pendingOpenTimeoutId$()
      if (timeoutId) clearTimeout(timeoutId)
    }
  })

  const apps = store.apps$()
  const profileCache = store.profileCache$()
  const title = store.title$()
  const description = store.description$()
  const authorPubkey = store.authorPubkey$()
  const isLoading = store.isLoading$()
  const error = store.error$()
  const pendingOpenAppId = store.pendingOpenAppId$()
  const starredAddresses = userCuration.starredAddresses$()
  const hasUser = Boolean(userCuration.userPubkey$())
  const authorProfile = authorPubkey ? profileCache[authorPubkey] || null : null
  const authorPending = !authorPubkey || !authorProfile
  const publishedAuthorName = authorProfile?.meta?.generatedName
    ? ''
    : [authorProfile?.name, authorProfile?.display_name]
        .find(name => typeof name === 'string' && name.trim())
        ?.trim() || ''
  const isAnonymous = !authorPending && !publishedAuthorName
  const authorName = publishedAuthorName || 'Anonymous'
  const titlePending = isLoading || !title
  const descriptionPending = isLoading

  return h`
    <div style=${{
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      padding: '20px',
      maxWidth: '900px',
      margin: '0 auto'
    }}>
      <style>
        @keyframes metadataTextPulse {
          0% { opacity: 0.35; }
          50% { opacity: 0.7; }
          100% { opacity: 0.35; }
        }
      </style>
      ${
        error
          ? h`
              <div style=${{
                display: 'flex',
                justifyContent: 'center',
                padding: '60px 20px',
                color: cssVars.colors.fg2,
                fontSize: '14px'
              }}>
                ${error}
              </div>
            `
          : h`
              <div style=${{
                display: 'flex',
                gap: '16px',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '16px',
                backgroundColor: cssVars.colors.bg2,
                borderRadius: '12px'
              }}>
                <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                  <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style=${{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      backgroundColor: cssVars.colors.bgAvatar,
                      flexShrink: 0
                    }}>
                      ${
                        authorPubkey
                          ? h`<a-avatar props=${{ pk: authorPubkey, style: 'svg { width: 100%; height: 100%; border-radius: 50%; }' }} />`
                          : ''
                      }
                    </div>
                    <div style=${{
                      fontSize: '14px',
                      fontWeight: '600',
                      color: authorPending ? 'transparent' : cssVars.colors.fg,
                      fontStyle: isAnonymous ? 'italic' : 'normal',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      width: authorPending ? '84px' : 'auto',
                      minHeight: authorPending ? '14px' : 'auto',
                      borderRadius: authorPending ? '7px' : '0',
                      backgroundColor: authorPending
                        ? cssVars.colors.bgAvatarLoading
                        : 'transparent',
                      animation: authorPending
                        ? 'metadataTextPulse 1.4s ease-in-out infinite'
                        : 'none'
                    }}>
                      ${authorPending ? '' : authorName}
                    </div>
                  </div>
                  <div style=${{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: titlePending ? 'transparent' : cssVars.colors.fg,
                    overflowWrap: 'anywhere',
                    width: titlePending ? '60%' : 'auto',
                    maxWidth: '100%',
                    minHeight: titlePending ? '24px' : 'auto',
                    borderRadius: titlePending ? '8px' : '0',
                    backgroundColor: titlePending
                      ? cssVars.colors.bgAvatarLoading
                      : 'transparent',
                    animation: titlePending
                      ? 'metadataTextPulse 1.4s ease-in-out infinite'
                      : 'none'
                  }}>
                    ${titlePending ? '' : (title || '…')}
                  </div>
                  ${
                    descriptionPending
                      ? h`
                          <div style=${{
                            width: '65%',
                            maxWidth: '100%',
                            minHeight: '15px',
                            borderRadius: '7px',
                            backgroundColor: cssVars.colors.bgAvatarLoading,
                            animation: 'metadataTextPulse 1.4s ease-in-out infinite'
                          }} />
                        `
                      : description
                      ? h`
                          <div style=${{
                            fontSize: '15px',
                            lineHeight: '1.45',
                            color: cssVars.colors.fg2,
                            overflowWrap: 'anywhere'
                          }}>
                            ${description}
                          </div>
                        `
                      : ''
                  }
                </div>
                <button
                  title='Share this curation set'
                  onclick=${() => store.sharePage()}
                  style=${{
                    cursor: 'pointer',
                    border: '1px solid ' + cssVars.colors.bg2,
                    backgroundColor: cssVars.colors.bgSelected2,
                    color: cssVars.colors.fg,
                    borderRadius: '50%',
                    width: '34px',
                    height: '34px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <icon-share props=${{ size: '18px' }} />
                </button>
              </div>

              <div style=${{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                ${
                  isLoading
                    ? [h`
                        <div style=${{
                          display: 'flex',
                          justifyContent: 'center',
                          padding: '40px 20px'
                        }}>
                          <div style=${{
                            width: '40px',
                            height: '40px',
                            border: '3px solid ' + cssVars.colors.bg2,
                            borderTop: '3px solid ' + cssVars.colors.bgSelected,
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                          }} />
                        </div>
                        <style>
                          @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                          }
                        </style>
                      `]
                    : apps.length === 0
                      ? [h`
                          <div style=${{
                            display: 'flex',
                            justifyContent: 'center',
                            padding: '60px 20px',
                            color: cssVars.colors.fg2,
                            fontSize: '14px'
                          }}>
                            No apps in this curation set
                          </div>
                        `]
                      : apps.map(app => h({ key: app.id })`
                          <f-to-signals
                            props=${{
                              from: ['app', 'profile', 'isStarred', 'hasUser', 'isPendingOpen'],
                              app,
                              profile: Object.prototype.hasOwnProperty.call(profileCache, app.pubkey)
                                ? profileCache[app.pubkey]
                                : null,
                              isStarred: starredAddresses.includes(appAddress(app)),
                              hasUser,
                              isPendingOpen: pendingOpenAppId === app.id,
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
              </div>
            `
      }
    </div>
  `
})
