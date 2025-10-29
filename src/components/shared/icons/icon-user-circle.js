import { f, useStore } from '#f'
import '#shared/svg.js'

f('iconUserCircle', function () {
  // https://tabler.io/icons/icon/user-circle
  const store = useStore({
    path$: [
      'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
      'M12 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
      'M6.168 18.849a4 4 0 0 1 3.832 -2.849h4a4 4 0 0 1 3.834 2.855'
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
