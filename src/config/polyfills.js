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
