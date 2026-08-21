import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { router } from '#views/home/routes.js'

describe('home router', () => {
  it('routes naddr paths to the curation set view', () => {
    const naddr = 'naddr1abc'
    const match = router.find(`/${naddr}`)
    assert.equal(match.handler.tag, 'napps-curation-set')
    assert.equal(match.params.naddr, naddr)
  })
})
