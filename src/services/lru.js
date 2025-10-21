import { maybeUnref } from '#helpers/timer.js'

let memo
async function defaultSetLocalStorageItem (...args) {
  memo ??= await (async () => {
    const { setLocalStorageItem } = await import('#components/hooks/use-web-storage.js')
    return (key, value) => {
      if (key.endsWith('$')) {
        throw new Error('Do not append "$" to the key when using setLocalStorageItem')
      }
      setLocalStorageItem(key, value)
    }
  })()
  return memo(...args)
}

// Time unit constants for duration parsing
const TIME_UNITS = {
  ms: 1,
  second: 1000,
  minute: 60000,
  hour: 3600000,
  day: 3600000 * 24,
  week: 3600000 * 24 * 7,
  month: 3600000 * 24 * 30,
  year: 3600000 * 24 * 365
}

// Parse duration string or number to milliseconds
function parseDuration (duration) {
  if (typeof duration === 'number') return duration

  if (typeof duration === 'string') {
    const split = duration.match(/^([\d.,]+)\s?(\w+)$/)

    if (split && split.length === 3) {
      const len = parseFloat(split[1])
      let unit = split[2].replace(/s$/i, '').toLowerCase()
      if (unit === 'm') {
        unit = 'ms'
      }

      return (len || 1) * (TIME_UNITS[unit] || 0)
    }
  }

  return undefined
}

// Store for namespace instances
const namespaceInstances = new Map()

// Create a new LRU cache instance for a specific namespace
function createLRUInstance (namespace = '', options = {}) {
  const setLocalStorageItem = options.setLocalStorageItem || defaultSetLocalStorageItem
  const enableAutoCleanup = options.enableAutoCleanup !== false // Default to true
  // Normalize namespace (empty string, null, undefined all become empty string)
  namespace = namespace || ''

  // Check if we already have an instance for this namespace
  if (namespaceInstances.has(namespace)) {
    const instance = namespaceInstances.get(namespace)

    // Update options if provided
    if (options.maxItems !== undefined) {
      instance.maxKeys = options.maxItems
    }

    if (options.expiration !== undefined) {
      // Parse the expiration if it's a string
      if (typeof options.expiration === 'string') {
        const duration = parseDuration(options.expiration)
        if (duration !== undefined) {
          instance.defaultDuration = duration
        }
      } else if (typeof options.expiration === 'number') {
        // If it's a timestamp, convert to duration relative to now
        instance.defaultDuration = options.expiration - Date.now()
      }
    }

    return instance
  }

  // Create prefixes for this namespace
  const itemPrefix = namespace ? `_44bLru_${namespace}_item_` : '_44bLru_item_'
  const mruKeysKey = namespace ? `_44bLru_${namespace}_mruKeys` : '_44bLru_mruKeys'
  const expirationPrefix = '_44bLru_exp_' // Global expiration prefix

  // Configuration
  let maxKeys = options.maxItems || 300
  let defaultDuration = null

  // Parse default duration if provided
  if (options.expiration !== undefined) {
    if (typeof options.expiration === 'string') {
      const duration = parseDuration(options.expiration)
      if (duration !== undefined) {
        defaultDuration = duration
      }
    } else if (typeof options.expiration === 'number') {
      // If it's a timestamp, convert to duration relative to now
      defaultDuration = options.expiration - Date.now()
    }
  }

  // In-memory list of most recently used keys (without prefix)
  let mruKeys = []

  // Initialize the MRU keys list from localStorage
  try {
    const storedKeys = localStorage.getItem(mruKeysKey)
    if (storedKeys) {
      mruKeys = JSON.parse(storedKeys)
    }
  } catch (err) {
    console.error(`Failed to parse MRU keys for namespace ${namespace}:`, err)
  }

  // Function to persist MRU keys to localStorage
  let persistTimeout
  function persistMruKeys () {
    clearTimeout(persistTimeout)
    persistTimeout = maybeUnref(setTimeout(() => {
      try {
        setLocalStorageItem(mruKeysKey, mruKeys)
      } catch (err) {
        console.error(`Failed to persist MRU keys for namespace ${namespace}:`, err)
      }
    }, 1000))
  }

  // Function to update MRU keys list efficiently
  function updateMruKeys (key) {
    // Remove key if it already exists
    const index = mruKeys.indexOf(key)
    if (index !== -1) {
      mruKeys.splice(index, 1)
    }

    // Add key to the beginning (most recently used)
    mruKeys.unshift(key)

    // Limit to maxKeys
    if (mruKeys.length > maxKeys) {
      // Get the keys to evict (the ones at the end)
      const keysToEvict = mruKeys.slice(maxKeys)

      // Remove evicted items from localStorage immediately
      for (const evictedKey of keysToEvict) {
        localStorage.removeItem(itemPrefix + evictedKey)
        const namespacedKey = namespace ? `${namespace}${evictedKey}` : evictedKey
        localStorage.removeItem(expirationPrefix + namespacedKey)
      }

      // Trim the MRU keys list
      mruKeys = mruKeys.slice(0, maxKeys)
    }

    // Schedule persisting
    persistMruKeys()
  }

  // Function to check if a value is expired
  function isExpired (key) {
    try {
      const namespacedKey = namespace ? `${namespace}${key}` : key
      const expiration = localStorage.getItem(expirationPrefix + namespacedKey)
      if (expiration === null) return false

      const expirationTime = JSON.parse(expiration)
      return expirationTime <= Date.now()
    } catch (err) {
      console.error(`Failed to check expiration for key ${key}:`, err)
      return false
    }
  }

  // Function to remove an expired item
  function removeIfExpired (key) {
    if (isExpired(key)) {
      const namespacedKey = namespace ? `${namespace}${key}` : key
      localStorage.removeItem(itemPrefix + key)
      localStorage.removeItem(expirationPrefix + namespacedKey)

      // Remove from MRU keys if present
      const index = mruKeys.indexOf(key)
      if (index !== -1) {
        mruKeys.splice(index, 1)
        persistMruKeys()
      }

      return true
    }
    return false
  }

  // Function to prune old items from localStorage
  let pruneTimeout
  let isPruning = false
  function pruneOldItems () {
    // If already pruning, just reschedule
    if (isPruning) {
      clearTimeout(pruneTimeout)
      pruneTimeout = maybeUnref(setTimeout(pruneOldItems, 2000))
      return
    }

    clearTimeout(pruneTimeout)
    pruneTimeout = maybeUnref(setTimeout(async () => {
      isPruning = true
      try {
        const currentKeys = new Set(mruKeys)
        const storage = typeof window !== 'undefined' ? window.localStorage : global.localStorage

        // Reverse iterate over localStorage keys in batches of 20
        for (let i = storage.length - 1; i >= 0; i--) {
          if ((i + 1) % 21 === 0) {
            await new Promise(resolve => {
              const requestCallback = typeof window !== 'undefined' ? window.requestIdleCallback : global.requestIdleCallback
              requestCallback(() => requestCallback(resolve))
            })
          }

          const key = storage.key(i)
          if (!key || !key.startsWith(itemPrefix)) continue

          // Extract the original key without prefix
          const originalKey = key.slice(itemPrefix.length)

          // If the key is not in our MRU list, delete it
          if (!currentKeys.has(originalKey)) {
            try {
              storage.removeItem(key)
            } catch (err) {
              console.error(`Failed to remove key ${key}:`, err)
            }
          }
        }
      } finally {
        isPruning = false
      }
    }, 2000))
  }

  // Create the instance object
  const instance = {
    // Get the namespace
    get namespace () {
      return namespace
    },

    // Get the max keys
    get maxKeys () {
      return maxKeys
    },

    // Set the max keys
    set maxKeys (value) {
      maxKeys = value || 300

      // Trim the MRU keys if needed
      if (mruKeys.length > maxKeys) {
        mruKeys = mruKeys.slice(0, maxKeys)
        persistMruKeys()
      }
    },

    // Get the default duration
    get defaultDuration () {
      return defaultDuration
    },

    // Set the default duration
    set defaultDuration (value) {
      if (typeof value === 'string') {
        const duration = parseDuration(value)
        if (duration !== undefined) {
          defaultDuration = duration
        }
      } else if (typeof value === 'number') {
        defaultDuration = value
      }
    },

    // Get an item from cache
    getItem (key, _getter = fullKey => localStorage.getItem(fullKey), _shouldJsonParse = true) {
      try {
        // Check if item is expired and remove if needed
        if (removeIfExpired(key)) {
          return undefined
        }

        const value = _getter(itemPrefix + key)
        if (value === null) return undefined

        // Update MRU list
        updateMruKeys(key)

        // Parse and return the value
        return _shouldJsonParse ? JSON.parse(value) : value
      } catch (err) {
        console.error(`Failed to get item ${key}:`, err)
        return undefined
      }
    },

    // Get from a signal-based storage like the one from useWebStorage(localStorage)
    getReactiveItem (key, storage) {
      if (!storage) throw new Error('Storage instance is required for getReactiveItem')
      if (key.endsWith('$')) throw new Error('Do not append "$" to the key when using getReactiveItem')
      return this.getItem(key, fullKey => storage[`${fullKey}${'$'}`](), false)
    },

    // Set an item in cache
    setItem (key, value, expiration) {
      try {
        // Update MRU list
        updateMruKeys(key)

        // Store the value
        setLocalStorageItem(itemPrefix + key, value)

        // Determine expiration time
        let expirationTime

        if (expiration !== undefined) {
          // Use provided expiration
          if (typeof expiration === 'string') {
            const duration = parseDuration(expiration)
            if (duration === undefined) {
              throw new Error(`Invalid expiration duration: "${expiration}". Use formats like "5 minutes", "1 hour", etc.`)
            } else {
              expirationTime = Date.now() + duration
            }
          } else {
            // Assume it's already a timestamp
            expirationTime = expiration
          }
        } else if (defaultDuration !== null) {
          // Use default duration if available
          expirationTime = Date.now() + defaultDuration
        }

        // Store expiration if determined
        if (expirationTime !== undefined) {
          const namespacedKey = namespace ? `${namespace}${key}` : key
          setLocalStorageItem(expirationPrefix + namespacedKey, expirationTime)
        }

        // Schedule pruning
        pruneOldItems()

        return value
      } catch (err) {
        console.error(`Failed to set item ${key}:`, err)
        return undefined
      }
    },

    // Remove an item from cache
    removeItem (key) {
      try {
        // Update MRU list
        updateMruKeys(key)

        // Delete the item by setting it to undefined
        setLocalStorageItem(itemPrefix + key, undefined)

        // Also remove expiration if it exists
        const namespacedKey = namespace ? `${namespace}${key}` : key
        setLocalStorageItem(expirationPrefix + namespacedKey, undefined)

        return true
      } catch (err) {
        console.error(`Failed to remove item ${key}:`, err)
        return false
      }
    },

    // Clear all items from cache
    clear () {
      try {
        // Remove all items with our prefix
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const key = window.localStorage.key(i)
          if (key && key.startsWith(itemPrefix)) {
            localStorage.removeItem(key)
          }
        }

        // Clear MRU keys
        mruKeys = []
        setLocalStorageItem(mruKeysKey, mruKeys)

        return true
      } catch (err) {
        console.error(`Failed to clear cache for namespace ${namespace}:`, err)
        return false
      }
    },

    // Get key by index
    key (index) {
      try {
        const keys = this.keys()
        return keys[index] || null
      } catch (err) {
        console.error(`Failed to get key at index ${index}:`, err)
        return null
      }
    },

    // Get all keys
    keys () {
      try {
        const keys = []
        const storage = typeof window !== 'undefined' ? window.localStorage : global.localStorage
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)
          if (key && key.startsWith(itemPrefix)) {
            keys.push(key.slice(itemPrefix.length))
          }
        }
        return keys
      } catch (err) {
        console.error(`Failed to get keys for namespace ${namespace}:`, err)
        return []
      }
    },

    // Get all values
    values () {
      try {
        const values = []
        for (const key of this.keys()) {
          const value = this.getItem(key)
          if (value !== undefined) {
            values.push(value)
          }
        }
        return values
      } catch (err) {
        console.error(`Failed to get values for namespace ${namespace}:`, err)
        return []
      }
    },

    // Get all entries
    entries () {
      try {
        const entries = []
        for (const key of this.keys()) {
          const value = this.getItem(key)
          if (value !== undefined) {
            entries.push([key, value])
          }
        }
        return entries
      } catch (err) {
        console.error(`Failed to get entries for namespace ${namespace}:`, err)
        return []
      }
    },

    // Get length property
    get length () {
      try {
        let count = 0
        const storage = typeof window !== 'undefined' ? window.localStorage : global.localStorage
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)
          if (key && key.startsWith(itemPrefix)) {
            count++
          }
        }
        return count
      } catch (err) {
        console.error(`Failed to get length for namespace ${namespace}:`, err)
        return 0
      }
    },

    // Iterator implementation
    [Symbol.iterator] () {
      const entries = this.entries()
      let index = 0

      return {
        next () {
          if (index < entries.length) {
            return { value: entries[index++], done: false }
          } else {
            return { done: true }
          }
        }
      }
    },

    // For...in iteration support
    forEach (callback, thisArg) {
      const entries = this.entries()
      for (const [key, value] of entries) {
        callback.call(thisArg, value, key, this)
      }
    },

    // Check if key exists
    has (key) {
      // Check if item is expired and remove if needed
      if (removeIfExpired(key)) {
        return false
      }

      return localStorage.getItem(itemPrefix + key) !== null
    },

    // Get expiration time for a key
    getExpiration (key) {
      try {
        const namespacedKey = namespace ? `${namespace}${key}` : key
        const expiration = localStorage.getItem(expirationPrefix + namespacedKey)
        if (expiration === null) return undefined

        return JSON.parse(expiration)
      } catch (err) {
        console.error(`Failed to get expiration for key ${key}:`, err)
        return undefined
      }
    },

    // Remove all expired keys
    async removeExpiredKeys () {
      try {
        const keysToRemove = []

        // First pass: identify expired keys
        const storage = typeof window !== 'undefined' ? window.localStorage : global.localStorage
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)
          if (key && key.startsWith(expirationPrefix)) {
            const originalKey = key.slice(expirationPrefix.length)

            // Check if this key belongs to our namespace
            if (namespace && !originalKey.startsWith(namespace)) {
              continue
            }

            // Remove namespace prefix from key
            const actualKey = namespace ? originalKey.slice(namespace.length) : originalKey

            try {
              const expiration = JSON.parse(storage.getItem(key))
              if (expiration <= Date.now()) {
                keysToRemove.push(actualKey)
              }
            } catch (_err) {
              // Invalid expiration, consider it expired
              keysToRemove.push(actualKey)
            }
          }
        }

        // Second pass: remove expired items in batches
        for (let i = 0; i < keysToRemove.length; i++) {
          const key = keysToRemove[i]

          // Remove the item and its expiration
          storage.removeItem(itemPrefix + key)
          const namespacedKey = namespace ? `${namespace}${key}` : key
          storage.removeItem(expirationPrefix + namespacedKey)

          // Remove from MRU keys if present
          const index = mruKeys.indexOf(key)
          if (index !== -1) {
            mruKeys.splice(index, 1)
          }

          // Yield control every 20 items
          if ((i + 1) % 20 === 0) {
            await new Promise(resolve => {
              const requestCallback = typeof window !== 'undefined' ? window.requestIdleCallback : global.requestIdleCallback
              requestCallback(() => requestCallback(resolve))
            })
          }
        }

        // Persist updated MRU keys if any were removed
        if (keysToRemove.length > 0) {
          persistMruKeys()
        }

        return keysToRemove.length
      } catch (err) {
        console.error(`Failed to remove expired keys for namespace ${namespace}:`, err)
        return 0
      }
    },

    // Convert duration string to milliseconds
    toMs (duration) {
      if (typeof duration === 'number') return duration

      if (typeof duration !== 'string') {
        throw new Error(`Invalid duration type: ${typeof duration}. Expected string or number.`)
      }

      const result = parseDuration(duration)

      if (result === undefined || result === 0) {
        throw new Error(`Unable to parse duration: "${duration}". Use formats like "5 minutes", "1 hour", etc.`)
      }

      return result
    },

    // Get a namespaced instance
    ns (newNamespace, options = {}) {
      return createLRUInstance(newNamespace, options)
    }
  }

  // Add support for Object.keys, Object.values, Object.entries
  Object.defineProperty(instance, 'toStringTag', {
    value: 'LRUCache',
    writable: false
  })

  // Store the instance
  namespaceInstances.set(namespace, instance)

  // Auto remove expired keys every 3 minutes (if enabled)
  if (enableAutoCleanup) {
    ;(function clearExpired () {
      maybeUnref(setTimeout(async () => {
        await instance.removeExpiredKeys()
        clearExpired()
      }, 1000 * 60 * 3))
    })()
  }

  return instance
}

// Create the default LRU instance
const lru = createLRUInstance('')

// Add support for Object.keys, Object.values, Object.entries
Object.defineProperty(lru, 'toStringTag', {
  value: 'LRUCache',
  writable: false
})

export default lru
