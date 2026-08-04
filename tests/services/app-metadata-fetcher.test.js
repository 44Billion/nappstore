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
  parseIrfsChunk
} from '#services/app-metadata-fetcher.js'

function sha256Hex (bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

afterEach(() => mock.restoreAll())

describe('app metadata fetcher v2', () => {
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
        candidates: [{
          fx: faviconRoot,
          url: `https://blossom.test/${faviconRoot}`,
          source: 'manifest'
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

  it('orders marked icons, alternate Blossom servers and favicon fallbacks', async () => {
    const markedRoot = '1'.repeat(64)
    const faviconRoot = '2'.repeat(64)
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
      candidates: [
        { fx: markedRoot, url: `https://primary.test/${markedRoot}`, source: 'manifest' },
        { fx: markedRoot, url: `https://secondary.test/${markedRoot}`, source: 'manifest' },
        { fx: faviconRoot, url: `https://primary.test/${faviconRoot}`, source: 'manifest' },
        { fx: faviconRoot, url: `https://secondary.test/${faviconRoot}`, source: 'manifest' }
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
      { fx: faviconRoot, url: `https://blossom.test/${faviconRoot}`, source: 'manifest' },
      { fx: htmlIconRoot, url: `https://blossom.test/${htmlIconRoot}`, source: 'html' },
      { fx: webManifestIconRoot, url: `https://blossom.test/${webManifestIconRoot}`, source: 'html' },
      { fx: null, url: 'https://cdn.test/social.png', source: 'html' }
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
