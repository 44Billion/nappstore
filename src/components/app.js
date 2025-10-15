import resetCssString from '#assets/styles/reset.css'
import globalCssString from '#assets/styles/global.css'
import { f } from '#f'

document.head.insertAdjacentHTML('beforeend', `<style>${resetCssString}${globalCssString}</style>`)

if (window.IS_DEVELOPMENT) {
  new EventSource('/esbuild').addEventListener('change', () => location.reload())
}

f(function aApp () {
  return this.h`<a-router />`
})
