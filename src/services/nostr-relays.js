import { relayPool } from 'libp2r2p/relay'
export { seedRelays, freeRelays } from 'libp2r2p/relay'

export const nappRelays = [
  'wss://relay.44billion.net',
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to'
]

// UI actions need the final per-relay report, not only the first successful
// acknowledgement returned by RelayPool.sendEvent().
export async function sendEventReport (event, relays, options) {
  const result = await relayPool.sendEvent(event, relays, options)
  return await (result?.promise ?? result)
}

export default relayPool
