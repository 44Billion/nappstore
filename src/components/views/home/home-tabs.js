import { f, useStore } from '#f'
import { useLocation } from '#hooks/use-location.js'

f(function homeTabs () {
  const loc = useLocation()
  const {
    onHomeClick,
    onUploadClick
  } = useStore(() => ({
    onHomeClick (e) {
      e.preventDefault()
      loc.pushState(null, '', '/')
    },
    onUploadClick (e) {
      e.preventDefault()
      loc.pushState(null, '', '/upload')
    }
  }))

  return this.h`<div>
    <a href='/' onclick=${onHomeClick}>Index</a> | <a href='/upload' onclic=${onUploadClick}>Upload</a>
  </div>`
})
