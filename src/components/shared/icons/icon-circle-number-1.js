import { f, useStore } from '#f'
import '#shared/svg.js'

f('iconCircleNumber1', function () {
  // https://tabler.io/icons/icon/circle-number-1
  const store = useStore({
    path$: [
      'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
      'M10 10l2 -2v8'
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
