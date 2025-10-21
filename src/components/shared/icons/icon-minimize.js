import { f, useStore } from '#f'
import '#shared/svg.js'

f(function iconMinimize () {
  // https://tabler.io/icons/icon/minimize
  const store = useStore({
    path$: [
      'M15 19v-2a2 2 0 0 1 2 -2h2',
      'M15 5v2a2 2 0 0 0 2 2h2',
      'M5 15h2a2 2 0 0 1 2 2v2',
      'M5 9h2a2 2 0 0 0 2 -2v-2'
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
