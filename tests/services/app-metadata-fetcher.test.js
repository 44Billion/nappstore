import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { afterEach, describe, it, mock } from 'node:test'
import NMMR from 'nmmr'
import { encode } from 'libp2r2p/base93'
import nostrRelays from '#services/nostr-relays.js'
import { fetchAppMetadata, fetchFileFromChunks, parseIrfsChunk } from '#services/app-metadata-fetcher.js'

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

  it('uses manifest name, description and marked Blossom icon without HTML fallback', async () => {
    const root = 'f'.repeat(64)
    const metadata = await fetchAppMetadata({
      pubkey: 'a'.repeat(64),
      tags: [
        ['service', 'blossom'],
        ['name', 'Direct name'],
        ['description', 'Direct description'],
        ['r', root, 'mark icon', 'm image/webp', 'size 10']
      ]
    }, ['wss://relay.test'], { blossomServers: ['https://blossom.test/'] })
    assert.deepEqual(metadata, {
      name: 'Direct name',
      description: 'Direct description',
      icon: { fx: root, url: `https://blossom.test/${root}` }
    })
  })
})
