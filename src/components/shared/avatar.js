import { f, useSignal, useStore, useAsyncComputed } from '#f'
import { getSvgAvatar } from '#helpers/avatar.js'
import '#shared/icons/icon-user-circle.js'
import '#shared/svg.js'
import { base62ToBase16 } from '#helpers/base62.js'
import { cssVars } from '#assets/styles/theme.js'
import { getProfile } from '#helpers/nostr/queries.js'
import useWebStorage from '#hooks/use-web-storage.js'
import lru from '#services/lru.js'

// wrap it with a div setting width/height, border-radius and background-color
f(function aAvatar () {
  const pk$ = useSignal(this.props.pk$ ?? this.props.pk)
  const storage = useWebStorage(localStorage)
  const cache$ = useSignal(this.props.profileCache$ ?? this.props.profileCache$ ?? {
    get () {
      return lru.ns('accounts').getReactiveItem(
        `accountByUserPk_${pk$() ?? ''}_profile`,
        storage
      )
    },
    set (profile) {
      return lru.ns('accounts').setItem(
        `accountByUserPk_${pk$() ?? ''}_profile`,
        profile
      )
    }
  })
  const store = useStore({
    pk$,
    cache$,
    picture$: useAsyncComputed(async ({ track }) => {
      let profile
      const cache = track(() => cache$())
      if (cache) profile = track(() => cache.get())
      if (profile) return profile.picture ?? null

      profile = await getProfile(pk$()).catch(err => { console.error(err); return {} })
      if (!profile?.picture) return null

      const isDataImage = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*(?:;base64)?,/i.test(profile.picture)
      const isHttpImageUrl = /^(https?:\/\/)[^\s?#]+\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)(?:[?#].*)?$/i.test(profile.picture)
      const isRelativeImageUrl = /^(?:\.{0,2}\/)?[^\s?#]+\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)(?:[?#].*)?$/i.test(profile.picture)
      if (!(isDataImage || isHttpImageUrl || !isRelativeImageUrl)) return null

      cache.set(profile)
      return profile.picture
    }),
    svg$: useAsyncComputed(function () {
      const seed = pk$()
      if (!seed) return
      return getSvgAvatar(base62ToBase16(seed))
    }),
    svgStyle$: () => {
      return [
        `svg {
          width: 100%;
          height: 100%;
        }`,
        this.props.style$?.() || this.props.style || ''
      ]
    }
  })

  if (store.picture$.promise$().isLoading) {
    return this.h`<div
      style=${`
        width: 100%;
        height: 100%;
        border-style: solid;
        border-width: 0;
        overflow: hidden;
      `}
    >
      <style>${`
          @keyframes pulse {
            50% {
              opacity: .5;
            }
          }
        .animate-background {
          animation: pulse 2s cubic-bezier(.4,0,.6,1) infinite;
          background-color: ${cssVars.colors.bgAvatarLoading};
          position: relative;
          height: 100%;
        }
      `}</style>
      <div class='animate-background' />
    </div>`
  }

  if (store.picture$()) {
    return this.h`<img
      src=${store.picture$()}
      alt='User avatar'
      style=${`
        width: 100%;
        height: 100%;
        object-fit: cover;
      `}
    />`
  }

  if (!store.pk$() || !store.svg$()) {
    return this.h`<icon-user-circle props=${this.props} />`
  }

  return this.h`<a-svg props=${{ ...this.props, style$: store.svgStyle$, svg: store.svg$() }} />`
})
