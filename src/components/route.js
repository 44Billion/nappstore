import { f, useStore, useTask, useClosestStore } from '#f'
import useLocation from '#hooks/use-location.js'

f(function aRoute () {
  const location = useLocation()
  const { isLoaded$, shouldLoad$, route$ } = useStore(() => ({
    isLoaded$: false,
    route$: null,
    shouldLoad$ () { return !this.isLoaded$() && (this.route$() || (this.props.shouldPreload ?? false)) }
  }))
  // Pass props by both initializing this closest store and also inline at the loaded compoment
  const routeProps = useClosestStore('<a-route>', {
    url$: null,
    path$: null,
    state$: null,
    params$: null
  })

  useTask(({ track }) => {
    track(() => [isLoaded$(), location.path$()])
    if (isLoaded$() || location.path$() !== this.props.path) return

    route$(this.props.router ? location.getRoute(this.props.router) : location.route$())
    routeProps.url$(location.url$())
    routeProps.path$(location.path$())
    routeProps.state$(location.state$())
    routeProps.params$(location.params$())
  })

  useTask(async ({ track }) => {
    if (!track(() => shouldLoad$())) return

    await route$().loadModule()
    isLoaded$(true)
  })

  if (!isLoaded$()) return

  // dynamic tag doesn't work with uhtml: return this.h`<${tag} props=${{}} />`
  return this.h([`<${route$().tag} props=`, ' />'], routeProps)
})
