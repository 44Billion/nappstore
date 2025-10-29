import { f, useStore } from '#f'
import '#shared/svg.js'

f('iconLock', function () {
  // https://pictogrammers.com/library/mdi/icon/identifier
  const store = useStore({
    path$: [
      'M10 7V9H9V15H10V17H6V15H7V9H6V7H10M16 7C17.11 7 18 7.9 18 9V15C18 16.11 17.11 17 16 17H12V7M16 9H14V15H16V9Z'
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
