import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { afterEach, describe, it, mock } from 'node:test'
import NMMR from 'nmmr'
import { encode } from 'libp2r2p/base93'
import { appEncode } from 'libp2r2p/nip19'
import nostrRelays from '#services/nostr-relays.js'
import {
  discoverHtmlIconFallbacks,
  fetchAppMetadata,
  fetchFileFromChunks,
  needsHtmlMetadataFallback,
  parseIrfsChunk,
  rankBlossomServers
} from '#services/app-metadata-fetcher.js'
import { extractWebManifestIcons, resolveExternalImageUrl } from '#services/app-metadata.js'

function sha256Hex (bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

afterEach(() => mock.restoreAll())

describe('external app icon URLs', () => {
  it('resolves safe sources without relying on file extensions', () => {
    assert.equal(resolveExternalImageUrl('https://cdn.test/content-hash'), 'https://cdn.test/content-hash')
    assert.equal(resolveExternalImageUrl('icon.png', 'https://cdn.test/assets/'), 'https://cdn.test/assets/icon.png')
    assert.equal(resolveExternalImageUrl('/icon.png'), null)
    assert.equal(resolveExternalImageUrl('https://user:secret@cdn.test/icon.png'), null)
    assert.equal(resolveExternalImageUrl('javascript:alert(1)'), null)
    assert.equal(resolveExternalImageUrl('data:text/html,not-an-image'), null)
  })

  it('keeps Web App Manifest author order instead of preferring the largest declaration', () => {
    assert.deepEqual(extractWebManifestIcons({
      icons: [
        { src: 'compact.png', sizes: '64x64', purpose: 'any' },
        { src: 'heavy.png', sizes: '1024x1024', purpose: 'any' }
      ]
    }), [
      { href: 'compact.png', kind: 'web-app-manifest' },
      { href: 'heavy.png', kind: 'web-app-manifest' }
    ])
  })
})

describe('app metadata fetcher v2', () => {
  it('includes the canonical app ID in internal icon errors', async () => {
    const ref = { dTag: 'logging', pubkey: 'a'.repeat(64), kind: 35128 }
    const canonicalAppId = appEncode(ref)
    const appId = appEncode({ ...ref, relays: ['wss://relay.test'] })
    const consoleError = mock.method(console, 'error', () => {})
    mock.method(nostrRelays, 'getEvents', async () => {
      throw new Error('relay failure')
    })

    await fetchAppMetadata({
      pubkey: ref.pubkey,
      tags: [
        ['service', 'irfs'],
        ['r', 'f'.repeat(64), 'mark icon', 'm image/png']
      ]
    }, ['wss://relay.test'], { appId })

    assert.equal(consoleError.mock.callCount(), 1)
    assert.equal(
      consoleError.mock.calls[0].arguments[0],
      `[app-icon ${canonicalAppId}] Failed to resolve icon asset ${'f'.repeat(64)}:`
    )
  })

  it('keeps HTML fallback discovery pending when a direct icon lacks listing metadata', () => {
    const directIcon = { url: 'https://blossom.test/favicon' }
    assert.equal(needsHtmlMetadataFallback({ icon: directIcon, name: null, description: null }), true)
    assert.equal(needsHtmlMetadataFallback({ icon: directIcon, name: 'Hallway', description: 'An app' }), false)
    assert.equal(needsHtmlMetadataFallback({ icon: null, name: 'Hallway', description: 'An app' }), true)
  })

  it('validates an IRFS chunk proof and rejects content mutation', async () => {
    const mmr = new NMMR()
    await mmr.append(Uint8Array.of(1, 2, 3))
    const [chunk] = await Array.fromAsync(mmr.getChunks())
    const event = {
      kind: 34601,
      tags: [['d', NMMR.deriveChunkId(mmr.getRoot(), chunk.index)], ['mmr', '0', '1', encode(chunk.proof)]],
      content: encode(chunk.contentBytes)
    }
    assert.equal(parseIrfsChunk(event, mmr.getRoot(), 3).total, 1)
    event.content = encode(Uint8Array.of(9))
    assert.throws(() => parseIrfsChunk(event, mmr.getRoot(), 3), /mismatch/)
  })

  it('downloads IRFS metadata despite a wrong size hint and enforces the real-byte limit', async () => {
    const mmr = new NMMR()
    await mmr.append(Uint8Array.of(1, 2, 3))
    const root = mmr.getRoot()
    const chunks = await Array.fromAsync(mmr.getChunks())
    const events = chunks.map(chunk => ({
      kind: 34601,
      tags: [
        ['d', NMMR.deriveChunkId(root, chunk.index)],
        ['mmr', String(chunk.index), String(chunk.total), encode(chunk.proof)]
      ],
      content: encode(chunk.contentBytes)
    }))
    mock.method(nostrRelays, 'getEvents', async filter => ({
      result: events.filter(event => filter['#d'].includes(event.tags[0][1]))
    }))
    const consoleWarn = mock.method(console, 'warn', () => {})

    const downloaded = await fetchFileFromChunks('a'.repeat(64), root, ['wss://relay.test'], {
      size: 999999,
      maxSizeBytes: 3
    })
    assert.deepEqual(downloaded.map(bytes => [...bytes]), [[1, 2, 3]])
    assert.equal(consoleWarn.mock.callCount(), 1)

    const rejected = await fetchFileFromChunks('a'.repeat(64), root, ['wss://relay.test'], {
      size: 1,
      maxSizeBytes: 2
    })
    assert.equal(rejected, null)
  })

  it('uses hash-valid Blossom bytes despite a wrong manifest size', async () => {
    const html = new TextEncoder().encode('<title>Fallback title</title><meta name="description" content="Fallback description">')
    const root = sha256Hex(html)
    const consoleWarn = mock.method(console, 'warn', () => {})
    mock.method(globalThis, 'fetch', async () => new Response(html, {
      status: 200,
      headers: { 'Content-Length': '1' }
    }))

    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['service', 'blossom'],
        ['r', root, 'path index.html', 'm text/html', 'size 1']
      ]
    }, ['wss://relay.test'], { blossomServers: ['https://blossom.test/'] })

    assert.equal(metadata.name, 'Fallback title')
    assert.equal(metadata.description, 'Fallback description')
    assert.equal(consoleWarn.mock.callCount(), 1)
  })

  it('uses manifest server hints for legacy HTML and favicon fallbacks', async () => {
    const html = new TextEncoder().encode(`
      <title>OpenDork</title>
      <meta name="description" content="Nostr-native terminal AI workspace">
    `)
    const indexRoot = sha256Hex(html)
    const faviconRoot = '7'.repeat(64)
    mock.method(globalThis, 'fetch', async url => {
      assert.equal(url, `https://blossom.test/${indexRoot}`)
      return new Response(html, { status: 200 })
    })

    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['d', 'opendork'],
        ['path', '/index.html', indexRoot],
        ['path', '/favicon.ico', faviconRoot],
        ['server', 'https://blossom.test'],
        ['title', 'opendork'],
        ['description', 'Direct manifest description']
      ]
    }, [])

    assert.deepEqual(metadata, {
      name: 'OpenDork',
      description: 'Direct manifest description',
      icon: {
        fx: faviconRoot,
        url: `https://blossom.test/${faviconRoot}`,
        source: 'manifest',
        priority: 200,
        candidates: [{
          fx: faviconRoot,
          url: `https://blossom.test/${faviconRoot}`,
          source: 'manifest',
          priority: 200
        }],
        manifestEventId: null,
        htmlRoot: indexRoot,
        htmlDiscovered: true,
        htmlName: 'OpenDork',
        htmlDescription: 'Nostr-native terminal AI workspace'
      }
    })
  })

  it('uses manifest name, description and marked Blossom icon without HTML fallback', async () => {
    const root = 'f'.repeat(64)
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('HTML must remain lazy')
    })
    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['service', 'blossom'],
        ['name', 'Direct name'],
        ['description', 'Direct description'],
        ['r', root, 'mark icon', 'm image/webp', 'size 10']
      ]
    }, ['wss://relay.test'], { blossomServers: ['https://blossom.test/'] })
    assert.equal(metadata.name, 'Direct name')
    assert.equal(metadata.description, 'Direct description')
    assert.equal(metadata.icon.fx, root)
    assert.equal(metadata.icon.url, `https://blossom.test/${root}`)
    assert.equal(metadata.icon.htmlDiscovered, false)
    assert.equal(fetchMock.mock.callCount(), 0)
  })

  it('puts the first responsive Blossom server ahead of an earlier stalled server', async () => {
    const root = 'e'.repeat(64)
    mock.method(globalThis, 'fetch', (url, options) => {
      if (url.startsWith('https://dead.test')) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }
      return Promise.resolve(new Response(null, { status: 200 }))
    })
    assert.deepEqual(await rankBlossomServers(
      { root },
      ['https://dead.test', 'https://healthy.test'],
      { timeoutMs: 20 }
    ), ['https://healthy.test', 'https://dead.test'])
  })

  it('hedges a stalled Blossom download without waiting for its full timeout', async () => {
    const html = new TextEncoder().encode('<title>Healthy fallback</title>')
    const root = sha256Hex(html)
    let stalledRequestAborted = false
    mock.method(globalThis, 'fetch', (url, options) => {
      if (options.method === 'HEAD') return Promise.resolve(new Response(null, { status: 405 }))
      if (url.startsWith('https://dead.test')) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            stalledRequestAborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      }
      return Promise.resolve(new Response(html, { status: 200 }))
    })

    const startedAt = performance.now()
    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['service', 'blossom'],
        ['path', 'index.html', root],
        ['server', 'https://dead.test'],
        ['server', 'https://healthy.test']
      ]
    }, [], { forceHtml: true })

    assert.equal(metadata.name, 'Healthy fallback')
    assert.equal(metadata.icon.htmlDiscovered, true)
    assert.equal(stalledRequestAborted, true)
    assert(performance.now() - startedAt < 3000)
  })

  it('can publish direct icon candidates without waiting for missing HTML metadata', async () => {
    const root = 'd'.repeat(64)
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('HTML must remain deferred')
    })
    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['service', 'blossom'],
        ['name', 'Direct icon first'],
        ['r', root, 'mark icon', 'm image/png'],
        ['path', 'index.html', 'c'.repeat(64)]
      ]
    }, [], { blossomServers: ['https://blossom.test'], skipHtml: true })
    assert.equal(metadata.icon.url, `https://blossom.test/${root}`)
    assert.equal(metadata.icon.htmlDiscovered, false)
    assert.equal(fetchMock.mock.callCount(), 0)
  })

  it('orders marked icons, alternate Blossom servers and favicon fallbacks', async () => {
    const markedRoot = '1'.repeat(64)
    const faviconRoot = '2'.repeat(64)
    mock.method(globalThis, 'fetch', async (_url, options) => {
      assert.equal(options.method, 'HEAD')
      return new Response(null, { status: 200 })
    })
    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['service', 'blossom'],
        ['name', 'Fallback chain'],
        ['description', 'Ordered icon candidates'],
        ['r', markedRoot, 'mark icon', 'm image/png'],
        ['r', faviconRoot, 'path favicon.ico', 'm image/x-icon'],
        ['server', 'https://primary.test/']
      ]
    }, ['wss://relay.test'], { blossomServers: ['https://secondary.test'] })

    assert.deepEqual(metadata.icon, {
      fx: markedRoot,
      url: `https://primary.test/${markedRoot}`,
      source: 'manifest',
      priority: 0,
      candidates: [
        { fx: markedRoot, url: `https://primary.test/${markedRoot}`, source: 'manifest', priority: 0 },
        { fx: markedRoot, url: `https://secondary.test/${markedRoot}`, source: 'manifest', priority: 0 },
        { fx: faviconRoot, url: `https://primary.test/${faviconRoot}`, source: 'manifest', priority: 200 },
        { fx: faviconRoot, url: `https://secondary.test/${faviconRoot}`, source: 'manifest', priority: 200 }
      ],
      manifestEventId: null,
      htmlRoot: null,
      htmlDiscovered: false,
      htmlName: undefined,
      htmlDescription: undefined
    })
  })

  it('adds HTML, Web App Manifest and Open Graph sources before exhausting fallbacks', async () => {
    const html = new TextEncoder().encode(`
      <link rel="icon" href="/icons/from-html.png">
      <link rel="manifest" href="site.webmanifest">
      <meta property="og:image" content="https://cdn.test/social.png">
    `)
    const webManifest = new TextEncoder().encode(JSON.stringify({
      icons: [{ src: 'icons/from-manifest.png', purpose: 'any' }]
    }))
    const indexRoot = sha256Hex(html)
    const webManifestRoot = sha256Hex(webManifest)
    const htmlIconRoot = '3'.repeat(64)
    const webManifestIconRoot = '4'.repeat(64)
    const faviconRoot = '5'.repeat(64)
    mock.method(globalThis, 'fetch', async url => {
      if (url.endsWith(indexRoot)) return new Response(html, { status: 200 })
      if (url.endsWith(webManifestRoot)) return new Response(webManifest, { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['service', 'blossom'],
        ['name', 'HTML icon sources'],
        ['description', 'Fallbacks'],
        ['path', 'index.html', indexRoot],
        ['path', 'icons/from-html.png', htmlIconRoot],
        ['path', 'site.webmanifest', webManifestRoot],
        ['path', 'icons/from-manifest.png', webManifestIconRoot],
        ['path', 'favicon.ico', faviconRoot],
        ['server', 'https://blossom.test']
      ]
    }, [], { forceHtml: true })

    assert.deepEqual(metadata.icon.candidates, [
      { fx: htmlIconRoot, url: `https://blossom.test/${htmlIconRoot}`, source: 'html', priority: 110 },
      { fx: webManifestIconRoot, url: `https://blossom.test/${webManifestIconRoot}`, source: 'html', priority: 140 },
      { fx: faviconRoot, url: `https://blossom.test/${faviconRoot}`, source: 'manifest', priority: 200 },
      { fx: null, url: 'https://cdn.test/social.png', source: 'html', priority: 372 }
    ])
  })

  it('reuses HTML fallbacks for metadata-only revisions with the same index root', async () => {
    const html = new TextEncoder().encode('<link rel="icon" href="html-icon.png">')
    const indexRoot = sha256Hex(html)
    const htmlIconRoot = '6'.repeat(64)
    const faviconRoot = '7'.repeat(64)
    const fetchMock = mock.method(globalThis, 'fetch', async url => {
      assert.equal(url, `https://blossom.test/${indexRoot}`)
      return new Response(html, { status: 200 })
    })
    const tags = [
      ['service', 'blossom'],
      ['name', 'Cached HTML'],
      ['description', 'Same binary version'],
      ['path', 'index.html', indexRoot],
      ['path', 'html-icon.png', htmlIconRoot],
      ['path', 'favicon.ico', faviconRoot],
      ['server', 'https://blossom.test']
    ]
    const first = await fetchAppMetadata({ id: 'old', pubkey: 'a'.repeat(64), tags }, [], { forceHtml: true })
    const second = await fetchAppMetadata({ id: 'new', pubkey: 'a'.repeat(64), tags }, [], {
      cachedIcon: first.icon
    })

    assert.equal(fetchMock.mock.callCount(), 1)
    assert.equal(second.icon.manifestEventId, 'new')
    assert.equal(second.icon.htmlDiscovered, true)
    assert(second.icon.candidates.some(candidate => candidate.fx === htmlIconRoot && candidate.source === 'html'))
  })

  it('invalidates cached HTML fallbacks when the index root changes', async () => {
    const oldHtml = new TextEncoder().encode('<link rel="icon" href="old.png">')
    const newHtml = new TextEncoder().encode('<link rel="icon" href="new.png">')
    const oldRoot = sha256Hex(oldHtml)
    const newRoot = sha256Hex(newHtml)
    const fetchMock = mock.method(globalThis, 'fetch', async url => {
      if (url.endsWith(oldRoot)) return new Response(oldHtml, { status: 200 })
      if (url.endsWith(newRoot)) return new Response(newHtml, { status: 200 })
      throw new Error(`Unexpected fetch: ${url}`)
    })
    const baseTags = [
      ['service', 'blossom'],
      ['name', 'Changed root'],
      ['description', 'Changed root'],
      ['server', 'https://blossom.test']
    ]
    const first = await fetchAppMetadata({
      id: 'old',
      pubkey: 'a'.repeat(64),
      tags: [...baseTags, ['path', 'index.html', oldRoot], ['path', 'old.png', '8'.repeat(64)]]
    }, [], { forceHtml: true })
    const second = await fetchAppMetadata({
      id: 'new',
      pubkey: 'a'.repeat(64),
      tags: [...baseTags, ['path', 'index.html', newRoot], ['path', 'new.png', '9'.repeat(64)]]
    }, [], { cachedIcon: first.icon, forceHtml: true })

    assert.equal(fetchMock.mock.callCount(), 2)
    assert.equal(second.icon.htmlRoot, newRoot)
    assert(second.icon.candidates.some(candidate => candidate.fx === '9'.repeat(64)))
    assert(!second.icon.candidates.some(candidate => candidate.fx === '8'.repeat(64)))
  })

  it('deduplicates concurrent on-demand HTML discovery for one encoded app', async () => {
    const html = new TextEncoder().encode('<title>Lazy</title>')
    const indexRoot = sha256Hex(html)
    const pubkey = 'a'.repeat(64)
    const appId = appEncode({ dTag: 'lazy', pubkey, kind: 35128 })
    const manifest = {
      id: 'manifest',
      kind: 35128,
      pubkey,
      created_at: 1,
      tags: [
        ['d', 'lazy'],
        ['service', 'blossom'],
        ['path', 'index.html', indexRoot],
        ['server', 'https://blossom.test']
      ]
    }
    let queryCount = 0
    let releaseQuery
    const queryGate = new Promise(resolve => { releaseQuery = resolve })
    const deps = {
      _getRelaysByPubkey: async () => ({ [pubkey]: { write: ['wss://relay.test'] } }),
      _getBlossomServersByPubkey: async () => ({ [pubkey]: ['https://blossom.test'] }),
      _nostrRelays: {
        async getEvents () {
          queryCount++
          await queryGate
          return { result: [manifest] }
        }
      }
    }
    mock.method(globalThis, 'fetch', async () => new Response(html, { status: 200 }))

    const first = discoverHtmlIconFallbacks(appId, null, deps)
    const second = discoverHtmlIconFallbacks(appId, null, deps)
    assert.equal(first, second)
    releaseQuery()
    await Promise.all([first, second])
    assert.equal(queryCount, 1)
  })
})
