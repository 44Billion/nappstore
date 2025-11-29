import { Relay } from '#helpers/nostr/relay.js'
import { maybeUnref } from '#helpers/timer.js'

export const seedRelays = [
  'wss://purplepag.es',
  'wss://user.kindpag.es',
  'wss://relay.nos.social',
  'wss://relay.nostr.band',
  'wss://nostr.land',
  'wss://indexer.coracle.social'
]
export const freeRelays = [
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band'
]

// Interacts with Nostr relays.
export class NostrRelays {
  #relays = new Map()
  #relayTimeouts = new Map()
  #timeout = 30000 // 30 seconds

  // Get a relay connection, creating one if it doesn't exist.
  async #getRelay (url) {
    if (this.#relays.has(url)) {
      clearTimeout(this.#relayTimeouts.get(url))
      this.#relayTimeouts.set(url, maybeUnref(setTimeout(() => this.disconnect(url), this.#timeout)))
      const relay = this.#relays.get(url)
      // Reconnect if needed to avoid SendingOnClosedConnection errors
      await relay.connect()
      return relay
    }

    const relay = new Relay(url)
    this.#relays.set(url, relay)

    await relay.connect()

    this.#relayTimeouts.set(url, maybeUnref(setTimeout(() => this.disconnect(url), this.#timeout)))

    return relay
  }

  // Disconnect from a relay.
  async disconnect (url) {
    if (this.#relays.has(url)) {
      const relay = this.#relays.get(url)
      if (relay.ws.readyState < 2) await relay.close()?.catch(console.log)
      this.#relays.delete(url)
      clearTimeout(this.#relayTimeouts.get(url))
      this.#relayTimeouts.delete(url)
    }
  }

  // Disconnect from all relays.
  async disconnectAll () {
    for (const url of this.#relays.keys()) {
      await this.disconnect(url)
    }
  }

  // Get events from a list of relays
  async getEvents (filter, relays, timeout = 5000) {
    const events = []
    const promises = relays.map(async (url) => {
      let sub
      let isClosed = false
      const p = Promise.withResolvers()
      const timer = maybeUnref(setTimeout(() => {
        isClosed = true
        sub?.close()
        p.reject(new Error(`timeout: ${url}`))
      }, timeout))
      try {
        const relay = await this.#getRelay(url)
        sub = relay.subscribe([filter], {
          onevent: (event) => {
            events.push(event)
          },
          onclose: err => {
            clearTimeout(timer)
            if (isClosed) return
            // May have closed normally, without error
            err ? p.reject(err) : p.resolve()
          },
          oneose: () => {
            clearTimeout(timer)
            isClosed = true
            sub.close()
            p.resolve()
          }
        })
      } catch (err) {
        clearTimeout(timer)
        p.reject(err)
      }

      return p.promise
    })

    const results = await Promise.allSettled(promises)
    const rejectedResults = results.filter(v => v.status === 'rejected')

    return {
      result: events,
      errors: rejectedResults.map(v => ({ reason: v.reason, relay: relays[results.indexOf(v)] })),
      success: events.length > 0 || results.length !== rejectedResults.length
    }
  }

  // Send an event to a list of relays
  async sendEvent (event, relays, timeout = 3000) {
    const promises = relays.map(async (url) => {
      let timer
      const p = Promise.withResolvers()
      try {
        timer = maybeUnref(setTimeout(() => {
          p.reject(new Error(`timeout: ${url}`))
        }, timeout))

        const relay = await this.#getRelay(url)
        await relay.publish(event)
        p.resolve()
      } catch (err) {
        if (err.message?.startsWith('duplicate:')) return p.resolve()
        if (err.message?.startsWith('mute:')) {
          console.info(`${url} - ${err.message}`)
          return p.resolve()
        }
        p.reject(err)
      } finally {
        clearTimeout(timer)
      }
      return p.promise
    })

    const results = await Promise.allSettled(promises)
    const rejectedResults = results.filter(v => v.status === 'rejected')

    return {
      result: null,
      errors: rejectedResults.map(v => ({ reason: v.reason, relay: relays[results.indexOf(v)] })),
      success: results.length !== rejectedResults.length
    }
  }
}

// Share same connection.
// Connections aren't authenticated, thus no need to split by authed user.
export default new NostrRelays()
