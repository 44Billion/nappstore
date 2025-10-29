import { f, useStore } from '#f'
import '#shared/svg.js'

f('iconExclamationMark', function () {
  // https://tabler.io/icons/icon/exclamation-mark
  const store = useStore({
    path$: [
      'M12 19v.01',
      'M12 15v-10'
    ],
    viewBox$: '2 2 20 20',
    weight$: 'bold'
  })

  return this.h`<a-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
