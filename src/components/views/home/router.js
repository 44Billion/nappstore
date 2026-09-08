import { f, useLocation } from '#f'
import '#f/components/f-route.js'
import { router } from './routes.js'

// Mount the matched views through the History API location store.
f('home-router', ({ h }) => {
  useLocation(router)

  return h`
    <f-route props=${{ path: '/:naddr(naddr1.*)' }} />
    <f-route props=${{ path: '/(.*)' }} />
    <f-route props=${{ path: '/upload' }} />
  `
})
