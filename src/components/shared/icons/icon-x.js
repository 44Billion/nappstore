import { f, useStore } from '#f'
import '#shared/svg.js'

f('iconX', function () {
  // https://tabler.io/icons/icon/x
  const store = useStore({
    path$: [
      'M18 6l-12 12',
      'M6 6l12 12'
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
