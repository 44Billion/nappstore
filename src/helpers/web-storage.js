// Writes web storage and notifies reactive readers in the same tab.
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

// Writes localStorage and notifies same-tab reactive readers.
export function setLocalStorageItem (key, value) {
  return setWebStorageItem(localStorage, key, value)
}

// Writes sessionStorage and notifies same-tab reactive readers.
export function setSessionStorageItem (key, value) {
  return setWebStorageItem(sessionStorage, key, value)
}
