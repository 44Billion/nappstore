import { f, useStore, useTask, useLocation } from '#f'
import { cssVars } from '#assets/styles/theme.js'
// import { npubEncode } from 'libp2r2p/nip19'
import { maybePeekPublicKey } from '#helpers/nostr/nip07.js'
import { useUserCuration } from '#helpers/use-user-curation.js'
import { useToast } from '#shared/toast.js'
import useGoBackOrToRoot from '#hooks/use-go-back-or-to-root.js'
import logo from '#assets/media/plusapp-mark.webp'
import '#shared/avatar.js'
import '#shared/icons/icon-chevron-left.js'
import '#shared/icons/icon-star.js'
import '#views/home/tabs.js'
import '#views/home/router.js'

f('aHome', function () {
  const loc = useLocation()
  const goBackOrToRoot = useGoBackOrToRoot()
  const { showToast } = useToast()
  const userCuration = useUserCuration()
  const isCurationSetPage = loc.route$().url.pathname.startsWith('/naddr1')
  const store = useStore(() => ({
    userPubkey$: null,

    async handleShareStarred () {
      const url = userCuration.shareStarredUrl()
      if (!url) return
      const shareData = { title: 'My starred apps', url }
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
    },

    handleAvatarClick (e) {
      e.preventDefault()
      // const pubkey = this.userPubkey$()
      // if (!pubkey) return

      // const npub = npubEncode(pubkey)
      // loc.pushState(null, '', `/profiles/${npub}`)
    }
  }))

  // Fetch logged-in user's pubkey
  useTask(async () => {
    await userCuration.load()
  })

  useTask(async () => {
    try {
      const pubkey = await maybePeekPublicKey()
      store.userPubkey$(pubkey)
    } catch (err) {
      console.error('Failed to get logged-in user:', err)
    }
  })

  const userPubkey = store.userPubkey$()
  const starredCount = userCuration.starredAddresses$().length

  return this.h`
    <div style=${{
      minHeight: '100vh',
      backgroundColor: cssVars.colors.bg
    }}>
      <!-- Header -->
      <header style=${{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        justifyContent: 'center',
        borderBottom: '1px solid ' + cssVars.colors.bg2,
        boxShadow: '0 2px 8px ' + cssVars.colors.shadow
      }}>
        <div
          style=${{
            maxWidth: '718px',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px'
          }}
        >
          <!-- Logo and Title -->
          ${
            isCurationSetPage
              ? this.h`
                  <button
                    onclick=${goBackOrToRoot}
                    title='Back'
                    style=${{
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      border: 'none',
                      background: 'transparent',
                      color: cssVars.colors.fg,
                      fontSize: '16px',
                      fontWeight: '600',
                      padding: '6px 8px'
                    }}
                  >
                    <icon-chevron-left props=${{ size: '20px' }} />
                    Back
                  </button>
                `
              : this.h`
                  <div style=${{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px'
                  }}>
                    <img
                      src=${logo}
                      alt="+App logo"
                      style=${{
                        width: '36px',
                        height: '36px',
                        objectFit: 'contain',
                        borderRadius: '50%',
                        backgroundColor: cssVars.colors.logoBg
                      }}
                    />
                    <div style=${{
                      fontSize: '20rem',
                      fontWeight: '600',
                      color: cssVars.colors.fg,
                      letterSpacing: '-0.5px'
                    }}>
                      App Store
                    </div>
                  </div>
                `
          }

          <!-- User actions: share button stays right next to the avatar -->
          <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            ${
              starredCount > 0
                ? this.h`
                    <button
                      onclick=${store.handleShareStarred}
                      title='Share my starred apps'
                      style=${{
                        cursor: 'pointer',
                        border: '1px solid ' + cssVars.colors.bg2,
                        backgroundColor: cssVars.colors.bgSelected2,
                        color: cssVars.colors.fg,
                        borderRadius: '16px',
                        padding: '6px 12px',
                        fontSize: '13px',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      Share
                      <icon-star props=${{ size: '14px', weight: 'duotone' }} />
                      Apps
                    </button>
                  `
                : ''
            }
            ${
              userPubkey
                ? this.h`
                    <div
                      onclick=${store.handleAvatarClick}
                      style=${{
                        cursor: 'pointer',
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        overflow: 'hidden',
                        border: '1px solid ' + cssVars.colors.bgSelected2,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        backgroundColor: cssVars.colors.bgAvatar
                      }}
                    >
                      <a-avatar
                        props=${{
                          pk: userPubkey
                        }}
                      />
                    </div>
                  `
                : this.h`
                    <div style=${{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      border: '1px solid ' + cssVars.colors.bgSelected2,
                      backgroundColor: cssVars.colors.bgAvatar,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16rem',
                      color: cssVars.colors.fg
                    }}>
                      ?
                    </div>
                  `
            }
          </div>
        </div>
      </header>

      <!-- Navigation Tabs -->
      ${
        isCurationSetPage
          ? []
          : [this.h`
              <div style=${{
                position: 'relative',
                zIndex: 0,
                maxWidth: '718px',
                margin: '0 auto',
                padding: '8px 10px 0',
                backgroundColor: cssVars.colors.bg
              }}>
                <home-tabs />
              </div>
            `]
      }

      <!-- Main Content -->
      <main
        style=${{
          position: 'relative',
          zIndex: 0,
          maxWidth: '718px',
          margin: '0 auto'
        }}
      >
        <home-router />
      </main>
    </div>
  `
})
