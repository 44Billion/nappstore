import assert from 'node:assert/strict'
import { test } from 'node:test'
import { relayPool } from 'libp2r2p/relay'

import relays, { sendEventReport } from '#services/nostr-relays.js'

test('uses RelayPool with its 500 ms first-EOSE grace default', async t => {
  assert.equal(relays, relayPool)
  let options
  t.mock.method(relayPool, 'getEvents', async (_filter, _relays, nextOptions) => {
    options = nextOptions
    return { result: [], errors: [], success: true }
  })
  await relays.getEvents({ kinds: [35128] }, ['wss://relay.example'])
  assert.equal(options, undefined)
})

test('sendEventReport waits for terminal failures used by UI actions', async t => {
  let finish
  const promise = new Promise(resolve => { finish = resolve })
  t.mock.method(relayPool, 'sendEvent', async () => ({ success: true, promise }))
  const pending = sendEventReport({ id: 'event' }, ['wss://relay.example'])
  finish({ success: false, fulfilled: 0, errors: [{ relay: 'wss://relay.example' }] })
  const report = await pending
  assert.equal(report.success, false)
  assert.equal(report.errors.length, 1)
})
