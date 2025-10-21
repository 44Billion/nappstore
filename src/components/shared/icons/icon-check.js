import { f, useStore } from '#f'
import '#shared/svg.js'

f(function iconCheck () {
  // https://tabler.io/icons/icon/check
  const store = useStore({
    path$: [
      'M5 12l5 5l10 -10'
    ],
    viewBox$: '2 2 20 20',
    weight$: 'regular'
  })

  return this.h`<a-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
