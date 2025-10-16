import { useGlobalStore, useClosestStore, useTask } from '#f'

export function useLocationInit (router) {
  const {
    onPopState,
    ...globalLoc
  // initialized only once, no matter how many times useLocation() is called
  } = useGlobalStore('_f_useLocation', () => ({
    // Investigate why url$: new URL(window.location)
    // didn't work (f framework issue)
    // Although updating it with loc.url$(new URL(window.location)) works
    url$: (() => { const result = {}; const url = new URL(window.location); for (const k in new URL(window.location)) result[k] = url[k]; return result })(),
    // init state$ and currentUid$ before path$, so tasks that track
    // on path$ won't have those values stale
    state$ () { return this.url$() && history.state },
    currentUid$ () { return this.state$()?._f_useLocation_uid || 0 },
    path$ () { return this.url$().pathname.replace(/(?<!^)\/+$/, '') },
    uidCounter$: history.state?._f_useLocation_uid /* on reload */ ?? 0,
    replaceState (...args) {
      const currentState = history.state || {}
      const uid = currentState._f_useLocation_uid || this.uidCounter$()
      const newState = { ...args[0], _f_useLocation_uid: uid }
      history.replaceState(newState, ...args.slice(1))
      if (args[2] && location.href !== this.url$().href) this.url$(new URL(window.location))
    },
    pushState (...args) {
      const nextUrl = new URL(args[2], window.location.origin)
      if (!args[2] || nextUrl.href === this.url$().href) throw new Error('Use replaceState when keeping url')
      this.uidCounter$(v => v + 1)
      const newState = { ...args[0], _f_useLocation_uid: this.uidCounter$() }
      history.pushState(newState, ...args.slice(1))
      this.url$(nextUrl)
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
    onPopState () { this.url$(new URL(window.location)) }
  }))
  const closestLoc = useClosestStore('_f_useLocation', () => ({
    ...globalLoc,
    // Note these computed property would be stale for a moment
    // if you're tracking url$ or path$ on a useTask
    // that's why we won't add them
    // route$ () { return router.find(this.path$()) },
    // params$ () { return this.route$().params ?? {} },
    // Handler and params
    getRoute (path) { return router.find(path) },
    getParams (path) { return this.getRoute(path).params ?? {} }
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
