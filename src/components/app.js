import '#config/polyfills.js'
import resetCssString from '#assets/styles/reset.css'
import globalCssString from '#assets/styles/global.css'
import { f } from '#f'
import {
  cssClasses,
  cssStrings,
  cssVars
} from '#assets/styles/theme.js'
import '#components/router.js' // ensures <a-router> is defined
import '#shared/toast.js' // ensures <a-toast> is defined

document.documentElement.classList.add(cssClasses.defaultTheme)
document.head.insertAdjacentHTML('beforeend', `<style>${resetCssString}${globalCssString}${cssStrings.defaultTheme}</style>`)

if (IS_DEVELOPMENT) {
  new EventSource('/esbuild').addEventListener('change', () => location.reload())
}

f('aApp', function () {
  return this.h`
    <div
      id='app'
    >
      <style>${/* css */`
        #app {
          height: 100%;
          background-color: ${cssVars.colors.bg};
        }
      `}</style>
      <a-router />
      <a-toast />
    </div>
  `
})
