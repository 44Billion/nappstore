import { f, useStore, useTask, useClosestStore } from '#f'
import useLocation from '#hooks/use-location.js'
import '#views/home/tabs.js'

// props: {
// shouldPreload($)=true|false,
// path($)='/some-path'|paths($)=['/some-path', ...]
// }
f(function aRoute () {
  const loc = useLocation()
  const {
    isLoaded$,
    routerMatch$, shouldLoad$,
    paths$,
    shouldPreload$,
    maxVisibleDistance$, shouldUpdateUidWhenPathMatches$
  } = useStore(() => ({
    isLoaded$: false,
    routerMatch$: null,
    shouldLoad$ () { return !this.isLoaded$() && !!this.routerMatch$() },
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
    route$: {
      uid: null,
      url: null,
      path: null,
      params: null,
      state: null
    }
  })

  // doesn't run until route matches for the first time (when routerMatch$ is set),
  // but on later path changes
  useTask(({ track }) => {
    const [routerMatch, locationPath] = track(() => [routerMatch$(), loc.route$().path, shouldUpdateUidWhenPathMatches$()])
    if (!routerMatch) return
    let matchedPath
    if (!(matchedPath = paths$().find(v => v === locationPath))) return

    routeProps.route$({
      ...loc.route$(),
      // we don't want to update routerMatch$ on this useTask, just extract current params
      params: loc.getRouterMatch(matchedPath).params
    })
  })

  // runs until route matches for the first time
  useTask(({ track }) => {
    track(() => [isLoaded$(), shouldPreload$(), loc.route$().path])
    let matchedPath
    if (
      isLoaded$() ||
      (
        !shouldPreload$() &&
        !(matchedPath = paths$().find(v => v === loc.route$().path))
      )
    ) return

    const path = matchedPath ?? paths$()[0] // the latter if shouldPreload$=true
    const routerMatch = loc.getRouterMatch(path)
    // uid etc before routerMatch$, cause routerMatch$ updates shouldLoad$ that then loads the page
    // setting isLoaded$ to true
    routeProps.route$({
      ...loc.route$(),
      params: routerMatch.params
    })
    routerMatch$(routerMatch)
  })

  useTask(async ({ track }) => {
    const [shouldLoad, isLoaded] = track(() => [shouldLoad$(), isLoaded$()])
    if (!shouldLoad || isLoaded) return

    await routerMatch$().handler.loadModule()
    isLoaded$(true)
  })

  const { templateStrings$ } = useStore(() => ({
    // uhtml needs this to be frozen for template caching
    // i.e. return this.h([`<${routerMatch$().handler.tag} props=`, ' />'], routeProps)
    // would make rendered html to blink on each render
    stableArrayLiteral$: [],
    templateStrings$ () {
      this.stableArrayLiteral$().length = 0
      this.stableArrayLiteral$().push(
        `<${routerMatch$().handler.tag} props=`,
        ' />'
      )
      return this.stableArrayLiteral$()
    }
  }))

  if (
    !isLoaded$() ||
    (
      routeProps.route$().uid &&
      Math.abs(routeProps.route$().uid - loc.route$().uid) > maxVisibleDistance$()
    )
  ) return

  return this.h(templateStrings$(), routeProps)
})
