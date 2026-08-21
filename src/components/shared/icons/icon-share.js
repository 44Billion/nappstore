import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-share', function () {
  // https://tabler.io/icons/icon/share
  const store = useStore({
    path$: [
      'M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
      'M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
      'M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
      'M8.7 10.7l6.6 -3.4',
      'M8.7 13.3l6.6 3.4'
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
