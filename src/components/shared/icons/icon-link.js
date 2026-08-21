import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-link', function () {
  // Exceção consciente: mantém o visual antigo de corrente (dois elos), que
  // é mais legível como "copiar link" do que o link do Tabler.
  const store = useStore({
    path$: [
      'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
      'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
    ],
    viewBox$: '0 0 24 24'
  })

  return this.h`<f-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
