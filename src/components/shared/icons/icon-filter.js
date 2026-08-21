import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-filter', function () {
  // https://tabler.io/icons/icon/filter
  const store = useStore({
    path$: [
      'M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227'
    ],
    viewBox$: '2 2 20 20'
  })

  return this.h`<f-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
