import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appEncode } from 'libp2r2p/nip19'
import { getCanonicalAppId, getAppIconLogPrefix } from '#helpers/app.js'

describe('app identity helpers', () => {
  it('removes relay hints from encoded app entities', () => {
    const ref = {
      dTag: 'example',
      pubkey: 'a'.repeat(64),
      kind: 35128
    }
    const canonical = appEncode(ref)
    const withRelays = appEncode({
      ...ref,
      relays: ['wss://relay.one', 'wss://relay.two']
    })

    assert.notEqual(withRelays, canonical)
    assert.equal(getCanonicalAppId(withRelays), canonical)
    assert.equal(getAppIconLogPrefix(withRelays), `[app-icon ${canonical}]`)
  })

  it('keeps invalid identifiers visible for diagnostics', () => {
    assert.equal(getCanonicalAppId('invalid-app'), 'invalid-app')
    assert.equal(getAppIconLogPrefix(null), '[app-icon unknown]')
  })
})
