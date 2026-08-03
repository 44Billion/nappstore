import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getAppLauncherUrl, getLauncherOrigin } from '#helpers/launcher-url.js'

describe('launcher URLs', () => {
  it('uses the current local launcher even for a production app build', () => {
    const locationLike = {
      hostname: '7.localhost',
      protocol: 'http:',
      port: '10001'
    }
    assert.equal(
      getAppLauncherUrl('+encoded', { locationLike, isProduction: true }),
      'http://localhost:10001/+encoded'
    )
  })

  it('uses the production launcher outside local development', () => {
    assert.equal(getLauncherOrigin({
      hostname: '7.44billion.net',
      protocol: 'https:',
      port: ''
    }, { isProduction: true }), 'https://44billion.net')
  })

  it('keeps the development fallback when no local app host is available', () => {
    assert.equal(getLauncherOrigin(undefined, { isProduction: false }), 'http://localhost:10000')
  })
})
