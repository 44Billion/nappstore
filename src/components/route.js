import { f, useStore, useTask, useClosestStore } from '#f'
import useLocation from '#hooks/use-location.js'

// props: {
// shouldPreload($)=true|false,
// path($)='/some-path'|paths($)=['/some-path', ...]
// }
f('a-route', function () {
  const loc = useLocation()
  let {
    isLoaded$,
    isFirstRunSinceMatch, hasMatchedOnce$, shouldLoad$, routeTag$,
    distance$,
    paths$,
    shouldPreload$,
    maxVisibleDistance$, shouldUpdateUidWhenPathMatches$
  } = useStore(() => ({
    isLoaded$: false,
    isFirstRunSinceMatch: null,
    hasMatchedOnce$: false,
    shouldLoad$ () { return !this.isLoaded$() && this.hasMatchedOnce$() },
    routeTag$: null,
    distance$: null,
    paths$:
      this.props.paths$ ||
      (this.props.path$ && (() => [this.props.path$()])) ||
      this.props.paths ||
      [this.props.path],
    shouldPreload$: this.props.shouldPreload$ ?? this.props.shouldPreload ?? false,
    maxVisibleDistance$: this.props.maxVisibleDistance$ ??
      this.props.maxVisibleDistance ?? 0,
    // update uid, thus distance
    shouldUpdateUidWhenPathMatches$: this.props.shouldUpdateUidWhenPathMatches$ ??
      this.props.shouldUpdateUidWhenPathMatches ?? true
  }))

  // Pass props by both initializing this closest store and also inline at the loaded compoment
  const routeProps = useClosestStore('<a-route>', {
    route$: {
      uid: null,
      url: null,
      state: null,
      params: null
    }
  })

  // doesn't run until route matches for the first time (when hasMatchedOnce$ is set),
  // but on later path changes
  useTask(({ track }) => {
    let [hasMatchedOnce, locRoute, uidCounter] = track(() => [hasMatchedOnce$(), loc.route$(), shouldUpdateUidWhenPathMatches$(), loc.uidCounter$()])
    if (!hasMatchedOnce) return
    if (isFirstRunSinceMatch) {
      isFirstRunSinceMatch = false
      return
    }
    if (paths$().every(v => v !== locRoute.handler.path)) {
      const storedUid = routeProps.route$().uid
      const dist = Math.abs(storedUid - locRoute.uid)
      if (dist === 0 || storedUid > uidCounter) {
        routeProps.route$({ ...routeProps.route$(), uid: -Infinity })
        distance$(Infinity)
      } else {
        distance$(dist)
      }
      return
    }

    distance$(0)
    let _
    ({ handler: _, ...locRoute } = locRoute)
    routeProps.route$(locRoute)
  })

  // runs until route matches for the first time
  useTask(({ track }) => {
    let [isLoaded, shouldPreload, locRoute] = track(() => [isLoaded$(), shouldPreload$(), loc.route$()])
    if (
      isLoaded ||
      (
        !shouldPreload &&
        paths$().every(v => v !== locRoute.handler.path)
      )
    ) return

    // uid etc before hasMatchedOnce$, cause hasMatchedOnce$ updates shouldLoad$ that then loads the page
    // setting isLoaded$ to true
    distance$(0)
    let _
    ({ handler: _, ...locRoute } = locRoute)
    routeProps.route$(locRoute)
    isFirstRunSinceMatch = true
    hasMatchedOnce$(true)
  })

  useTask(async ({ track }) => {
    const [shouldLoad, isLoaded] = track(() => [shouldLoad$(), isLoaded$()])
    if (!shouldLoad || isLoaded) return

    const { handler: { loadModule, tag } } = loc.route$()
    await loadModule()
    routeTag$(tag)
    isLoaded$(true)
  })

  const { templateStrings$ } = useStore(() => ({
    // uhtml needs this to be frozen for template caching
    // i.e. return this.h([`<${routeTag$()} props=`, ' />'], routeProps)
    // would make rendered html to blink on each render
    stableArrayLiteral$: [],
    templateStrings$ () {
      this.stableArrayLiteral$().length = 0
      this.stableArrayLiteral$().push(
        `<${routeTag$()} props=`,
        ' />'
      )
      return this.stableArrayLiteral$()
    }
  }))

  if (
    !isLoaded$() ||
    (
      distance$() !== null &&
      distance$() > maxVisibleDistance$()
    )
  ) return

  return this.h(templateStrings$(), routeProps)
})
