import { isOnline, onOnline } from 'libp2r2p/network'

const RETRY_DELAYS = [5000, 15000, 30000, 60000]

function abortError () {
  const error = new Error('Connectivity wait aborted')
  error.name = 'AbortError'
  return error
}

// Coordinates connectivity checks and resumed work across every mounted icon.
export class ConnectivityRetryCoordinator {
  constructor ({
    _isOnline = isOnline,
    _onOnline = onOnline,
    _setTimeout = setTimeout,
    _clearTimeout = clearTimeout,
    _random = Math.random,
    concurrency = 3
  } = {}) {
    this._isOnline = _isOnline
    this._onOnline = _onOnline
    this._setTimeout = _setTimeout
    this._clearTimeout = _clearTimeout
    this._random = _random
    this.concurrency = concurrency
  }

  waiters = new Set()
  queue = []
  running = 0
  retryIndex = 0
  timer = null
  removeOnlineListener = null
  connectivityCheck = null
  lastOnlineAt = 0

  // Shares one potentially expensive connectivity probe across all callers.
  async confirmOnline ({ force = false } = {}) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    if (!force && Date.now() - this.lastOnlineAt < 5000) return true
    if (!this.connectivityCheck) {
      this.connectivityCheck = Promise.resolve(this._isOnline())
        .then(online => {
          if (online) this.lastOnlineAt = Date.now()
          return online
        })
        .catch(() => false)
        .finally(() => { this.connectivityCheck = null })
    }
    return this.connectivityCheck
  }

  // Waits for a native online event or a successful shared backoff probe.
  waitUntilOnline ({ signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortError())

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: null }
      waiter.onAbort = () => {
        this.waiters.delete(waiter)
        reject(abortError())
        this.#stopIfIdle()
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.add(waiter)
      this.#startMonitor()
    })
  }

  // Runs resumed work with a global concurrency cap.
  run (task, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      this.queue.push({ task, signal, resolve, reject })
      this.#drainQueue()
    })
  }

  async runWhenOnline (task, { signal } = {}) {
    await this.waitUntilOnline({ signal })
    return this.run(task, { signal })
  }

  #startMonitor () {
    if (!this.removeOnlineListener) {
      this.removeOnlineListener = this._onOnline(() => this.#releaseWaiters())
    }
    if (!this.timer) this.#scheduleProbe()
  }

  #scheduleProbe () {
    const baseDelay = RETRY_DELAYS[Math.min(this.retryIndex, RETRY_DELAYS.length - 1)]
    this.retryIndex++
    const jitter = 0.8 + (this._random() * 0.4)
    this.timer = this._setTimeout(async () => {
      this.timer = null
      if (!this.waiters.size) return this.#stopIfIdle()
      if (await this.confirmOnline()) this.#releaseWaiters()
      else this.#scheduleProbe()
    }, Math.round(baseDelay * jitter))
  }

  #releaseWaiters () {
    const waiters = [...this.waiters]
    this.waiters.clear()
    for (const waiter of waiters) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.resolve()
    }
    this.#stopIfIdle()
  }

  #stopIfIdle () {
    if (this.waiters.size) return
    if (this.timer) this._clearTimeout(this.timer)
    this.timer = null
    this.retryIndex = 0
    this.removeOnlineListener?.()
    this.removeOnlineListener = null
  }

  #drainQueue () {
    while (this.running < this.concurrency && this.queue.length) {
      const item = this.queue.shift()
      if (item.signal?.aborted) {
        item.reject(abortError())
        continue
      }
      this.running++
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.running--
          this.#drainQueue()
        })
    }
  }
}

export default new ConnectivityRetryCoordinator()
