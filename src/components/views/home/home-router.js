import Router from 'url-router'
import { f } from '#f'
import '#components/route.js'

const router = new Router({
  '/(.*)': { tag: 'napps-index', loadModule: () => import('#views/napps/index.js') },
  '/upload': { tag: 'napps-upload', loadModule: () => import('#views/napps/upload.js') }
})

f(function homeRouter () {
  return this.h`
    <a-route props=${{ path: '/', router }} />
    <a-route props=${{ path: '/upload', router }} />
  `
})
