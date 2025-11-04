// Import specific features we want to polyfill
// import 'core-js/actual/promise/with-resolvers'
// Add more specific polyfills here as needed

// Or import everything from core-js/actual to polyfill all modern features
import 'core-js/actual'
// Promise.try is still a proposal so core-js does not include it by default
import 'core-js/proposals/promise-try'

if (typeof window !== 'undefined' && typeof window.requestIdleCallback !== 'function') {
  window.requestIdleCallback = function (callback, options) {
    const start = Date.now()
    const hasTimeout = options && typeof options.timeout === 'number'
    const timeoutDeadline = hasTimeout ? start + options.timeout : Infinity
    const frameDeadline = start + 50

    return setTimeout(() => {
      const now = Date.now()
      const didTimeout = now >= timeoutDeadline

      callback({
        didTimeout,
        timeRemaining: function () {
          if (didTimeout) return 0
          return Math.max(0, frameDeadline - Date.now())
        }
      })
    }, 1)
  }
}

if (typeof window !== 'undefined' && typeof window.cancelIdleCallback !== 'function') {
  window.cancelIdleCallback = function (handle) {
    clearTimeout(handle)
  }
}

if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  // Safari lacks async iteration support for ReadableStream
  ReadableStream.prototype[Symbol.asyncIterator] = function () {
    const reader = this.getReader()
    return {
      next () {
        return reader.read()
      },
      return () {
        reader.releaseLock()
        return Promise.resolve({ done: true })
      }
    }
  }
}
