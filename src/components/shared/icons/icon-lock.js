import { f, useStore } from '#f'
import '#shared/svg.js'

f('iconLock', function () {
  // https://tabler.io/icons/icon/lock
  const store = useStore({
    path$: [
      'M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z',
      'M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0',
      'M8 11v-4a4 4 0 1 1 8 0v4'
    ],
    viewBox$: '2 2 20 20'
  })

  return this.h`<a-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
