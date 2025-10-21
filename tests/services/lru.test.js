import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}

  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => {
      store[key] = value.toString()
    },
    removeItem: (key) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
    get length () {
      return Object.keys(store).length
    },
    key: (index) => {
      const keys = Object.keys(store)
      return keys[index] || null
    }
  }
})()

// Setup comprehensive browser environment mocks
global.localStorage = localStorageMock
global.sessionStorage = localStorageMock
global.requestIdleCallback = (callback) => setTimeout(callback, 0)

// Mock DOM APIs
global.document = {
  createElement: () => ({
    innerHTML: '',
    textContent: '',
    setAttribute: () => {},
    getAttribute: () => null,
    appendChild: () => {},
    removeChild: () => {}
  }),
  createTextNode: (text) => ({ textContent: text }),
  createDocumentFragment: () => ({
    appendChild: () => {},
    removeChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  }),
  addEventListener: () => {},
  removeEventListener: () => {}
}

global.window = {
  document: global.document,
  localStorage: localStorageMock,
  sessionStorage: localStorageMock,
  requestIdleCallback: global.requestIdleCallback,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  CustomEvent: class CustomEvent {},
  StorageEvent: class StorageEvent {}
}

global.Node = class Node {}
global.Element = class Element {}
global.HTMLElement = class HTMLElement {}
global.DocumentFragment = class DocumentFragment {}
global.Text = class Text {}
global.Document = class Document {}

// Mock the component library dependencies
global.custom = (element) => element
global.customElements = {
  define: () => {},
  get: () => undefined,
  whenDefined: () => Promise.resolve()
}

// Mock uhtml dependencies
global.PersistentFragment = class PersistentFragment {}

// Create a mock setLocalStorageItem function
function mockSetLocalStorageItem (key, value) {
  if (value === undefined) {
    localStorageMock.removeItem(key)
  } else {
    localStorageMock.setItem(key, JSON.stringify(value))
  }
}

// Dynamic import with proper mocking
let lru
beforeEach(async () => {
  // Clear localStorage
  localStorageMock.clear()

  // Import the LRU module
  const lruModule = await import('../../src/services/lru.js')

  // Create a new LRU instance with the mocked setLocalStorageItem function
  // This ensures we don't use the default instance which tries to import the real use-web-storage.js
  // Also disable auto-cleanup to prevent hanging
  lru = lruModule.default.ns('test', {
    maxItems: 300,
    setLocalStorageItem: mockSetLocalStorageItem,
    enableAutoCleanup: false
  })
})

describe('LRU Cache', () => {
  beforeEach(() => {
    localStorageMock.clear()
    // Create a fresh LRU instance with mocked setLocalStorageItem
    lru = lru.ns('test', {
      maxItems: 300,
      setLocalStorageItem: mockSetLocalStorageItem,
      enableAutoCleanup: false
    })
  })

  afterEach(() => {
    localStorageMock.clear()

    // Clear all pending timeouts to prevent hanging
    if (typeof clearTimeout !== 'undefined') {
      // Get the highest timeout ID and clear all below it
      // This is a hack to clear all pending timeouts
      const maxTimeoutId = setTimeout(() => {}, 0)
      for (let i = 1; i <= maxTimeoutId; i++) {
        clearTimeout(i)
      }
    }
  })

  describe('Basic Operations', () => {
    it('should set and get items', () => {
      lru.setItem('key1', 'value1')
      assert.equal(lru.getItem('key1'), 'value1')
    })

    it('should return undefined for non-existent keys', () => {
      assert.equal(lru.getItem('nonexistent'), undefined)
    })

    it('should remove items', () => {
      lru.setItem('key1', 'value1')
      lru.removeItem('key1')
      assert.equal(lru.getItem('key1'), undefined)
    })

    it('should clear all items', () => {
      lru.setItem('key1', 'value1')
      lru.setItem('key2', 'value2')
      lru.clear()
      assert.equal(lru.getItem('key1'), undefined)
      assert.equal(lru.getItem('key2'), undefined)
    })

    it('should handle complex objects', () => {
      const obj = { a: 1, b: { c: 2 } }
      lru.setItem('obj', obj)
      assert.deepEqual(lru.getItem('obj'), obj)
    })
  })

  describe('Expiration', () => {
    it('should set items with string expiration', () => {
      lru.setItem('key1', 'value1', '1 minute')
      const expiration = lru.getExpiration('key1')
      assert.ok(expiration > Date.now())
    })

    it('should set items with timestamp expiration', () => {
      const expirationTime = Date.now() + 60000
      lru.setItem('key1', 'value1', expirationTime)
      assert.equal(lru.getExpiration('key1'), expirationTime)
    })

    it('should handle expired items', async () => {
      // Set an item that expires immediately
      lru.setItem('key1', 'value1', 1) // 1ms in the past

      // Wait a bit to ensure it's expired
      await new Promise(resolve => setTimeout(resolve, 10))

      // Item should be gone when we try to get it
      assert.equal(lru.getItem('key1'), undefined)
    })

    it('should remove expired keys', async () => {
      // Set multiple items with different expirations
      lru.setItem('valid', 'value1', '1 minute')
      lru.setItem('expired1', 'value2', 1) // Expired
      lru.setItem('expired2', 'value3', 1) // Expired

      // Wait a bit to ensure items are expired
      await new Promise(resolve => setTimeout(resolve, 10))

      // Remove expired keys
      const removedCount = await lru.removeExpiredKeys()

      // Should have removed 2 expired keys
      assert.equal(removedCount, 2)

      // Valid item should still exist
      assert.equal(lru.getItem('valid'), 'value1')

      // Expired items should be gone
      assert.equal(lru.getItem('expired1'), undefined)
      assert.equal(lru.getItem('expired2'), undefined)
    })
  })

  describe('Namespaces', () => {
    it('should create isolated namespaces', () => {
      const ns1 = lru.ns('namespace1', { setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })
      const ns2 = lru.ns('namespace2', { setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })

      ns1.setItem('key', 'value1')
      ns2.setItem('key', 'value2')

      assert.equal(ns1.getItem('key'), 'value1')
      assert.equal(ns2.getItem('key'), 'value2')
      assert.equal(lru.getItem('key'), undefined)
    })

    it('should return the same instance for the same namespace', () => {
      const ns1 = lru.ns('test', { setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })
      const ns2 = lru.ns('test', { setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })
      assert.equal(ns1, ns2)
    })

    it('should respect namespace options', () => {
      const ns = lru.ns('test', { maxItems: 10, setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })
      assert.equal(ns.maxKeys, 10)
    })

    it('should update namespace options', () => {
      const ns = lru.ns('test', { maxItems: 10, setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })
      lru.ns('test', { maxItems: 20, setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })
      assert.equal(ns.maxKeys, 20)
    })

    it('should handle default expiration in namespaces', () => {
      const ns = lru.ns('test', {
        expiration: '1 minute',
        setLocalStorageItem: mockSetLocalStorageItem,
        enableAutoCleanup: false
      })
      ns.setItem('key', 'value')
      const expiration = ns.getExpiration('key')
      assert.ok(expiration > Date.now())
    })
  })

  describe('MRU Keys', () => {
    it('should limit keys to maxItems', () => {
      // Create a new LRU instance with a custom maxItems
      const testLru = lru.ns('mru-test-1', { maxItems: 3, setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })

      // Add 5 items
      for (let i = 0; i < 5; i++) {
        testLru.setItem(`key${i}`, `value${i}`)
      }

      // Only the last 3 should exist
      assert.equal(testLru.getItem('key0'), undefined)
      assert.equal(testLru.getItem('key1'), undefined)
      assert.equal(testLru.getItem('key2'), 'value2')
      assert.equal(testLru.getItem('key3'), 'value3')
      assert.equal(testLru.getItem('key4'), 'value4')
    })

    it('should update MRU order when accessing items', () => {
      // Create a new LRU instance with a custom maxItems
      const testLru = lru.ns('mru-test-2', { maxItems: 3, setLocalStorageItem: mockSetLocalStorageItem, enableAutoCleanup: false })

      testLru.setItem('key1', 'value1')
      testLru.setItem('key2', 'value2')
      testLru.setItem('key3', 'value3')

      // Access key1 to make it most recently used
      testLru.getItem('key1')

      // Add a new item, which should evict key2 (least recently used)
      testLru.setItem('key4', 'value4')

      assert.equal(testLru.getItem('key1'), 'value1') // Still exists (was accessed)
      assert.equal(testLru.getItem('key2'), undefined) // Evicted
      assert.equal(testLru.getItem('key3'), 'value3')
      assert.equal(testLru.getItem('key4'), 'value4')
    })
  })

  describe('Storage API Compatibility', () => {
    it('should have correct length', () => {
      assert.equal(lru.length, 0)
      lru.setItem('key1', 'value1')
      lru.setItem('key2', 'value2')
      assert.equal(lru.length, 2)
    })

    it('should return keys', () => {
      lru.setItem('key1', 'value1')
      lru.setItem('key2', 'value2')
      const keys = lru.keys()
      assert.deepEqual(keys.sort(), ['key1', 'key2'])
    })

    it('should return values', () => {
      lru.setItem('key1', 'value1')
      lru.setItem('key2', 'value2')
      const values = lru.values()
      assert.deepEqual(values.sort(), ['value1', 'value2'])
    })

    it('should return entries', () => {
      lru.setItem('key1', 'value1')
      lru.setItem('key2', 'value2')
      const entries = lru.entries()
      assert.deepEqual(entries.sort(), [['key1', 'value1'], ['key2', 'value2']])
    })

    it('should support has method', () => {
      lru.setItem('key1', 'value1')
      assert.equal(lru.has('key1'), true)
      assert.equal(lru.has('nonexistent'), false)
    })

    it('should support iteration', () => {
      lru.setItem('key1', 'value1')
      lru.setItem('key2', 'value2')

      const entries = []
      for (const [key, value] of lru) {
        entries.push([key, value])
      }

      assert.deepEqual(entries.sort(), [['key1', 'value1'], ['key2', 'value2']])
    })
  })

  describe('toMs Helper', () => {
    it('should convert duration strings to milliseconds', () => {
      assert.equal(lru.toMs('1 minute'), 60000)
      assert.equal(lru.toMs('2 hours'), 7200000)
      assert.equal(lru.toMs('3 days'), 259200000)
    })

    it('should return numbers as-is', () => {
      assert.equal(lru.toMs(5000), 5000)
    })

    it('should throw for invalid durations', () => {
      assert.throws(() => lru.toMs('invalid'), /Unable to parse duration/)
      assert.throws(() => lru.toMs({}), /Invalid duration type/)
    })
  })
})
