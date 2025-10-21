// The value is weak instead of the key
export default class WeakValueMap {
  #refMap = new Map() // cache
  #finalizationRegistry = new FinalizationRegistry(this.#cleanup.bind(this))

  #cleanup (key) {
    this.#refMap.delete(key)
  }

  // It is ok to set same value to different keys
  // If that's not desirable, one should hash the value and make it the key
  // so that same key always returns the same cached value
  set (key, value /* to be cached */) {
    if (this.get(key) === value) return this

    const ref = new WeakRef(value)
    this.#finalizationRegistry.unregister(ref)
    this.#refMap.set(key, ref)
    // Would overwrite previous registered entry just if same [value, token] pair
    // i.e. we wouldn't need to first do above: if (this.get(key) !== undefined /* has */) this.#finalizationRegistry.unregister(token)
    // to avoid #cleanup being called with same key when previous value is garbage collected
    this.#finalizationRegistry.register(
      value,
      key, // cleanup fn arg; can't be the value
      // unregister arg; the token
      // usually it's same as value, but we can't do it cause we will allow different map keys for same value
      // must be a reference (e.g. can't be the key if it is a string)
      ref
    )
    return this
  }

  get (key) {
    return this.#refMap.get(key)?.deref?.()
  }

  delete (key) {
    const ref = this.#refMap.get(key)
    if (!ref) return false

    this.#finalizationRegistry.unregister(ref)
    this.#refMap.delete(key)
    return true
  }

  has (key) {
    return this.get(key) !== undefined
  }

  get [Symbol.toStringTag] () {
    return 'WeakValueMap'
  }
}
