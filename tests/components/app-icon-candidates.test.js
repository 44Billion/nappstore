import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isDataAppIconUrl } from '#helpers/app-icon.js'
import {
  appIconMonogramPalettes,
  getEquivalentAppIconCandidateIndex,
  getAppIconLayerState,
  getAppIconCandidateState,
  getAppIconMonogram,
  getAppIconUpgradeIndex,
  isAppIconResolutionPending,
  normalizeAppIconCandidates,
  promoteAppIconCandidate,
  reconcileAppIconCandidates
} from '#shared/app-icon-candidates.js'

// Converts an sRGB hex color to its WCAG relative luminance.
function getRelativeLuminance (hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
    )
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

// Calculates the WCAG contrast ratio between two sRGB colors.
function getContrastRatio (first, second) {
  const luminances = [getRelativeLuminance(first), getRelativeLuminance(second)]
    .sort((a, b) => b - a)
  return (luminances[0] + 0.05) / (luminances[1] + 0.05)
}

describe('app icon candidates', () => {
  it('identifies data image icons without depending on scheme casing', () => {
    assert.equal(isDataAppIconUrl('data:image/svg+xml,%3Csvg%2F%3E'), true)
    assert.equal(isDataAppIconUrl('DATA:image/png;base64,AAAA'), true)
    assert.equal(isDataAppIconUrl('https://example.test/icon.png'), false)
  })

  it('builds Unicode-aware monograms from names', () => {
    assert.equal(getAppIconMonogram('app-one', 'OpenDork').label, 'OD')
    assert.equal(getAppIconMonogram('app-two', '  Radio   Garden  ').label, 'RG')
    assert.equal(getAppIconMonogram('app-three', 'Árvore').label, 'ÁR')
    assert.equal(getAppIconMonogram('app-four', '   ').label, '◈')
  })

  it('keeps colors tied to app identity rather than mutable metadata', () => {
    const first = getAppIconMonogram('stable-id', 'Short name')
    const renamed = getAppIconMonogram('stable-id', 'A much longer name')
    assert.deepEqual(
      { lightBg: first.lightBg, lightFg: first.lightFg, darkBg: first.darkBg, darkFg: first.darkFg },
      { lightBg: renamed.lightBg, lightFg: renamed.lightFg, darkBg: renamed.darkBg, darkFg: renamed.darkFg }
    )
    assert.notEqual(first.label, renamed.label)
  })

  it('keeps every light and dark palette above WCAG AA text contrast', () => {
    for (const palette of appIconMonogramPalettes) {
      assert.ok(getContrastRatio(palette.lightBg, palette.lightFg) >= 4.5)
      assert.ok(getContrastRatio(palette.darkBg, palette.darkFg) >= 4.5)
    }
  })

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

  it('remembers the first server that actually loaded as the primary candidate', () => {
    const icon = {
      url: 'https://dead.test/icon',
      candidates: [
        { fx: 'same-root', url: 'https://dead.test/icon' },
        { fx: 'same-root', url: 'https://healthy.test/icon' }
      ],
      htmlDiscovered: true
    }
    const promoted = promoteAppIconCandidate(icon, {
      fx: 'same-root', url: 'https://healthy.test/icon', source: 'manifest'
    })
    assert.equal(promoted.url, 'https://healthy.test/icon')
    assert.deepEqual(promoted.candidates.map(candidate => candidate.url), [
      'https://healthy.test/icon',
      'https://dead.test/icon'
    ])
    assert.equal(promoted.htmlDiscovered, true)
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

  it('keeps an already loaded URL selected when refreshed candidates are reordered', () => {
    const displayed = { fx: 'same-root', url: 'https://loaded.test/icon' }
    const candidates = [
      { fx: 'same-root', url: 'https://new-primary.test/icon' },
      displayed
    ]

    assert.deepEqual(reconcileAppIconCandidates(candidates, displayed, new Set()), {
      candidates,
      index: 1
    })
  })

  it('keeps a loaded root without switching between equivalent servers', () => {
    const displayed = { fx: 'same-root', url: 'https://loaded.test/icon' }
    const candidates = [{ fx: 'same-root', url: 'https://new.test/icon' }]

    assert.deepEqual(reconcileAppIconCandidates(candidates, displayed, new Set()), {
      candidates: [displayed, ...candidates],
      index: 0
    })
  })

  it('selects a genuinely different candidate while retaining the displayed image separately', () => {
    const displayed = { fx: 'old-root', url: 'https://loaded.test/icon' }
    const candidates = [{ fx: 'new-root', url: 'https://new.test/icon' }]

    assert.deepEqual(reconcileAppIconCandidates(candidates, displayed, new Set()), {
      candidates,
      index: 0
    })
  })

  it('attempts only the metadata-preferred upgrade after discovery completes', () => {
    const displayed = {
      fx: 'favicon-root',
      url: 'https://blossom.test/favicon',
      source: 'manifest',
      priority: 200
    }
    const preferred = {
      fx: 'declared-root',
      url: 'https://blossom.test/declared',
      source: 'html',
      priority: 110
    }
    const candidates = [preferred, displayed]

    assert.equal(getAppIconUpgradeIndex(candidates, displayed, new Set()), -1)
    assert.equal(getAppIconUpgradeIndex(candidates, displayed, new Set(), {
      discoveryComplete: true
    }), 0)
    assert.equal(getAppIconUpgradeIndex(candidates, displayed, new Set(), {
      discoveryComplete: true,
      upgradeAttempted: true
    }), -1)
    assert.equal(getAppIconUpgradeIndex(candidates, displayed, new Set([preferred.url]), {
      discoveryComplete: true
    }), -1)
  })

  it('does not treat another server for the displayed asset as a quality upgrade', () => {
    const displayed = { fx: 'same-root', url: 'https://one.test/icon', priority: 200 }
    const alternateServer = { fx: 'same-root', url: 'https://two.test/icon', priority: 100 }
    assert.equal(getAppIconUpgradeIndex(
      [alternateServer, displayed],
      displayed,
      new Set(),
      { discoveryComplete: true }
    ), -1)
  })

  it('tries another server for the same preferred asset before abandoning its upgrade', () => {
    const first = { fx: 'preferred-root', url: 'https://one.test/icon', priority: 100 }
    const second = { fx: 'preferred-root', url: 'https://two.test/icon', priority: 100 }
    const fallback = { fx: 'fallback-root', url: 'https://fallback.test/icon', priority: 200 }
    assert.equal(getEquivalentAppIconCandidateIndex(
      [first, second, fallback],
      first,
      new Set([first.url])
    ), 1)
    assert.equal(getEquivalentAppIconCandidateIndex(
      [first, fallback],
      first,
      new Set([first.url])
    ), -1)
  })

  it('shows shimmer only before the first image and keeps the old layer during preload', () => {
    const oldIcon = { fx: 'old-root', url: 'https://old.test/icon' }
    const newIcon = { fx: 'new-root', url: 'https://new.test/icon' }

    assert.deepEqual(getAppIconLayerState(null, newIcon), {
      isShimmerVisible: true,
      isDisplayedLayerVisible: false,
      isCandidateLayerVisible: false
    })
    assert.deepEqual(getAppIconLayerState(oldIcon, newIcon), {
      isShimmerVisible: false,
      isDisplayedLayerVisible: true,
      isCandidateLayerVisible: false
    })
    assert.deepEqual(getAppIconLayerState(newIcon, newIcon), {
      isShimmerVisible: false,
      isDisplayedLayerVisible: false,
      isCandidateLayerVisible: true
    })
  })

  it('keeps declared icons pending until a candidate arrives or resolution is exhausted', () => {
    const initial = {
      hasReadIconState: false,
      consumerResolutionPending: undefined,
      isDiscovering: false,
      appFx: null,
      currentIcon: null,
      exhausted: false
    }
    assert.equal(isAppIconResolutionPending(initial), true)
    assert.equal(isAppIconResolutionPending({
      ...initial,
      hasReadIconState: true,
      consumerResolutionPending: true
    }), true)
    assert.equal(isAppIconResolutionPending({
      ...initial,
      hasReadIconState: true,
      consumerResolutionPending: false
    }), false)
    assert.equal(isAppIconResolutionPending({
      ...initial,
      hasReadIconState: true,
      consumerResolutionPending: true,
      exhausted: true
    }), false)
    assert.equal(isAppIconResolutionPending({
      ...initial,
      hasReadIconState: true,
      appFx: 'known-root'
    }), true)
    assert.equal(isAppIconResolutionPending({
      ...initial,
      hasReadIconState: true,
      consumerResolutionPending: false,
      appFx: 'known-root'
    }), true)
    assert.equal(isAppIconResolutionPending({
      ...initial,
      hasReadIconState: true,
      consumerResolutionPending: false,
      appFx: 'known-root',
      exhausted: true
    }), false)
  })
})
