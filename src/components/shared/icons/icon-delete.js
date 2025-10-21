import { f, useStore } from '#f'
import '#shared/svg.js'

f(function iconDelete () {
  // https://tabler.io/icons/icon/trash
  const store = useStore({
    path$: [
      'M4 7l16 0',
      'M10 11l0 6',
      'M14 11l0 6',
      'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
      'M9 7l0 -3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1l0 3'
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
