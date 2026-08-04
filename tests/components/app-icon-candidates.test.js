import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getAppIconCandidateState,
  normalizeAppIconCandidates
} from '#shared/app-icon-candidates.js'

describe('app icon candidates', () => {
  it('keeps the primary URL first and deduplicates ordered fallbacks', () => {
    assert.deepEqual(normalizeAppIconCandidates({
      fx: 'primary',
      url: 'https://one.test/icon',
      candidates: [
        { fx: 'primary', url: 'https://one.test/icon' },
        { fx: 'primary', url: 'https://two.test/icon' },
        { fx: 'favicon', url: 'data:image/png;base64,fallback' }
      ]
    }), [
      { fx: 'primary', url: 'https://one.test/icon', source: 'manifest' },
      { fx: 'primary', url: 'https://two.test/icon', source: 'manifest' },
      { fx: 'favicon', url: 'data:image/png;base64,fallback', source: 'manifest' }
    ])
  })

  it('supports legacy cache entries and rejects empty candidates', () => {
    assert.deepEqual(normalizeAppIconCandidates({ url: 'data:image/png;base64,legacy' }), [
      { fx: null, url: 'data:image/png;base64,legacy', source: 'manifest' }
    ])
    assert.deepEqual(normalizeAppIconCandidates({ url: '  ', candidates: [null, {}] }), [])
    assert.deepEqual(normalizeAppIconCandidates(null), [])
  })

  it('accepts extensionless HTTP icons and rejects unsafe cached sources', () => {
    assert.deepEqual(normalizeAppIconCandidates({
      url: 'https://cdn.test/content-hash',
      candidates: [
        { url: 'data:image/svg+xml,%3Csvg%3E' },
        { url: '/relative/icon.png' },
        { url: 'https://user:secret@cdn.test/icon.png' },
        { url: 'javascript:alert(1)' },
        { url: 'data:text/html,not-an-image' },
        { url: ' https://cdn.test/spaced.png' }
      ]
    }), [
      { fx: null, url: 'https://cdn.test/content-hash', source: 'manifest' },
      { fx: null, url: 'data:image/svg+xml,%3Csvg%3E', source: 'manifest' }
    ])
  })

  it('advances past rejected URLs and finishes an unsuccessful discovery attempt', () => {
    const icon = {
      url: 'https://one.test/icon',
      candidates: [
        { url: 'https://one.test/icon' },
        { url: 'https://two.test/icon' }
      ],
      htmlDiscovered: false
    }
    const rejected = new Set(['https://one.test/icon'])

    assert.deepEqual(getAppIconCandidateState(icon, rejected), {
      candidates: [
        { fx: null, url: 'https://one.test/icon', source: 'manifest' },
        { fx: null, url: 'https://two.test/icon', source: 'manifest' }
      ],
      index: 1,
      htmlDiscovered: false,
      exhausted: false
    })

    rejected.add('https://two.test/icon')
    assert.equal(getAppIconCandidateState(icon, rejected).exhausted, false)
    assert.equal(getAppIconCandidateState(icon, rejected, { discoveryAttempted: true }).exhausted, true)
  })
})
