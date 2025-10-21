import { f, useStore } from '#f'
import '#shared/svg.js'

f(function iconInfoSmall () {
  // https://tabler.io/icons/icon/info-small
  const store = useStore({
    path$: [
      'M12 9h.01',
      'M11 12h1v4h1'
    ],
    viewBox$: '8 8 11 11'
  })

  return this.h`<a-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
