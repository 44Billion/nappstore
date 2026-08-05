import { f, useMemo, useStore, useTask } from '#f'
import useWebStorage from '#hooks/use-web-storage.js'
import lru from '#services/lru.js'
import connectivityRetry from '#services/connectivity-retry.js'
import { discoverHtmlIconFallbacks } from '#services/app-metadata-fetcher.js'
import {
  getAppIconLayerState,
  getAppIconCandidateState,
  getAppIconMonogram,
  isAppIconResolutionPending,
  reconcileAppIconCandidates
} from '#shared/app-icon-candidates.js'

// Rejects late load/error events from a candidate that is no longer current.
function imageMatchesCandidate (image, candidate) {
  const loadedUrl = image.currentSrc || image.src
  try {
    return new URL(loadedUrl, document.baseURI).href === new URL(candidate.url, document.baseURI).href
  } catch (_) {
    return loadedUrl === candidate.url
  }
}

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
    appName$ () { return props.app$().name ?? '' },
    appFx$ () { return props.app$().fx ?? null },
    consumerResolutionPending$ () { return props.app$().iconResolutionPending },
    style$ () { return props.style$?.() ?? props.style ?? '' },
    cachedIcon$: null,
    iconCandidates$: [],
    iconIndex$: 0,
    candidatesKey$: null,
    exhausted$: false,
    isDiscovering$: false,
    displayedIcon$: null,
    hasReadIconState$: false,
    htmlDiscovered$: false,
    discoveryAttempted: false,
    currentIcon$ () { return this.iconCandidates$()[this.iconIndex$()] ?? null },
    isPending$ () {
      return isAppIconResolutionPending({
        hasReadIconState: this.hasReadIconState$(),
        consumerResolutionPending: this.consumerResolutionPending$(),
        isDiscovering: this.isDiscovering$(),
        appFx: this.appFx$(),
        currentIcon: this.currentIcon$(),
        exhausted: this.exhausted$()
      })
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
      this.displayedIcon$(null)
      this.hasReadIconState$(false)
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
        const reconciled = reconcileAppIconCandidates(
          state.candidates,
          this.displayedIcon$(),
          runtime.rejectedUrls
        )
        this.candidatesKey$(candidatesKey)
        this.cachedIcon$(cachedIcon)
        this.htmlDiscovered$(state.htmlDiscovered)
        this.iconCandidates$(reconciled.candidates)
        this.iconIndex$(reconciled.index)
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
      const icon = this.currentIcon$()
      if (!icon || !imageMatchesCandidate(event.currentTarget, icon)) return
      this.displayedIcon$(icon)
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
      if (!imageMatchesCandidate(event.currentTarget, candidate)) return

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
    store.hasReadIconState$(true)
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
  const displayedIcon = store.displayedIcon$()
  if (displayedIcon || (icon && !store.exhausted$())) {
    const layerState = getAppIconLayerState(displayedIcon, icon)

    return h`
      <style>
        @keyframes iconPulse {
          0% { opacity: 0.1; }
          50% { opacity: 0.25; }
          100% { opacity: 0.1; }
        }
      </style>
      <span
        role='img'
        aria-label='App icon'
        style=${`
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
            visibility: ${layerState.isShimmerVisible ? 'visible' : 'hidden'};
            animation: ${layerState.isShimmerVisible ? 'iconPulse 1.4s ease-in-out infinite' : 'none'};
          `}
        />
        <img
          src=${displayedIcon?.url ?? null}
          alt=''
          aria-hidden='true'
          style=${`
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            visibility: ${layerState.isDisplayedLayerVisible ? 'visible' : 'hidden'};
            ${store.style$()}
          `}
        />
        <img
          ref=${store.setImageElement}
          src=${icon?.url ?? null}
          loading='lazy'
          data-icon-index=${icon ? store.iconIndex$() : -1}
          onload=${store.markIconLoaded}
          onerror=${store.showNextIcon}
          alt=''
          aria-hidden='true'
          style=${`
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: ${layerState.isCandidateLayerVisible ? 1 : 0};
            pointer-events: none;
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

  const monogram = getAppIconMonogram(store.appId$(), store.appName$())
  return h`
    <span
      class='hue-revert'
      role='img'
      aria-label='App icon'
      style=${`
      color-scheme: light dark;
      container-type: inline-size;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: light-dark(${monogram.lightBg}, ${monogram.darkBg});
      color: light-dark(${monogram.lightFg}, ${monogram.darkFg});
      ${store.style$()}
    `}
    >
      <span
        aria-hidden='true'
        style=${`
          font-size: 14rem;
          font-size: clamp(14rem, 42cqi, 24rem);
          font-weight: 700;
          line-height: 1;
          letter-spacing: -0.04em;
          user-select: none;
        `}
      >${monogram.label}</span>
    </span>
  `
})
