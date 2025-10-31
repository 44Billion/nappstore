import { f, useClosestStore, useStore, useTask } from '#f'
import '#f/components/f-to-signals.js'
import { npubDecode, appEncode } from '#helpers/nostr/nip19.js'
import { maybePeekPublicKey } from '#helpers/nostr/nip07.js'
import { getRelays } from '#helpers/nostr/queries.js'
import nostrRelays from '#services/nostr-relays.js'
import { fetchAppMetadata } from '#services/app-metadata-fetcher.js'
import { cssVars } from '#assets/styles/theme.js'
import { useToast } from '#shared/toast.js'
import { setSessionStorageItem } from '#hooks/use-web-storage.js'
import '#shared/avatar.js'
import '#shared/app-icon.js'

// Show a user's profile and their uploaded apps
f('profilesShow', function () {
  const { params$ } = useClosestStore('<a-route>')
  const { showToast } = useToast()
  const store = useStore(() => ({
    npub$ () { return params$().npub },
    profile$: null,
    apps$: [],
    isFollowing$: false,
    isLoadingProfile$: true,
    isLoadingApps$: true,
    isUpdatingFollow$: false,
    loggedInPubkey$: null,

    async handleFollowToggle () {
      const loggedInPubkey = store.loggedInPubkey$()
      if (!loggedInPubkey) {
        showToast('Please sign in to follow users', 'error', 3000)
        return
      }

      if (loggedInPubkey === pubkey) {
        showToast('You cannot follow yourself', 'error', 2000)
        return
      }

      store.isUpdatingFollow$(true)

      try {
        const { write: writeRelays } = await getRelays(loggedInPubkey)

        // Fetch current contact list (kind 3)
        const { result: events } = await nostrRelays.getEvents(
          { kinds: [3], authors: [loggedInPubkey], limit: 1 },
          writeRelays
        )

        let tags = []
        let content = ''

        if (events.length > 0) {
          tags = events[0].tags
          content = events[0].content
        }

        const isCurrentlyFollowing = store.isFollowing$()

        if (isCurrentlyFollowing) {
          // Unfollow: remove the p tag
          tags = tags.filter(tag => !(tag[0] === 'p' && tag[1] === pubkey))
        } else {
          // Follow: add the p tag
          tags.push(['p', pubkey])
        }

        // Create new contact list event
        const newEvent = {
          kind: 3,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content
        }

        // Sign and publish
        const signedEvent = await window.nostr.signEvent(newEvent)
        await nostrRelays.publishEvent(signedEvent, writeRelays)

        store.isFollowing$(!isCurrentlyFollowing)
        showToast(
          isCurrentlyFollowing ? 'Unfollowed successfully' : 'Following!',
          'success',
          2000
        )
      } catch (err) {
        console.error('Failed to update follow status:', err)
        showToast('Failed to update follow status', 'error', 3000)
      } finally {
        store.isUpdatingFollow$(false)
      }
    },

    handleOpenApp (app) {
      const encodedApp = appEncode({
        dTag: app.dTag,
        pubkey: app.pubkey,
        kind: 37448
      })
      const url = `${IS_PRODUCTION ? 'https://44billion.net' : 'http://localhost:10000'}/${encodedApp}`
      window.open(url, '_blank')
    }
  }))

  // Decode npub to get hex pubkey
  const pubkey = npubDecode(store.npub$())

  // Fetch logged-in user's pubkey
  useTask(async () => {
    try {
      const loggedInPubkey = await maybePeekPublicKey()
      store.loggedInPubkey$(loggedInPubkey)
    } catch (err) {
      console.error('Failed to get logged-in user:', err)
    }
  })

  // Fetch user profile (kind 0)
  useTask(async () => {
    store.isLoadingProfile$(true)
    try {
      const { write: writeRelays } = await getRelays(pubkey)
      const { result: events } = await nostrRelays.getEvents(
        { kinds: [0], authors: [pubkey], limit: 1 },
        writeRelays
      )

      if (events.length > 0) {
        const profileData = JSON.parse(events[0].content)
        store.profile$(profileData)
      } else {
        store.profile$({})
      }
    } catch (err) {
      console.error('Failed to fetch profile:', err)
      store.profile$({})
    } finally {
      store.isLoadingProfile$(false)
    }
  })

  // Fetch user's apps (kind 37448)
  useTask(async () => {
    store.isLoadingApps$(true)
    try {
      const { write: writeRelays } = await getRelays(pubkey)
      const { result: events } = await nostrRelays.getEvents(
        { kinds: [37448], authors: [pubkey] },
        writeRelays
      )

      if (events.length === 0) {
        store.apps$([])
        store.isLoadingApps$(false)
        return
      }

      // Group by d tag and keep only most recent
      const appsByDTag = events.reduce((acc, event) => {
        const dTag = event.tags.find(t => t[0] === 'd')?.[1]
        if (!dTag) return acc

        if (!acc[dTag] || event.created_at > acc[dTag].created_at) {
          acc[dTag] = event
        }
        return acc
      }, {})

      // Fetch metadata for each app
      const apps = await Promise.all(
        Object.values(appsByDTag).map(async (bundleEvent) => {
          const dTag = bundleEvent.tags.find(t => t[0] === 'd')[1]
          const metadata = await fetchAppMetadata(bundleEvent, writeRelays)

          // Store icon in sessionStorage for app-icon component
          if (metadata.icon) {
            try {
              setSessionStorageItem(
                `appById_${dTag}_icon`,
                { url: metadata.icon }
              )
            } catch (err) {
              console.error('Failed to cache icon:', err)
            }
          }

          return {
            dTag,
            pubkey,
            name: metadata.name || dTag,
            description: metadata.description || 'No description',
            icon: metadata.icon,
            uploadedAt: bundleEvent.created_at * 1000
          }
        })
      )

      // Sort by upload date (newest first)
      apps.sort((a, b) => b.uploadedAt - a.uploadedAt)
      store.apps$(apps)
    } catch (err) {
      console.error('Failed to fetch apps:', err)
      store.apps$([])
    } finally {
      store.isLoadingApps$(false)
    }
  })

  // Check if logged-in user follows this profile
  useTask(async () => {
    const loggedInPubkey = store.loggedInPubkey$()
    if (!loggedInPubkey || loggedInPubkey === pubkey) return

    try {
      const { write: writeRelays } = await getRelays(loggedInPubkey)
      const { result: events } = await nostrRelays.getEvents(
        { kinds: [3], authors: [loggedInPubkey], limit: 1 },
        writeRelays
      )

      if (events.length > 0) {
        const contactList = events[0]
        const isFollowing = contactList.tags.some(
          tag => tag[0] === 'p' && tag[1] === pubkey
        )
        store.isFollowing$(isFollowing)
      }
    } catch (err) {
      console.error('Failed to check follow status:', err)
    }
  })

  const profile = store.profile$()
  const apps = store.apps$()
  const isFollowing = store.isFollowing$()
  const isLoadingProfile = store.isLoadingProfile$()
  const isLoadingApps = store.isLoadingApps$()
  const isUpdatingFollow = store.isUpdatingFollow$()
  const loggedInPubkey = store.loggedInPubkey$()
  const isOwnProfile = loggedInPubkey === pubkey

  return this.h`
    <div style=${{
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
      padding: '20px',
      maxWidth: '800px',
      margin: '0 auto'
    }}>
      <!-- Profile Header -->
      <div style=${{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        backgroundColor: cssVars.colors.mg,
        borderRadius: '12px',
        border: '2px solid ' + cssVars.colors.mgBorder
      }}>
        ${
  isLoadingProfile
    ? this.h`
          <div style=${{
            display: 'flex',
            justifyContent: 'center',
            padding: '20px',
            color: cssVars.colors.fg2
          }}>
            Loading profile...
          </div>
        `
    : this.h`
          <div style=${{
            display: 'flex',
            gap: '16px',
            alignItems: 'flex-start'
          }}>
            <!-- Avatar -->
            <div style=${{
              flexShrink: 0,
              width: '80px',
              height: '80px',
              backgroundColor: cssVars.colors.bgAvatar
            }}>
              <a-avatar
                props=${{
                  pk: pubkey,
                  style: `svg {
                    width: 100%;
                    height: 100%;
                    border-radius: 12px;
                  }`
                }}
              />
            </div>

            <!-- Profile Info -->
            <div style=${{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minWidth: 0
            }}>
              <div style=${{
                fontSize: '24px',
                fontWeight: 'bold',
                color: cssVars.colors.fg2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                ${profile?.name || profile?.display_name || 'Anonymous'}
              </div>

              ${
  profile?.about
    ? this.h`
                <div style=${{
                  fontSize: '14px',
                  color: cssVars.colors.fg2,
                  lineHeight: '1.5',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  ${profile.about}
                </div>
              `
    : ''
}

              <!-- Follow Button -->
              ${
  !isOwnProfile && loggedInPubkey
    ? this.h`
                <button
                  onclick=${store.handleFollowToggle}
                  disabled=${isUpdatingFollow}
                  style=${{
                    padding: '8px 16px',
                    backgroundColor: isFollowing
                      ? cssVars.colors.mg
                      : cssVars.colors.primary,
                    color: isFollowing ? cssVars.colors.fg2 : 'white',
                    border: isFollowing
                      ? '2px solid ' + cssVars.colors.mgBorder
                      : 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: isUpdatingFollow ? 'not-allowed' : 'pointer',
                    opacity: isUpdatingFollow ? 0.6 : 1,
                    transition: 'all 0.2s',
                    alignSelf: 'flex-start'
                  }}
                >
                  ${
  isUpdatingFollow
    ? 'Updating...'
    : isFollowing
      ? 'Unfollow'
      : 'Follow'
}
                </button>
              `
    : ''
}
            </div>
          </div>
        `
}
      </div>

      <!-- Apps Section -->
      <div style=${{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style=${{
          fontSize: '20px',
          fontWeight: 'bold',
          color: cssVars.colors.fg2,
          paddingBottom: '8px',
          borderBottom: '2px solid ' + cssVars.colors.mgBorder
        }}>
          ${isOwnProfile ? 'My Napps' : 'Napps'}
        </div>

        ${
  isLoadingApps
    ? this.h`
          <div style=${{
            display: 'flex',
            justifyContent: 'center',
            padding: '40px',
            color: cssVars.colors.fg2
          }}>
            Loading apps...
          </div>
        `
    : apps.length === 0
      ? this.h`
          <div style=${{
            display: 'flex',
            justifyContent: 'center',
            padding: '40px',
            color: cssVars.colors.fg2,
            fontSize: '14px'
          }}>
            No apps uploaded yet
          </div>
        `
      : apps.map((app, index) => this.h({ key: app.dTag })`
          <f-to-signals
            key=${app.dTag}
            props=${{
              from: ['app'],
              app: { id: app.dTag, index: index + 1 },
              render: props => this.h`
                <div
                  onclick=${() => store.handleOpenApp(app)}
                  style=${{
                    display: 'flex',
                    gap: '12px',
                    padding: '12px',
                    backgroundColor: cssVars.colors.mg,
                    borderRadius: '8px',
                    border: '2px solid ' + cssVars.colors.mgBorder,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onmouseenter=${(e) => {
                    e.currentTarget.style.borderColor = cssVars.colors.primary
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }}
                  onmouseleave=${(e) => {
                    e.currentTarget.style.borderColor = cssVars.colors.mgBorder
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}
                >
                  <div style=${{
                    width: '48px',
                    height: '48px',
                    flexShrink: 0
                  }}>
                    <app-icon props=${props} />
                  </div>

                  <div style=${{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    minWidth: 0
                  }}>
                    <div style=${{
                      fontSize: '14px',
                      fontWeight: 'bold',
                      color: cssVars.colors.fg2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      ${app.name}
                    </div>
                    <div style=${{
                      fontSize: '12px',
                      color: cssVars.colors.fg2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: '2',
                      WebkitBoxOrient: 'vertical'
                    }}>
                      ${app.description}
                    </div>
                  </div>
                </div>
              `
            }}
          />
        `)
}
      </div>
    </div>
  `
})
