import { Relay } from '#helpers/nostr/relay.js'
import { maybeUnref } from '#helpers/timer.js'

export const seedRelays = [
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
export const nappRelays = [
  'wss://relay.44billion.net'
]

// Interacts with Nostr relays
export class NostrRelays {
  #relays = new Map()
  #relayTimeouts = new Map()
  #timeout = 30000 // 30 seconds

  // Get a relay connection, creating one if it doesn't exist
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

  // Disconnect from a relay
  async disconnect (url) {
    if (this.#relays.has(url)) {
      const relay = this.#relays.get(url)
      if (relay.ws.readyState < 2) await relay.close()?.catch(console.log)
      this.#relays.delete(url)
      clearTimeout(this.#relayTimeouts.get(url))
      this.#relayTimeouts.delete(url)
    }
  }

  // Disconnect from all relays
  async disconnectAll () {
    for (const url of this.#relays.keys()) {
      await this.disconnect(url)
    }
  }

  // Get events from a list of relays
  async getEvents (filter, relays, { timeout = 5000, callback, signal } = {}) {
    const events = []
    const promises = relays.map(async (url) => {
      let sub
      let isClosed = false
      const p = Promise.withResolvers()

      // Handle abort signal
      if (signal?.aborted) return Promise.reject(new Error('Aborted'))
      const onAbort = () => {
        isClosed = true
        sub?.close()
        p.reject(new Error('Aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const timer = maybeUnref(setTimeout(() => {
        isClosed = true
        sub?.close()
        p.reject(new Error(`timeout: ${url}`))
      }, timeout))
      try {
        const relay = await this.#getRelay(url)
        if (isClosed || signal?.aborted) { // Double check in case of race
          clearTimeout(timer)
          return p.promise
        }

        sub = relay.subscribe([filter], {
          onevent: (event) => {
            event.meta = { relay: url }
            events.push(event)
            if (callback) callback({ type: 'event', event, relay: url })
          },
          onclose: err => {
            clearTimeout(timer)
            if (isClosed) return
            let reason
            if (err !== undefined) {
              reason = err instanceof Error ? err : new Error(String(err))
              if (callback) callback({ type: 'error', error: reason, relay: url })
            }
            // May have closed normally, without error
            reason ? p.reject(reason) : p.resolve()
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
        if (callback) callback({ type: 'error', error: err, relay: url })
        p.reject(err)
      }

      return p.promise.finally(() => {
        signal?.removeEventListener('abort', onAbort)
      })
    })

    const results = await Promise.allSettled(promises)
    const rejectedResults = results.filter(v => v.status === 'rejected')

    return {
      result: events,
      errors: rejectedResults.map(v => ({ reason: v.reason, relay: relays[results.indexOf(v)] })),
      success: events.length > 0 || results.length !== rejectedResults.length
    }
  }

  // First to reply with EOSE and events should trigger a short timeout for the rest
  async getEventsAsap (filter, relays, { timeout = 5000, timeoutAfterFirstEose = 500, callback, signal } = {}) {
    const subs = new Map()
    const errors = []
    const events = []
    let closedRelaySubs = 0
    let isResolved = false
    let eoseTimer = null
    const p = Promise.withResolvers()

    const finalize = () => {
      if (isResolved) return
      isResolved = true
      clearTimeout(timer)
      if (eoseTimer) clearTimeout(eoseTimer)
      signal?.removeEventListener('abort', onAbort)
      subs.forEach(sub => sub.close())
      p.resolve({
        result: events,
        errors,
        success: events.length > 0 || relays.length !== errors.length
      })
    }

    // Handle abort
    const onAbort = () => {
      if (isResolved) return
      isResolved = true
      clearTimeout(timer)
      if (eoseTimer) clearTimeout(eoseTimer)
      subs.forEach(sub => sub.close())
      p.reject(new Error('Aborted'))
    }

    if (signal?.aborted) return Promise.reject(new Error('Aborted'))
    signal?.addEventListener('abort', onAbort, { once: true })

    const timer = maybeUnref(setTimeout(() => {
      finalize()
    }, timeout))

    const markClosedAndMaybeFinish = () => {
      closedRelaySubs += 1
      if (!isResolved && closedRelaySubs >= relays.length) {
        finalize()
      }
    }

    for (const url of relays) {
      this.#getRelay(url).then(relay => {
        if (isResolved) return
        let hasEvents = false

        const sub = relay.subscribe([filter], {
          onevent: (event) => {
            if (isResolved) return
            hasEvents = true
            event.meta = { relay: url }
            events.push(event)
            if (callback) callback({ type: 'event', event, relay: url })
          },
          onclose: (err) => {
            subs.delete(url)
            if (err !== undefined) {
              const reason = err instanceof Error ? err : new Error(String(err))
              errors.push({ reason, relay: url })
              if (callback) callback({ type: 'error', error: reason, relay: url })
            }
            markClosedAndMaybeFinish()
          },
          oneose: () => {
            sub.close()
            if (hasEvents && !eoseTimer && !isResolved) {
              eoseTimer = maybeUnref(setTimeout(() => {
                finalize()
              }, timeoutAfterFirstEose))
            }
          }
        })
        subs.set(url, sub)
      }).catch(error => {
        errors.push({ reason: error, relay: url })
        if (callback) callback({ type: 'error', error, relay: url })
        console.error(`Nostr relay error at ${url}: ${error}`)
        markClosedAndMaybeFinish()
      })
    }

    return p.promise
  }

  async * getEventsGenerator (filter, relays, options = {}) {
    const queue = []
    let p = Promise.withResolvers()
    let isDone = false

    const userCallback = options.callback
    const callback = item => {
      queue.push(item)
      if (userCallback) userCallback(item)
      p.resolve()
      p = Promise.withResolvers()
    }

    const methodPromise = this.getEvents(filter, relays, { ...options, callback })
      .catch(err => { if (err?.message !== 'Aborted') console.error('Error in getEvents:', err) })
      .finally(() => {
        isDone = true
        p.resolve()
      })

    // eslint-disable-next-line no-unmodified-loop-condition
    while (!isDone || queue.length > 0) {
      if (queue.length > 0) yield queue.shift()
      else await p.promise
    }

    return await methodPromise
  }

  async * getEventsAsapGenerator (filter, relays, options = {}) {
    const queue = []
    let p = Promise.withResolvers()
    let isDone = false

    const userCallback = options.callback
    const callback = item => {
      queue.push(item)
      if (userCallback) userCallback(item)
      p.resolve()
      p = Promise.withResolvers()
    }

    const methodPromise = this.getEventsAsap(filter, relays, { ...options, callback })
      .catch(err => { if (err?.message !== 'Aborted') console.error('Error in getEventsAsap:', err) })
      .finally(() => {
        isDone = true
        p.resolve()
      })

    // eslint-disable-next-line no-unmodified-loop-condition
    while (!isDone || queue.length > 0) {
      if (queue.length > 0) yield queue.shift()
      else await p.promise
    }

    return await methodPromise
  }

  // Send an event to a list of relays
  async sendEvent (event, relays, timeout = 3000) {
    const eventToSend = event.meta ? { ...event } : event
    if (eventToSend.meta) delete eventToSend.meta

    const promises = relays.map(async (url) => {
      let timer
      const p = Promise.withResolvers()
      try {
        timer = maybeUnref(setTimeout(() => {
          p.reject(new Error(`timeout: ${url}`))
        }, timeout))

        const relay = await this.#getRelay(url)
        await relay.publish(eventToSend)
        p.resolve()
      } catch (err) {
        const reason = err instanceof Error ? err : new Error(String(err))
        if (reason.message.startsWith('duplicate:')) return p.resolve()
        if (reason.message.startsWith('mute:')) {
          console.info([url, reason.message].filter(Boolean).join(' - '))
          return p.resolve()
        }
        p.reject(reason)
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

// Share same connection
// Connections aren't authenticated, thus no need to split by authed user
export default new NostrRelays()
