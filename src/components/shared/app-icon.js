import { f, useMemo, useStore, useTask } from '#f'
import useWebStorage from '#hooks/use-web-storage.js'
import lru from '#services/lru.js'
import connectivityRetry from '#services/connectivity-retry.js'
import { discoverHtmlIconFallbacks } from '#services/app-metadata-fetcher.js'
import { getCanonicalAppId, getAppIconLogPrefix } from '#helpers/app.js'
import { isDataAppIconUrl } from '#helpers/app-icon.js'
import {
  getAppIconLayerState,
  getAppIconCandidateState,
  getEquivalentAppIconCandidateIndex,
  getAppIconMonogram,
  getAppIconUpgradeIndex,
  isAppIconResolutionPending,
  promoteAppIconCandidate,
  reconcileAppIconCandidates
} from '#shared/app-icon-candidates.js'

const ICON_CANDIDATE_TIMEOUT_MS = 5000
const HTML_DISCOVERY_TIMEOUT_MS = 12000
const HTML_DISCOVERY_TERMINAL_TIMEOUT_MS = 15000

// Reports when the complete discovery operation, including queueing, took too long.
function discoveryTimeoutError (appId) {
  const error = new Error(
    `App icon discovery timed out for ${appId} after ${HTML_DISCOVERY_TERMINAL_TIMEOUT_MS}ms`
  )
  error.name = 'TimeoutError'
  error.appId = appId
  return error
}

// Stops a component-owned operation without reporting an expected unmount as a failure.
function componentAbortError () {
  const error = new Error('App icon discovery aborted')
  error.name = 'AbortError'
  return error
}

// Rejects late load/error events from a candidate that is no longer current.
function imageMatchesCandidate (image, candidate) {
  try {
    const candidateHref = new URL(candidate.url, document.baseURI).href
    // The assigned src always identifies the candidate we set; currentSrc is
    // the resource actually loaded after redirects (e.g. a blossom server
    // redirecting to a CDN), which would otherwise never match the candidate.
    return new URL(image.src, document.baseURI).href === candidateHref ||
      new URL(image.currentSrc || image.src, document.baseURI).href === candidateHref
  } catch (_) {
    return image.src === candidate.url || (image.currentSrc || image.src) === candidate.url
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
    candidateTimer: null,
    candidateObserver: null,
    upgradeAttempted: false,
    upgradeCandidateUrl: null,
    rejectedUrls: new Set(),
    discoveryController: null,
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
      this.clearCandidateTimeout()
      runtime.discoveryController?.abort()
      runtime.abortController.abort()
      runtime.abortController = new AbortController()
      runtime.currentAppId = appId
      runtime.imageElement = null
      runtime.upgradeAttempted = false
      runtime.upgradeCandidateUrl = null
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
        const upgradeIndex = getAppIconUpgradeIndex(
          reconciled.candidates,
          this.displayedIcon$(),
          runtime.rejectedUrls,
          {
            discoveryComplete: state.htmlDiscovered,
            upgradeAttempted: runtime.upgradeAttempted
          }
        )
        if (upgradeIndex >= 0) {
          reconciled.index = upgradeIndex
          runtime.upgradeAttempted = true
          runtime.upgradeCandidateUrl = reconciled.candidates[upgradeIndex].url
        }
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
    clearCandidateTimeout () {
      if (runtime.candidateTimer) clearTimeout(runtime.candidateTimer)
      runtime.candidateObserver?.disconnect()
      runtime.candidateTimer = null
      runtime.candidateObserver = null
    },
    startCandidateTimeout (image, candidate, renderedIndex) {
      this.clearCandidateTimeout()
      if (!image || !candidate || isDataAppIconUrl(candidate.url)) return
      const start = () => {
        runtime.candidateTimer = setTimeout(() => {
          runtime.candidateTimer = null
          if (runtime.imageElement === image) image.removeAttribute('src')
          this.rejectCandidate(image, candidate, renderedIndex, { requireImageMatch: false })
        }, ICON_CANDIDATE_TIMEOUT_MS)
      }
      if (typeof IntersectionObserver === 'undefined') return start()
      runtime.candidateObserver = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        runtime.candidateObserver?.disconnect()
        runtime.candidateObserver = null
        if (runtime.imageElement === image && this.currentIcon$()?.url === candidate.url) start()
      })
      runtime.candidateObserver.observe(image)
    },
    markIconLoaded (event) {
      if (Number(event.currentTarget.dataset.iconIndex) !== this.iconIndex$()) return
      const icon = this.currentIcon$()
      if (!icon || !imageMatchesCandidate(event.currentTarget, icon)) return
      this.clearCandidateTimeout()
      if (runtime.upgradeCandidateUrl === icon.url) runtime.upgradeCandidateUrl = null
      this.displayedIcon$(icon)
      if (this.cachedIcon$()?.url !== icon.url) {
        const promoted = promoteAppIconCandidate(this.cachedIcon$(), icon)
        this.useCachedIcon(promoted)
        lru.ns('apps').setItem(`appById_${this.appId$()}_icon`, promoted)
      }
      this.finishRetry()
    },
    async waitForOnline (appId = this.appId$()) {
      const logPrefix = getAppIconLogPrefix(appId)
      try {
        await connectivityRetry.waitUntilOnline({ signal: runtime.abortController.signal })
      } catch (error) {
        if (error?.name !== 'AbortError') console.error(`${logPrefix} Failed to resume app icon:`, error)
      }
    },
    async retryCurrentWhenOnline () {
      const appId = this.appId$()
      const logPrefix = getAppIconLogPrefix(appId)
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
            this.startCandidateTimeout(image, candidate, this.iconIndex$())
          })
        }), { signal: runtime.abortController.signal, logPrefix })
      } catch (error) {
        if (error?.name !== 'AbortError') console.error(`${logPrefix} Failed to retry app icon:`, error)
      }
    },
    async discoverFallbacks () {
      if (this.discoveryAttempted || this.htmlDiscovered$() || runtime.abortController.signal.aborted) return
      const appId = this.appId$()
      const canonicalAppId = getCanonicalAppId(appId)
      const logPrefix = getAppIconLogPrefix(canonicalAppId)
      let online = false
      try {
        online = await connectivityRetry.confirmOnline()
      } catch (_) {}
      if (!online) {
        await this.waitForOnline(appId)
        if (!runtime.abortController.signal.aborted) return this.discoverFallbacks()
        return
      }

      this.discoveryAttempted = true
      this.isDiscovering$(true)
      runtime.discoveryController?.abort()
      const discoveryController = new AbortController()
      runtime.discoveryController = discoveryController
      let rejectLifecycleAbort
      const lifecycleAbort = new Promise((_resolve, reject) => {
        rejectLifecycleAbort = reject
      })
      const abortDiscovery = () => {
        discoveryController.abort()
        rejectLifecycleAbort(componentAbortError())
      }
      runtime.abortController.signal.addEventListener('abort', abortDiscovery, { once: true })
      let terminalTimer
      let terminalTimedOut = false
      try {
        const discovery = connectivityRetry.run(
          signal => discoverHtmlIconFallbacks(appId, this.cachedIcon$(), {
            signal
          }),
          {
            signal: discoveryController.signal,
            timeoutMs: HTML_DISCOVERY_TIMEOUT_MS,
            logPrefix
          }
        )
        // Promise.race consumes late rejections, so report non-abort failures explicitly.
        discovery.catch(error => {
          if (terminalTimedOut && error?.name !== 'AbortError') {
            console.error(`${logPrefix} App icon discovery failed after its terminal timeout:`, error)
          }
        })
        const terminalDeadline = new Promise((_resolve, reject) => {
          terminalTimer = setTimeout(() => {
            terminalTimedOut = true
            const error = discoveryTimeoutError(canonicalAppId)
            reject(error)
            discoveryController.abort()
          }, HTML_DISCOVERY_TERMINAL_TIMEOUT_MS)
        })
        const icon = await Promise.race([discovery, terminalDeadline, lifecycleAbort])
        if (!runtime.abortController.signal.aborted) {
          if (!icon.htmlDiscovered) {
            const online = await connectivityRetry.confirmOnline({ force: true })
            if (!online) {
              this.discoveryAttempted = false
              this.isDiscovering$(false)
              await this.waitForOnline(appId)
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
          console.error(`${logPrefix} Failed to discover app icon fallbacks:`, error)
          this.exhausted$(true)
        }
      } finally {
        if (terminalTimer != null) clearTimeout(terminalTimer)
        runtime.abortController.signal.removeEventListener('abort', abortDiscovery)
        if (runtime.discoveryController === discoveryController) {
          runtime.discoveryController = null
        }
        if (!runtime.abortController.signal.aborted) this.isDiscovering$(false)
      }
    },
    async rejectCandidate (image, candidate, renderedIndex, { requireImageMatch = true } = {}) {
      if (renderedIndex !== this.iconIndex$()) return
      if (!candidate || this.currentIcon$()?.url !== candidate.url) return
      if (requireImageMatch && !imageMatchesCandidate(image, candidate)) return

      if (!isDataAppIconUrl(candidate.url)) {
        let online = false
        try { online = await connectivityRetry.confirmOnline({ force: true }) } catch (_) {}
        if (!online) return this.retryCurrentWhenOnline()
      }

      if (renderedIndex !== this.iconIndex$() || this.currentIcon$()?.url !== candidate.url) return

      runtime.rejectedUrls.add(candidate.url)
      if (runtime.upgradeCandidateUrl === candidate.url && this.displayedIcon$()) {
        const equivalentIndex = getEquivalentAppIconCandidateIndex(
          this.iconCandidates$(),
          candidate,
          runtime.rejectedUrls
        )
        if (equivalentIndex >= 0) {
          runtime.upgradeCandidateUrl = this.iconCandidates$()[equivalentIndex].url
          this.iconIndex$(equivalentIndex)
          return
        }
        runtime.upgradeCandidateUrl = null
        // Keep the already rendered layer visible; no second upgrade is attempted.
        this.iconIndex$(this.iconCandidates$().length)
        return
      }
      const nextIndex = this.iconCandidates$().findIndex((next, index) =>
        index > renderedIndex && !runtime.rejectedUrls.has(next.url)
      )
      if (nextIndex >= 0) {
        this.iconIndex$(nextIndex)
        return
      }
      if (!this.htmlDiscovered$()) await this.discoverFallbacks()
      else this.exhausted$(true)
    },
    async showNextIcon (event) {
      this.finishRetry()
      this.clearCandidateTimeout()
      const renderedIndex = Number(event.currentTarget.dataset.iconIndex)
      const candidate = this.currentIcon$()
      await this.rejectCandidate(event.currentTarget, candidate, renderedIndex)
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

  // Reused keyed images may already be complete and therefore emit no new event.
  useTask(({ track, cleanup }) => {
    const [icon, renderedIndex] = track(() => [store.currentIcon$(), store.iconIndex$()])
    store.clearCandidateTimeout()
    cleanup(store.clearCandidateTimeout)
    const image = runtime.imageElement
    if (!icon || !image || !image.isConnected) return
    if (!image.complete || !imageMatchesCandidate(image, icon)) {
      store.startCandidateTimeout(image, icon, renderedIndex)
      return
    }
    if (image.naturalWidth > 0) store.markIconLoaded({ currentTarget: image })
    else store.showNextIcon({ currentTarget: image })
  }, { after: 'rendering' })

  useTask(({ cleanup }) => {
    cleanup(() => {
      store.finishRetry()
      store.clearCandidateTimeout()
      runtime.discoveryController?.abort()
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
