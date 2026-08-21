import Router from 'url-router'

export const router = new Router({
  '/upload': { path: '/upload', tag: 'napps-upload', loadModule: () => import('#views/napps/upload/index.js') },
  '/:naddr(naddr1.*)': { path: '/:naddr(naddr1.*)', tag: 'napps-curation-set', loadModule: () => import('#views/napps/curation-set/index.js') },
  '/(.*)': { path: '/(.*)', tag: 'napps-index', loadModule: () => import('#views/napps/index/index.js') }
})
