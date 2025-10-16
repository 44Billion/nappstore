import resetCssString from '#assets/styles/reset.css'
import globalCssString from '#assets/styles/global.css'
import { f } from '#f'
import {
  cssStrings,
  cssClasses
} from '#assets/styles/theme.js'
import '#components/router.js' // ensures <a-router> is defined

document.head.insertAdjacentHTML('beforeend', `<style>${resetCssString}${globalCssString}</style>`)

if (window.IS_DEVELOPMENT) {
  new EventSource('/esbuild').addEventListener('change', () => location.reload())
}

f(function aApp () {
  return this.h`
    <div
      id='app'
      class=${{
        [cssClasses.defaultTheme]: true
      }}
    >
      <style>${/* css */`
        #app {
          &${cssStrings.defaultTheme}
        }
      `}</style>
      <a-router />
    </div>
  `
})
