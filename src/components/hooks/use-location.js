import { useGlobalStore, useTask } from '#f'

export function useLocationInit (router) {
  const { onPopState } = useGlobalStore('_f_useLocation', () => ({
    url$: () => new URL(window.location),
    state$ () { return this.url$() && history.state },
    path$ () { return this.url$().pathname.replace(/(?<!^)\/+$/, '') },
    route$ () { return router?.find?.(this.path$()) },
    getRoute (r = router) { return r?.find?.(this.path$()) },
    params$ () { return this.route$()?.params ?? {} },
    uidCounter$: 0,
    replaceState (...args) {
      const currentState = history.state || {}
      const uid = currentState.uid || this.uidCounter$()
      const newState = { ...args[0], uid }
      history.replaceState(newState, ...args.slice(1))
      if (args[2] && location.href !== this.url$().href) this.url$(new URL(window.location))
    },
    pushState (...args) {
      if (!args[2] || location.href === this.url$().href) throw new Error('Use replaceState when keeping url')
      this.uidCounter$(v => v + 1)
      const newState = { ...args[0], uid: this.uidCounter$() }
      history.pushState(newState, ...args.slice(1))
      this.url$(new URL(window.location))
    },
    back () {
      const currentState = history.state || {}
      const currentUid = currentState.uid || 0
      if (currentUid <= 1) return
      history.back()
    },
    forward () { history.forward() },
    go (delta) {
      const currentState = history.state || {}
      const currentUid = currentState.uid || 0

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
  useNavigateInit(onPopState)
}

export default function useLocation (router) {
  if (router) useLocationInit(router)
  return useGlobalStore('_f_useLocation')
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
