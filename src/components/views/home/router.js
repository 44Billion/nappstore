import Router from 'url-router'
import { f } from '#f'
import '#components/route.js'
import useLocation from '#hooks/use-location.js'

const router = new Router({
  '/upload': { path: '/upload', tag: 'napps-upload', loadModule: () => import('#views/napps/upload/index.js') },
  '/(.*)': { path: '/(.*)', tag: 'napps-index', loadModule: () => import('#views/napps/index/index.js') }
})

f('homeRouter', function () {
  useLocation(router)

  return this.h`
    <a-route props=${{ path: '/(.*)' }} />
    <a-route props=${{ path: '/upload' }} />
  `
})
