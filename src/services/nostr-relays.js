import { relayPool } from 'libp2r2p/relay'

export const seedRelays = [
  'wss://relay.44billion.net',
  'wss://purplepag.es',
  'wss://user.kindpag.es',
  'wss://relay.nos.social',
  'wss://nostr.land',
  'wss://indexer.coracle.social'
]
export const freeRelays = [
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.damus.io'
]
export const nappRelays = ['wss://relay.44billion.net']

// UI actions need the final per-relay report, not only the first successful
// acknowledgement returned by RelayPool.sendEvent().
export async function sendEventReport (event, relays, options) {
  const result = await relayPool.sendEvent(event, relays, options)
  return await (result?.promise ?? result)
}

export default relayPool
