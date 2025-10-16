import Router from 'url-router'
import { f } from '#f'
import '#components/route.js'
import useLocation from '#hooks/use-location.js'

const router = new Router({
  '/(.*)': { tag: 'napps-index', loadModule: () => import('#views/napps/index/index.js') },
  '/upload': { tag: 'napps-upload', loadModule: () => import('#views/napps/upload/index.js') }
})

f(function homeRouter () {
  useLocation(router)

  return this.h`
    ${this.h({ key: '/' })`<a-route props=${{ debug: '[h]/', path: '/' }} />`}
    <a-route props=${{ debug: '[h]/upload', path: '/upload' }} />
  `
})
