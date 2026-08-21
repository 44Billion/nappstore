import { f, useLocation } from '#f'
import '#components/route.js'
import { router } from './routes.js'

f('homeRouter', function () {
  useLocation(router)

  return this.h`
    <a-route props=${{ path: '/:naddr(naddr1.*)' }} />
    <a-route props=${{ path: '/(.*)' }} />
    <a-route props=${{ path: '/upload' }} />
  `
})
