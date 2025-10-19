import { useGlobalStore, useClosestStore, useTask } from '#f'

export function useLocationInit (router) {
  const {
    onPopState,
    ...globalLoc
  // initialized only once, no matter how many times useLocation() is called
  } = useGlobalStore('_f_useLocation', () => {
    function getRoute ({ shouldUpdateUrl = true, isInit = false }) {
      let url, path
      if (shouldUpdateUrl) {
        url = new URL(window.location)
        path = url.pathname.replace(/(?<!^)\/+$/, '')
      } else {
        ({ url, path } = this.route$())
      }
      const currentUid = history.state?._f_useLocation_uid ??
        (isInit ? 0 : this.uidCounter$())
      const state = history.state
        ? ('_f_useLocation_uid' in history.state
            ? history.state
            : { ...history.state, _f_useLocation_uid: currentUid })
        : { previousRoute: null, _f_useLocation_uid: currentUid }
      return {
        uid: currentUid,
        url,
        path,
        state
      }
    }
    return {
      uidCounter$: history.state?._f_useLocation_uid /* on reload */ ?? 0,
      getRoute,
      // can't be separate signals, or else some may get stale
      // when tracked on a useTask when updating url$, path$, state$, currentUid$...
      // on specific order
      route$: getRoute({ shouldUpdateUrl: true, isInit: true }),
      replaceState (...args) {
        const currentState = history.state || {}
        const uid = currentState._f_useLocation_uid ?? this.uidCounter$()
        const newState = { ...args[0], _f_useLocation_uid: uid }
        history.replaceState(newState, ...args.slice(1))
        const shouldUpdateUrl = args[2] && location.href !== this.route$().url.href
        this.route$(this.getRoute({ shouldUpdateUrl }))
      },
      pushState (...args) {
        const nextUrl = new URL(args[2], window.location.origin)
        if (!args[2] || nextUrl.href === this.route$().url.href) {
          console.warn('Use replaceState when keeping url')
          return this.replaceState(...args)
        }
        this.uidCounter$(v => v + 1)
        const newState = { ...args[0], _f_useLocation_uid: this.uidCounter$() }
        history.pushState(newState, ...args.slice(1))
        this.route$(this.getRoute({ shouldUpdateUrl: true }))
      },
      back () {
        const currentState = history.state || {}
        const currentUid = currentState._f_useLocation_uid || 0
        if (currentUid <= 1) return
        history.back()
      },
      forward () { history.forward() },
      go (delta) {
        const currentState = history.state || {}
        const currentUid = currentState._f_useLocation_uid || 0

        if (delta < 0) {
          const minDelta = Math.max(delta, -(currentUid - 1))
          if (minDelta === 0) return
          history.go(minDelta)
        } else {
          history.go(delta)
        }
      },
      onPopState () { this.route$(this.getRoute({ shouldUpdateUrl: true })) }
    }
  })
  const closestLoc = useClosestStore('_f_useLocation', () => ({
    ...globalLoc,
    // Note these computed property would be stale for a moment
    // if you're tracking one or the other or this.route$ on a useTask
    // that's why we won't add them
    // routerMatch$ () { return router.find(this.path$()) },
    // params$ () { return this.routerMatch$().params ?? {} },
    // Handler and params
    getRouterMatch (path = this.route$().path) { return router.find(path) },
    getParams (path) { return this.getRouterMatch(path).params ?? {} }
  }))
  useNavigateInit(onPopState)
  return closestLoc
}

export default function useLocation (router) {
  if (router) return useLocationInit(router)
  return useClosestStore('_f_useLocation')
}

function useNavigateInit (onPopState) {
  useTask(({ cleanup }) => {
    const controller = new AbortController()
    cleanup(() => controller.abort())
    // triggered on
    // - browser back/forward button
    // - history.back/forward/go()
    // - on page load (Chrome and Safari), but this listener wouldn't be ready yet
    window.addEventListener('popstate', onPopState, { signal: controller.signal })
  })
}
