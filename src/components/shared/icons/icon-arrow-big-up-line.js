import { f, useStore } from '#f'
import '#shared/svg.js'

f(function iconArrowBigUpLine () {
  // https://tabler.io/icons/icon/arrow-big-up-line
  const store = useStore({
    path$: [
      'M9 12h-3.586a1 1 0 0 1 -.707 -1.707l6.586 -6.586a1 1 0 0 1 1.414 0l6.586 6.586a1 1 0 0 1 -.707 1.707h-3.586v6h-6v-6z',
      'M9 21h6'
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
