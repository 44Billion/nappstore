import { f, useStore, useTask, useClosestStore } from '#f'
import useLocation from '#hooks/use-location.js'

// props: {
// shouldPreload($)=true|false,
// path($)='/some-path'|paths($)=['/some-path', ...]
// }
f(function aRoute () {
  const location = useLocation()
  const {
    isLoaded$, wasAlreadyLoaded$,
    route$, shouldLoad$,
    paths$,
    shouldPreload$,
    /* maxVisibleDistance$, */ shouldUpdateUidWhenPathMatches$
  } = useStore(() => ({
    isLoaded$: false,
    wasAlreadyLoaded$: false,
    route$: null,
    shouldLoad$ () { return !this.isLoaded$() && !!this.route$() },
    paths$:
      this.props.paths$ ||
      (this.props.path$ && (() => [this.props.path$()])) ||
      this.props.paths ||
      [this.props.path],
    shouldPreload$: this.props.shouldPreload$ ?? this.props.shouldPreload ?? false,
    maxVisibleDistance$: this.props.maxVisibleDistance$ ?? this.props.maxVisibleDistance ?? 0,
    shouldUpdateUidWhenPathMatches$: this.props.shouldUpdateUidWhenPathMatches$ ?? this.props.shouldUpdateUidWhenPathMatches ?? true
  }))

  // Pass props by both initializing this closest store and also inline at the loaded compoment
  const routeProps = useClosestStore('<a-route>', {
    uid$: null,
    url$: null,
    path$: null,
    state$: null,
    params$: null
  })

  useTask(({ track }) => {
    track(() => [isLoaded$(), shouldPreload$(), location.path$()])
    let matchedPath
    if (
      isLoaded$() ||
      (
        !shouldPreload$() &&
        !(matchedPath = paths$().find(v => v === location.path$()))
      )
    ) return

    const path = matchedPath ?? paths$()[0] // the latter if shouldPreload$=true
    // uidCounter$ before route$, cause route$ updates shouldLoad$ that then loads the page
    // setting isLoaded$ to true
    routeProps.uid$(location.uidCounter$())
    route$(location.getRoute(path))
    routeProps.params$(location.getParams(path))
    routeProps.state$(location.state$())
    routeProps.url$(location.url$())
  })

  useTask(({ track }) => {
    const [route, locationPath] = track(() => [route$(), location.path$(), shouldUpdateUidWhenPathMatches$()])
    if (!route) return
    let matchedPath
    if (!(matchedPath = paths$().find(v => v === locationPath))) return

    routeProps.path$(matchedPath)
  })

  useTask(async ({ track }) => {
    const [shouldLoad, isLoaded] = track(() => [shouldLoad$(), isLoaded$()])
    if (!shouldLoad || isLoaded) return

    await route$().handler.loadModule()
    isLoaded$(true)
  })

  useTask(async ({ track }) => {
    const [isLoaded, currentUid] = track(() => [
      isLoaded$(),
      location.currentUid$(),
      shouldUpdateUidWhenPathMatches$()
    ])

    if (!isLoaded) return
    if (!wasAlreadyLoaded$()) {
      wasAlreadyLoaded$(true)
      return
    }
    if (!shouldUpdateUidWhenPathMatches$() || routeProps.path$() !== location.path$()) return

    // to use with this check below: Math.abs(routeProps.uid$() - location.currentUid$()) > maxVisibleDistance$()
    routeProps.uid$(currentUid)
  })

  // TODO: fix this; if uncommenting, all routes blink when navigating
  // e.g. wasAlreadyLoaded$ gets reinitialized to false on navigation
  if (
    !isLoaded$() // ||
    // (
    //   routeProps.uid$() &&
    //   Math.abs(routeProps.uid$() - location.currentUid$()) > maxVisibleDistance$()
    // )
  ) return

  // dynamic tag doesn't work with uhtml: return this.h`<${tag} props=${{}} />`
  return this.h([`<${route$().handler.tag} props=`, ' />'], routeProps)
})
