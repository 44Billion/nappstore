import { f } from '#f'
import '#views/home/tabs.js'
import '#views/home/router.js'

f(function aHome () {
  return this.h`<div>
    <h1>Nappstore</h1>
    <home-tabs />
    <home-router />
  </div>`
})
