import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-star', function () {
  // https://tabler.io/icons/icon/star
  const store = useStore({
    path$: [
      'M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245'
    ],
    viewBox$: '2 2 20 20',
    weight: 'regular'
  })

  return this.h`<f-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
