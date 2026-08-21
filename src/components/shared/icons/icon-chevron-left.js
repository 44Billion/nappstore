import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-chevron-left', function () {
  // https://tabler.io/icons/icon/chevron-left
  const store = useStore({
    path$: [
      'M15 6l-6 6l6 6'
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
