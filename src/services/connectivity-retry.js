import { isOnline, onOnline } from 'libp2r2p/network'

const RETRY_DELAYS = [5000, 15000, 30000, 60000]

function abortError () {
  const error = new Error('Connectivity wait aborted')
  error.name = 'AbortError'
  return error
}

function timeoutError (timeoutMs) {
  const error = new Error(`Task timed out after ${timeoutMs}ms`)
  error.name = 'TimeoutError'
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
    // Browser timer functions require the global object as their receiver.
    this._setTimeout = (...args) => Reflect.apply(_setTimeout, globalThis, args)
    this._clearTimeout = (...args) => Reflect.apply(_clearTimeout, globalThis, args)
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
  run (task, { signal, timeoutMs, logPrefix } = {}) {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      this.queue.push({ task, signal, resolve, reject, timeoutMs, logPrefix })
      this.#drainQueue()
    })
  }

  async runWhenOnline (task, { signal, logPrefix } = {}) {
    await this.waitUntilOnline({ signal })
    return this.run(task, { signal, logPrefix })
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
      let taskController = null
      let abortTask = null
      let timedOut = false
      let timer = null
      let released = false
      const release = () => {
        if (released) return
        released = true
        try {
          if (timer != null) this._clearTimeout(timer)
        } catch (error) {
          console.error(`${item.logPrefix ? `${item.logPrefix} ` : ''}Failed to clear connectivity retry timer:`, error)
        }
        try {
          item.signal?.removeEventListener('abort', abortTask)
        } catch (error) {
          console.error(`${item.logPrefix ? `${item.logPrefix} ` : ''}Failed to remove connectivity retry listener:`, error)
        } finally {
          this.running--
          this.#drainQueue()
        }
      }

      try {
        taskController = new AbortController()
        abortTask = () => taskController.abort()
        item.signal?.addEventListener('abort', abortTask, { once: true })
        if (item.timeoutMs != null && item.timeoutMs > 0) {
          timer = this._setTimeout(() => {
            // Release the shared slot even if a browser request ignores abort.
            timedOut = true
            taskController.abort()
            item.reject(timeoutError(item.timeoutMs))
            release()
          }, item.timeoutMs)
        }
      } catch (error) {
        taskController?.abort()
        item.reject(error)
        release()
        continue
      }

      Promise.resolve()
        .then(() => {
          if (!timedOut) return item.task(taskController.signal)
        })
        .then(item.resolve, item.reject)
        .finally(release)
    }
  }
}

export default new ConnectivityRetryCoordinator()
