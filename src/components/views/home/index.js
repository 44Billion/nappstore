import { f, useStore, useTask } from '#f'
import { cssVars } from '#assets/styles/theme.js'
// import { npubEncode } from 'libp2r2p/nip19'
import { maybePeekPublicKey } from '#helpers/nostr/nip07.js'
// import useLocation from '#hooks/use-location.js'
import logo from '#assets/media/plusapp.webp'
import '#shared/avatar.js'
import '#views/home/tabs.js'
import '#views/home/router.js'

f('aHome', function () {
  // const loc = useLocation()
  const store = useStore(() => ({
    userPubkey$: null,

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
    try {
      const pubkey = await maybePeekPublicKey()
      store.userPubkey$(pubkey)
    } catch (err) {
      console.error('Failed to get logged-in user:', err)
    }
  })

  const userPubkey = store.userPubkey$()

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
                borderRadius: '50%'
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

          <!-- User Avatar -->
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
      </header>

      <!-- Navigation Tabs -->
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
