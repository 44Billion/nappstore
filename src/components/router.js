import Router from 'url-router'
import { f } from '#f'
import useLocation from '#hooks/use-location.js'
import '#components/route.js'

export const router = new Router({
  // https://esbuild.github.io/api/#glob
  // note that esbuild does understand dynamic import paths if stating with ./ or ../
  // such as import('../views/${path}.js') but esbuild would include all possible
  // files there to the bundle
  '/(.*)': { tag: 'a-home', loadModule: () => import('#views/home/index.js') },
  // it makes the 'npub' param available as location.params$().npub
  '/:npub(npub1.*)': { tag: 'profiles-show', loadModule: () => import('#views/profiles/show/index.js') },
  '/some-example': { tag: 'some-example', loadModule: () => import('#views/some-example/index.js') }
})

f(function aRouter () {
  useLocation(router)

  return this.h`
    <a-route props=${{ path: '/', shouldPreload: true }} />
  `
})
