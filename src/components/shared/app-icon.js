import { f, useMemo, useStore, useTask } from '#f'
import useWebStorage from '#hooks/use-web-storage.js'
import lru from '#services/lru.js'
import connectivityRetry from '#services/connectivity-retry.js'
import { discoverHtmlIconFallbacks } from '#services/app-metadata-fetcher.js'
import { getAppIconCandidateState } from '#shared/app-icon-candidates.js'

// Displays manifest icons lazily and discovers HTML fallbacks only on demand.
f('app-icon', ({ h, props }) => {
  const storage = useWebStorage(localStorage)
  // Native objects with internal slots must stay outside useStore's proxies.
  const runtime = useMemo(() => ({
    currentAppId: null,
    imageElement: null,
    retryRelease: null,
    rejectedUrls: new Set(),
    abortController: new AbortController()
  }))
  const store = useStore(() => ({
    appId$ () { return props.app$().id },
    appIndex$ () { return props.app$().index ?? '?' },
    appFx$ () { return props.app$().fx ?? null },
    style$ () { return props.style$?.() ?? props.style ?? '' },
    cachedIcon$: null,
    iconCandidates$: [],
    iconIndex$: 0,
    candidatesKey$: null,
    exhausted$: false,
    isDiscovering$: false,
    isImageLoaded$: false,
    htmlDiscovered$: false,
    discoveryAttempted: false,
    currentIcon$ () { return this.iconCandidates$()[this.iconIndex$()] ?? null },
    isPending$ () {
      return this.isDiscovering$() ||
        (!!this.appFx$() && !this.currentIcon$() && !this.exhausted$())
    },
    resetForApp (appId) {
      if (runtime.currentAppId === appId) return
      this.finishRetry()
      runtime.abortController.abort()
      runtime.abortController = new AbortController()
      runtime.currentAppId = appId
      runtime.imageElement = null
      runtime.rejectedUrls = new Set()
      this.discoveryAttempted = false
      this.isImageLoaded$(false)
    },
    useCachedIcon (cachedIcon) {
      const state = getAppIconCandidateState(cachedIcon, runtime.rejectedUrls, {
        discoveryAttempted: this.discoveryAttempted
      })
      const candidatesKey = JSON.stringify([
        this.appId$(),
        state.candidates,
        state.htmlDiscovered
      ])
      if (this.candidatesKey$() !== candidatesKey) {
        const previousUrl = this.currentIcon$()?.url
        this.candidatesKey$(candidatesKey)
        this.cachedIcon$(cachedIcon)
        this.htmlDiscovered$(state.htmlDiscovered)
        this.iconCandidates$(state.candidates)
        this.iconIndex$(state.index)
        if (previousUrl !== state.candidates[state.index]?.url) this.isImageLoaded$(false)
      }
      this.exhausted$(state.exhausted)
    },
    setImageElement (element) {
      runtime.imageElement = element
    },
    finishRetry () {
      runtime.retryRelease?.()
      runtime.retryRelease = null
    },
    markIconLoaded (event) {
      if (Number(event.currentTarget.dataset.iconIndex) !== this.iconIndex$()) return
      this.isImageLoaded$(true)
      this.finishRetry()
    },
    async waitForOnline () {
      try {
        await connectivityRetry.waitUntilOnline({ signal: runtime.abortController.signal })
      } catch (error) {
        if (error?.name !== 'AbortError') console.error('Failed to resume app icon:', error)
      }
    },
    async retryCurrentWhenOnline () {
      try {
        await connectivityRetry.runWhenOnline(() => new Promise(resolve => {
          runtime.retryRelease = resolve
          const image = runtime.imageElement
          const candidate = this.currentIcon$()
          if (!image || !candidate) return this.finishRetry()
          image.removeAttribute('src')
          queueMicrotask(() => {
            if (runtime.abortController.signal.aborted || runtime.imageElement !== image) {
              return this.finishRetry()
            }
            image.src = candidate.url
          })
        }), { signal: runtime.abortController.signal })
      } catch (error) {
        if (error?.name !== 'AbortError') console.error('Failed to retry app icon:', error)
      }
    },
    async discoverFallbacks () {
      if (this.discoveryAttempted || this.htmlDiscovered$() || runtime.abortController.signal.aborted) return
      let online = false
      try {
        online = await connectivityRetry.confirmOnline()
      } catch (_) {}
      if (!online) {
        await this.waitForOnline()
        if (!runtime.abortController.signal.aborted) return this.discoverFallbacks()
        return
      }

      this.discoveryAttempted = true
      this.isDiscovering$(true)
      try {
        const icon = await connectivityRetry.run(
          () => discoverHtmlIconFallbacks(this.appId$(), this.cachedIcon$()),
          { signal: runtime.abortController.signal }
        )
        if (!runtime.abortController.signal.aborted) {
          if (!icon.htmlDiscovered) {
            const online = await connectivityRetry.confirmOnline({ force: true })
            if (!online) {
              this.discoveryAttempted = false
              this.isDiscovering$(false)
              await this.waitForOnline()
              if (!runtime.abortController.signal.aborted) return this.discoverFallbacks()
            } else {
              this.useCachedIcon(icon)
              lru.ns('apps').setItem(`appById_${this.appId$()}_icon`, icon)
              this.exhausted$(true)
            }
          } else {
            this.useCachedIcon(icon)
            lru.ns('apps').setItem(`appById_${this.appId$()}_icon`, icon)
          }
        }
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Failed to discover app icon fallbacks:', error)
          this.exhausted$(true)
        }
      } finally {
        if (!runtime.abortController.signal.aborted) this.isDiscovering$(false)
      }
    },
    async showNextIcon (event) {
      this.finishRetry()
      const renderedIndex = Number(event.currentTarget.dataset.iconIndex)
      if (renderedIndex !== this.iconIndex$()) return
      const candidate = this.currentIcon$()
      if (!candidate) return

      if (!candidate.url.startsWith('data:')) {
        let online = false
        try { online = await connectivityRetry.confirmOnline({ force: true }) } catch (_) {}
        if (!online) return this.retryCurrentWhenOnline()
      }

      runtime.rejectedUrls.add(candidate.url)
      const nextIndex = this.iconCandidates$().findIndex((next, index) =>
        index > renderedIndex && !runtime.rejectedUrls.has(next.url)
      )
      if (nextIndex >= 0) {
        this.isImageLoaded$(false)
        this.iconIndex$(nextIndex)
        return
      }
      if (!this.htmlDiscovered$()) await this.discoverFallbacks()
      else this.exhausted$(true)
    }
  }))

  useTask(({ track }) => {
    const [appId, cachedIcon] = track(() => [
      store.appId$(),
      lru.ns('apps').getReactiveItem(`appById_${store.appId$()}_icon`, storage)
    ])
    store.resetForApp(appId)
    store.useCachedIcon(cachedIcon)
  })

  useTask(async ({ track }) => {
    const [cachedIcon, candidatesKey] = track(() => [store.cachedIcon$(), store.candidatesKey$()])
    if (!cachedIcon || !candidatesKey || store.currentIcon$() || store.htmlDiscovered$()) return
    await store.discoverFallbacks()
  })

  useTask(({ cleanup }) => {
    cleanup(() => {
      store.finishRetry()
      runtime.abortController.abort()
    })
  })

  const icon = store.currentIcon$()
  if (icon && !store.exhausted$()) {
    const isImageLoaded = store.isImageLoaded$()

    return h`
      <style>
        @keyframes iconPulse {
          0% { opacity: 0.1; }
          50% { opacity: 0.25; }
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
            border-radius: inherit;
            background: currentColor;
            opacity: 0.1;
            visibility: ${isImageLoaded ? 'hidden' : 'visible'};
            animation: ${isImageLoaded ? 'none' : 'iconPulse 1.4s ease-in-out infinite'};
          `}
        />
        <img
          ref=${store.setImageElement}
          src=${icon.url}
          loading='lazy'
          data-icon-index=${store.iconIndex$()}
          onload=${store.markIconLoaded}
          onerror=${store.showNextIcon}
          alt='App icon'
          style=${`
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            visibility: ${isImageLoaded ? 'visible' : 'hidden'};
            ${store.style$()}
          `}
        />
      </span>
    `
  }

  if (store.isPending$()) {
    return h`
      <style>
        @keyframes iconPulse {
          0% { opacity: 0.1; }
          50% { opacity: 0.25; }
          100% { opacity: 0.1; }
        }
      </style>
      <span style=${`
        display: flex;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: currentColor;
        opacity: 0.1;
        animation: iconPulse 1.4s ease-in-out infinite;
        ${store.style$()}
      `} />
    `
  }

  return h`
    <span style=${`
      font-weight: bold;
      font-size: 14px;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
      ${store.style$()}
    `}>${store.appIndex$()}</span>
  `
})
