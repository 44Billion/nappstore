import { f, useSignal, useStore, useAsyncComputed, useTask } from '#f'
import {
  getSvgAvatar,
  isCacheableAvatarProfile,
  isDataAvatarPicture,
  isValidAvatarPicture
} from '#helpers/avatar.js'
import '#shared/icons/icon-user-circle.js'
import '#shared/svg.js'
import { cssVars } from '#assets/styles/theme.js'
import { getProfile, selectPreferredProfile } from '#helpers/nostr/queries.js'
import useWebStorage from '#hooks/use-web-storage.js'
import lru from '#services/lru.js'

const AVATAR_PICTURE_TIMEOUT_MS = 15000

// wrap it with a div setting width/height, border-radius and background-color
f('a-avatar', ({ h, props }) => {
  const fallbackPk$ = useSignal(props.pk)
  const pk$ = props.pk$ ?? fallbackPk$
  const storage = useWebStorage(localStorage)
  const fallbackCache$ = useSignal(props.profileCache ?? {
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
    },
    remove () {
      return lru.ns('accounts').removeItem(`accountByUserPk_${pk$() ?? ''}_profile`)
    }
  })
  const cache$ = props.profileCache$ ?? fallbackCache$
  const getCachedProfile = () => cache$()?.get?.() || null
  const cacheProfile = profile => cache$()?.set?.(profile)
  const removeCachedProfile = () => cache$()?.remove?.()
  const store = useStore(() => ({
    pk$,
    loadedPicture$: null,
    rejectedPicture$: null,
    providedProfile$ () {
      return props.profile$?.() ?? props.profile ?? null
    },
    cachedProfile$ () {
      return getCachedProfile()
    },
    refreshedProfile$: useAsyncComputed(async ({ track }) => {
      const pk = track(() => pk$())
      const providedProfile = track(() => props.profile$?.() ?? props.profile ?? null)
      if (!pk) return providedProfile

      const queriedProfile = await getProfile(pk).catch(error => {
        console.error(`[avatar ${pk}] Failed to refresh profile:`, error)
        return null
      })
      const freshProfile = selectPreferredProfile(providedProfile, queriedProfile)

      const cachedProfile = getCachedProfile()
      const preferredProfile = selectPreferredProfile(cachedProfile, freshProfile)
      if (preferredProfile === freshProfile && isCacheableAvatarProfile(freshProfile)) {
        cacheProfile(freshProfile)
      } else if (preferredProfile === freshProfile && cachedProfile) {
        removeCachedProfile()
      }
      return preferredProfile
    }),
    profile$ () {
      return selectPreferredProfile(
        selectPreferredProfile(this.cachedProfile$(), this.providedProfile$()),
        this.refreshedProfile$()
      )
    },
    picture$ () {
      const picture = this.profile$()?.picture
      return isValidAvatarPicture(picture) ? picture : null
    },
    pictureToRender$ () {
      const picture = this.picture$()
      const rejected = this.rejectedPicture$()
      return picture && !(rejected?.pk === this.pk$() && rejected.picture === picture)
        ? picture
        : null
    },
    isPictureLoaded$ () {
      const picture = this.pictureToRender$()
      if (isDataAvatarPicture(picture)) return true
      const loaded = this.loadedPicture$()
      return !!picture && loaded?.pk === this.pk$() && loaded.picture === picture
    },
    markPictureLoaded (event) {
      const picture = this.pictureToRender$()
      if (!picture || event.currentTarget.getAttribute('src') !== picture) return
      this.loadedPicture$({ pk: this.pk$(), picture })
    },
    failPicture (picture, error) {
      if (!picture || picture !== this.pictureToRender$()) return
      console.error(`[avatar ${this.pk$() || 'unknown'}] Failed to load avatar picture:`, error)
      this.loadedPicture$(null)
      this.rejectedPicture$({ pk: this.pk$(), picture })
    },
    rejectPicture (event) {
      const picture = this.pictureToRender$()
      if (!picture || event.currentTarget.getAttribute('src') !== picture) return
      this.failPicture(picture, new Error(`Avatar picture failed to load: ${picture}`))
    },
    svg$ () {
      const seed = pk$()
      if (!seed) return
      return getSvgAvatar(seed)
    },
    svgStyle$: () => {
      return [
        `svg {
          width: 100%;
          height: 100%;
        }`,
        props.style$?.() || props.style || ''
      ]
    }
  }))

  useTask(({ track, cleanup }) => {
    const { picture, isLoaded } = track(() => ({
      picture: store.pictureToRender$(),
      isLoaded: store.isPictureLoaded$()
    }))
    if (!picture || isLoaded) return

    const timeoutId = setTimeout(() => {
      const error = new Error(`Avatar picture timed out after ${AVATAR_PICTURE_TIMEOUT_MS}ms: ${picture}`)
      error.name = 'TimeoutError'
      store.failPicture(picture, error)
    }, AVATAR_PICTURE_TIMEOUT_MS)
    cleanup(() => clearTimeout(timeoutId))
  })

  if (!store.profile$() && store.refreshedProfile$.promise$().isLoading) {
    return h`<div
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

  const picture = store.pictureToRender$()
  if (picture) {
    const isPictureLoaded = store.isPictureLoaded$()
    return h`
      <style>
        @keyframes avatarPulse {
          0% { opacity: 0.1; }
          50% { opacity: 0.5; }
          100% { opacity: 0.1; }
        }
      </style>
      <span style=${`
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      `}>
        <span
          aria-hidden='true'
          style=${`
            position: absolute;
            inset: 0;
            background-color: ${cssVars.colors.bgAvatarLoading};
            visibility: ${isPictureLoaded ? 'hidden' : 'visible'};
            animation: ${isPictureLoaded ? 'none' : 'avatarPulse 2s cubic-bezier(.4,0,.6,1) infinite'};
          `}
        />
        <img
          src=${picture}
          decoding='async'
          onload=${store.markPictureLoaded}
          onerror=${store.rejectPicture}
          alt='User avatar'
          style=${`
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            visibility: ${isPictureLoaded ? 'visible' : 'hidden'};
          `}
        />
      </span>
    `
  }

  if (!store.pk$() || !store.svg$()) {
    return h`<icon-user-circle props=${props} />`
  }

  return h`<a-svg props=${{ ...props, style$: store.svgStyle$, svg: store.svg$() }} />`
})
