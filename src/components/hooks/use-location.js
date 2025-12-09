import { useGlobalStore, useClosestStore, useTask } from '#f'

export function useLocationInit (router) {
  const {
    route$,
    onPopState,
    ...globalLoc
  // initialized only once, no matter how many times useLocation() is called
  } = useGlobalStore('_f_useLocation', () => {
    function getRoute ({ shouldUpdateUrl = true, isInit = false }) {
      let url
      if (shouldUpdateUrl) {
        const _url = new URL(window.location)
        // remove trailing /
        // updating pathname updates url.href too
        _url.pathname = _url.pathname.replace(/(?<!^)\/+$/, '')
        let k
        url = {}
        for (k in _url) url[k] = _url[k]
        // fix JSON.stringify issues with url when storing in f's hook state manager
        url.toString = () => url.href; delete url.toJSON
        url.searchParams = Object.fromEntries(_url.searchParams.entries())
      } else {
        ({ url } = this.route$())
      }
      const currentUid = history.state?._f_useLocation_uid ??
        (isInit ? 0 : (this?.uidCounter$() ?? 0))
      const state = history.state
        ? ('_f_useLocation_uid' in history.state
            ? history.state
            : { ...history.state, _f_useLocation_uid: currentUid })
        : { previousRoute: null, _f_useLocation_uid: currentUid }
      if (isInit && (!history.state || !('_f_useLocation_uid' in history.state))) {
        history.replaceState(state, '')
      }
      return {
        uid: currentUid,
        url,
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
        const currentUid = history.state?._f_useLocation_uid ?? 0
        const nextUid = currentUid + 1
        this.uidCounter$(nextUid)
        const newState = { ...args[0], _f_useLocation_uid: nextUid }
        history.pushState(newState, ...args.slice(1))
        this.route$(this.getRoute({ shouldUpdateUrl: true }))
      },
      back () {
        const currentState = history.state || {}
        const currentUid = currentState._f_useLocation_uid || 0
        if (currentUid <= 0) return
        history.back()
      },
      forward () { history.forward() },
      go (delta) {
        const currentState = history.state || {}
        const currentUid = currentState._f_useLocation_uid || 0

        if (delta < 0) {
          const minDelta = Math.max(delta, -currentUid)
          if (minDelta === 0) return
          history.go(minDelta)
        } else {
          history.go(delta)
        }
      },
      onPopState () {
        const route = this.getRoute({ shouldUpdateUrl: true })
        if (route.uid > this.uidCounter$()) this.uidCounter$(route.uid)
        this.route$(route)
      }
    }
  })
  const closestLoc = useClosestStore('_f_useLocation', () => ({
    ...globalLoc,
    route$ () {
      const route = route$()
      const { params, handler } = router.find(route.url.pathname) || {}
      // all these fields must change together to avoid
      // stale data if one were to track different fields separately
      return {
        ...route,
        params,
        handler
      }
    },
    // => null | { handler, params = {} }
    getRouterMatch (path = this.route$().url.pathname) { return router.find(path) }
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
