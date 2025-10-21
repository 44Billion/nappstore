import { f, useStore } from '#f'
import '#shared/svg.js'

f(function iconRemove () {
  // https://tabler.io/icons/icon/square-rounded-x
  const store = useStore({
    path$: [
      'M10 10l4 4m0 -4l-4 4',
      'M12 3c7.2 0 9 1.8 9 9s-1.8 9 -9 9s-9 -1.8 -9 -9s1.8 -9 9 -9z'
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
