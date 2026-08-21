import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appEncode } from 'libp2r2p/nip19'
import {
  getAppLauncherUrl,
  getAppLauncherUrlForApp,
  getLauncherOrigin,
  getStoreShareUrl
} from '#helpers/launcher-url.js'

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

  it('builds friendly app URLs when the author has a NIP-05', () => {
    const options = {
      locationLike: { hostname: '44billion.net', protocol: 'https:', port: '' },
      isProduction: true
    }
    assert.equal(
      getAppLauncherUrlForApp({
        dTag: 'app',
        pubkey: 'ab'.repeat(32),
        kind: 35128,
        nip05: 'fiatjaf.com'
      }, options),
      'https://44billion.net/+app@fiatjaf.com'
    )
  })

  it('falls back to the NIP-19 entity URL without a usable NIP-05', () => {
    const options = {
      locationLike: { hostname: '44billion.net', protocol: 'https:', port: '' },
      isProduction: true
    }
    const app = { dTag: 'app', pubkey: 'ab'.repeat(32), kind: 35128 }
    assert.equal(
      getAppLauncherUrlForApp({ ...app, nip05: null }, options),
      getAppLauncherUrl(appEncode({ ...app, relays: [] }), options)
    )
  })

  it('builds store share URLs from filters', () => {
    const options = {
      locationLike: { hostname: '44billion.net', protocol: 'https:', port: '' },
      isProduction: true
    }
    assert.equal(
      getStoreShareUrl({
        by: ['fiatjaf.com'],
        as: ['publisher'],
        is: ['starred'],
        no: ['as'],
        at: ['wss://relay.example.com']
      }, options),
      'https://44billion.net/+apps?by=fiatjaf.com&as=publisher&is=starred&no=as&at=relay.example.com'
    )
  })
})
