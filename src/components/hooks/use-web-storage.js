import { useStore, useMemo, useTask, useGlobalSignal, toSignal } from '#f'
import WeakValueMap from '#services/weak-value-map.js'

function isValidVariableName (str) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(str)
}

export function useLocalStorage (...args) {
  return useWebStorage(localStorage, ...args)
}

export function useSessionStorage (...args) {
  return useWebStorage(sessionStorage, ...args)
}

// A view on some fields. Can add field viewer at any time
export default function useWebStorage (storageArea = localStorage, getOrCreateObjOrFn, { shouldUseStrictKeys = false, shouldReplaceInvalidValues = false } = {}) {
  // maybe this would be enough: const store = useMemo(() => ({}), { shouldCache: false })
  const store = useStore({}, { shouldCache: false, isStatic: false })
  const signalProxyByKey = useMemo(() => ({}))
  const signalByKeyMap$ = useGlobalSignal(
    'useWebStorage_signalByKeyMap',
    () => new WeakValueMap(),
    { shouldCache: false }
  )

  const proxy = useMemo(() => {
    function getSignalHandler (signalKey) {
      return {
        get (target, key, receiver) {
          if (key !== 'set') return Reflect.get(target, key, receiver)

          return function (...args) {
            const ret = Reflect.get(target, key, receiver)(...args)
            if (ret === undefined) storageArea.removeItem(signalKey.slice(0, -1))
            else storageArea.setItem(signalKey.slice(0, -1), JSON.stringify(ret))
            return ret
          }
        },
        apply (target, thisArg, args) {
          if (!args.length) return Reflect.apply(target, thisArg, args)

          const ret = Reflect.apply(target, thisArg, args)
          if (ret === undefined) storageArea.removeItem(signalKey.slice(0, -1))
          else storageArea.setItem(signalKey.slice(0, -1), JSON.stringify(ret))
          return ret
        }
      }
    }
    const storeHandler = {
      set (target, key, value, receiver) {
        try {
          if (!key.endsWith('$')) throw new Error('(useWebStorage) Append a "$" to the original storage key')
          if (shouldUseStrictKeys && !isValidVariableName(key)) throw new Error('(useWebStorage) Key name failed /^[a-zA-Z_$][a-zA-Z0-9_$]*$/ test')
          let prevValue
          const storageKey = key.slice(0, -1)
          const hasProp = Object.prototype.hasOwnProperty.call(storageArea, storageKey)
          if (hasProp &&
            (() => {
              // if there's a valid value at the storageArea, don't replace it
              try { prevValue = JSON.parse(storageArea.getItem(storageKey)); return true } catch (err) {
                console.log(err)
                if (!shouldReplaceInvalidValues) throw new Error(`(useWebStorage) Can't JSON.parse value ${storageArea.getItem(storageKey)} stored at key ${key}`)
                else return false
              }
            })()
          ) {
            // won't let update it directly with storage.signal$ = ..., use storage.signal$(x)/storage.signal$.set(x)
            if (Object.prototype.hasOwnProperty.call(target, key)) return prevValue
            return Reflect.set(target, key,
              // avoid mem leak by not using regular stores's signal creation that would pass the store as its signal's this
              toSignal([function () { return prevValue }].map(v => (v.strategy = 'signal') && v)[0]), receiver)
          }

          if (typeof value === 'function') value = value()
          if (!Reflect.set(target, key, toSignal([function () { return value }].map(v => (v.strategy = 'signal') && v)[0]), receiver)) return false
          if (value === undefined) hasProp && storageArea.removeItem(storageKey)
          else storageArea.setItem(storageKey, JSON.stringify(value))
          return true
        } catch (err) {
          console.error(err)
          return false
        }
      },
      get (target, key, receiver) {
        if (!Object.prototype.hasOwnProperty.call(target, key)) {
          // setting it to undefined will just init the signal without adding the value to localStorage
          if (!Reflect.set(receiver, key, undefined, receiver)) return // return to prevent infinite loop
          return receiver[key] // re-trigger "get" trap
        }

        return (signalProxyByKey[key] ??=
          signalByKeyMap$().get(key) ??
          signalByKeyMap$().set(key, new Proxy(Reflect.get(target, key, receiver), getSignalHandler(key))).get(key)
        )
      }
    }
    return new Proxy(store, storeHandler)
  })

  useTask(() => {
    if (!getOrCreateObjOrFn) return

    Object.entries(typeof getOrCreateObjOrFn === 'function' ? getOrCreateObjOrFn() : getOrCreateObjOrFn)
      .forEach(([k, v]) => { proxy[k] = v })
  })

  useTask(({ cleanup }) => {
    let abortController
    function onStorage (e) {
      if (e.storageArea !== storageArea) return

      const { key: storageKey } = e
      const signalKey = `${storageKey}$`

      // if cleared
      if (storageKey === null) {
        return Object.keys(proxy).filter(v => v.endsWith('$')).forEach(signalKey => proxy[signalKey](undefined))
      }
      if (!Object.prototype.hasOwnProperty.call(proxy, signalKey)) return

      proxy[signalKey](e.newValue === null ? undefined : JSON.parse(e.newValue)) // null when triggered by removeItem
    }
    window.addEventListener('storage', onStorage, { signal: (abortController = new AbortController()).signal })
    cleanup(() => abortController.abort())
  })

  return proxy
}

// If you aren't using a signal instance from useWebStorage,
// use this to notify all signal instances on the same tab
export function setWebStorageItem (storageArea = localStorage, key, value) {
  const oldValue = storageArea.getItem(key)
  let newValue

  if (value === undefined) {
    storageArea.removeItem(key)
    newValue = null
  } else {
    newValue = JSON.stringify(value)
    storageArea.setItem(key, newValue)
  }

  // Manually dispatch storage event to trigger same-tab updates
  const storageEvent = new StorageEvent('storage', {
    key,
    oldValue,
    newValue,
    storageArea,
    url: window.location.href
  })

  window.dispatchEvent(storageEvent)
  return value
}

export function setLocalStorageItem (key, value) {
  setWebStorageItem(localStorage, key, value)
}

export function setSessionStorageItem (key, value) {
  return setWebStorageItem(sessionStorage, key, value)
}
