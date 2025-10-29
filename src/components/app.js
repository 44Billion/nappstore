import resetCssString from '#assets/styles/reset.css'
import globalCssString from '#assets/styles/global.css'
import { f } from '#f'
import {
  cssStrings,
  cssClasses,
  cssVars
} from '#assets/styles/theme.js'
import '#components/router.js' // ensures <a-router> is defined
import '#shared/toast.js' // ensures <a-toast> is defined

document.head.insertAdjacentHTML('beforeend', `<style>${resetCssString}${globalCssString}</style>`)

if (IS_DEVELOPMENT) {
  new EventSource('/esbuild').addEventListener('change', () => location.reload())
}

f('aApp', function () {
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

          height: 100%;
          background-color: ${cssVars.colors.bg};
        }
      `}</style>
      <a-router />
      <a-toast />
    </div>
  `
})
