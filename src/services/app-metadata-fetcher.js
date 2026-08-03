import NMMR from 'nmmr'
import { bytesToBase16 } from 'libp2r2p/base16'
import { decode as base93Decode } from 'libp2r2p/base93'
import nostrRelays from '#services/nostr-relays.js'
import { extractHtmlMetadata } from '#services/app-metadata.js'
import {
  findManifestPathAsset,
  findMarkedManifestAsset,
  getManifestMetadata
} from '#helpers/manifest.js'

const CHUNK_BYTES = 51000
const QUERY_BATCH_SIZE = 100
const DEFAULT_METADATA_FILE_LIMIT = 5.5 * 1024 * 1024
const warnedSizeMismatches = new Set()
const MAX_WARNED_SIZE_MISMATCHES = 1000

// Reports an untrusted manifest size mismatch once per service/root pair.
function warnSizeMismatch (service, root, advertisedSize, actualSize) {
  if (advertisedSize == null || advertisedSize === actualSize) return
  const key = `${service}:${root}`
  if (warnedSizeMismatches.has(key)) return
  if (warnedSizeMismatches.size >= MAX_WARNED_SIZE_MISMATCHES) {
    warnedSizeMismatches.delete(warnedSizeMismatches.values().next().value)
  }
  warnedSizeMismatches.add(key)
  console.warn(
    `Ignoring ${service} asset size mismatch for ${root}: ` +
    `manifest advertised ${advertisedSize} bytes, received ${actualSize} bytes`
  )
}

// Keeps only the newest event for each NIP-01 address.
export function deduplicateEvents (events) {
  const byAddress = new Map()
  for (const event of events) {
    const d = event.tags?.find(tag => tag[0] === 'd')?.[1] || ''
    const address = `${event.kind}:${event.pubkey}:${d}`
    const previous = byAddress.get(address)
    if (!previous || event.created_at > previous.created_at ||
        (event.created_at === previous.created_at && String(event.id) < String(previous.id))) {
      byAddress.set(address, event)
    }
  }
  return [...byAddress.values()]
}

async function sha256Hex (bytes) {
  return bytesToBase16(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

function parseIrfsChunk (event, root) {
  if (event?.kind !== 34601 || !Array.isArray(event.tags) || typeof event.content !== 'string') throw new Error('Wrong chunk event')
  const dTags = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'd')
  const mmrTags = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'mmr')
  if (dTags.length !== 1 || dTags[0].length !== 2 || !/^[0-9a-f]{64}$/.test(dTags[0][1]) ||
      mmrTags.length !== 1 || mmrTags[0].length !== 4) throw new Error('Wrong chunk tags')
  const [, indexText, totalText, proofText] = mmrTags[0]
  const contentBytes = base93Decode(event.content)
  const proof = base93Decode(proofText)
  const calculatedRoot = NMMR.calculateRoot({ contentBytes, index: indexText, total: totalText, proof })
  const index = Number(indexText)
  const total = Number(totalText)
  if (calculatedRoot !== root || NMMR.deriveChunkId(root, indexText) !== dTags[0][1]) throw new Error('Chunk root or d mismatch')
  if (contentBytes.length < 1 || contentBytes.length > CHUNK_BYTES || (index < total - 1 && contentBytes.length !== CHUNK_BYTES)) {
    throw new Error('Wrong chunk byte length')
  }
  return { contentBytes, index, total }
}

async function queryChunkBatch ({ pubkey, root, indexes, relays }) {
  const dByIndex = new Map(indexes.map(index => [index, NMMR.deriveChunkId(root, index)]))
  const { result: events } = await nostrRelays.getEvents({
    kinds: [34601],
    authors: [pubkey],
    '#d': [...dByIndex.values()],
    limit: indexes.length
  }, relays)
  const byIndex = new Map()
  for (const event of deduplicateEvents(events)) {
    try {
      const chunk = parseIrfsChunk(event, root)
      if (dByIndex.get(chunk.index) === event.tags.find(tag => tag[0] === 'd')?.[1]) byIndex.set(chunk.index, chunk)
    } catch (_) {}
  }
  return byIndex
}

// Fetches and validates an entire IRFS v2 blob in bounded relay-query batches.
async function fetchFileFromChunks (pubkey, root, relays, { maxSizeBytes = null, size = null } = {}) {
  if (!/^[0-9a-f]{64}$/.test(root)) return null
  const advertisedSize = Number.isSafeInteger(size) && size >= 0 ? size : null

  const first = await queryChunkBatch({ pubkey, root, indexes: [0], relays })
  const firstChunk = first.get(0)
  if (!firstChunk) return null
  const total = firstChunk.total
  const minimumSize = ((total - 1) * CHUNK_BYTES) + 1
  if (!Number.isSafeInteger(minimumSize) || (maxSizeBytes !== null && minimumSize > maxSizeBytes)) return null

  const chunks = new Array(total)
  chunks[0] = firstChunk.contentBytes
  for (let offset = 1; offset < total; offset += QUERY_BATCH_SIZE) {
    const end = Math.min(total, offset + QUERY_BATCH_SIZE)
    const indexes = Array.from({ length: end - offset }, (_, index) => offset + index)
    const batch = await queryChunkBatch({ pubkey, root, indexes, relays })
    for (const index of indexes) {
      const chunk = batch.get(index)
      if (!chunk || chunk.total !== total) return null
      chunks[index] = chunk.contentBytes
    }
  }

  const reconstructedSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (maxSizeBytes !== null && reconstructedSize > maxSizeBytes) return null
  warnSizeMismatch('irfs', root, advertisedSize, reconstructedSize)
  return chunks
}

// Reads a response with a hard limit based on received bytes, not HTTP metadata.
async function readResponseBytes (response, maxSizeBytes) {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (maxSizeBytes !== null && total > maxSizeBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

async function fetchFromBlossom (asset, blossomServers, maxSizeBytes = null) {
  for (const server of blossomServers || []) {
    try {
      const response = await fetch(`${server.replace(/\/$/, '')}/${asset.root}`)
      if (!response.ok) continue
      const bytes = await readResponseBytes(response, maxSizeBytes)
      if (!bytes || await sha256Hex(bytes) !== asset.root) continue
      warnSizeMismatch('blossom', asset.root, asset.size, bytes.length)
      return bytes
    } catch (_) {}
  }
  return null
}

function buildBlossomUrl (root, blossomServers) {
  if (!blossomServers?.length) return null
  return `${blossomServers[0].replace(/\/$/, '')}/${root}`
}

function chunksToText (binaryChunks) {
  const total = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of binaryChunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(bytes)
}

function chunksToDataUrl (binaryChunks, mimeType) {
  const blob = new Blob(binaryChunks, { type: mimeType })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Fetches a validated IRFS asset and converts it to a data URL.
export async function fetchFileDataUrl ({ pubkey, rootHash, relays, mimeType, size = null, maxSizeBytes = null }) {
  if (!pubkey || !rootHash || !Array.isArray(relays) || !relays.length) return null
  try {
    const chunks = await fetchFileFromChunks(pubkey, rootHash, relays, { maxSizeBytes, size })
    return chunks ? chunksToDataUrl(chunks, mimeType || 'application/octet-stream') : null
  } catch (error) {
    console.error('Error fetching file data URL:', error)
    return null
  }
}

async function assetBytes (asset, pubkey, relays, blossomServers, maxSizeBytes) {
  if (asset.service === 'blossom') {
    const bytes = await fetchFromBlossom(asset, blossomServers, maxSizeBytes)
    return bytes ? [bytes] : null
  }
  return fetchFileFromChunks(pubkey, asset.root, relays, { maxSizeBytes, size: asset.size })
}

function manifestHints (manifestEvent, tagName) {
  return (Array.isArray(manifestEvent?.tags) ? manifestEvent.tags : [])
    .filter(tag => Array.isArray(tag) && tag[0] === tagName && typeof tag[1] === 'string')
    .map(tag => tag[1].trim())
    .filter(Boolean)
}

// Reads metadata from the manifest first and uses HTML/favicon only as fallback.
export async function fetchAppMetadata (manifestEvent, relays, { blossomServers } = {}) {
  const effectiveRelays = [...new Set([
    ...manifestHints(manifestEvent, 'relay'),
    ...(Array.isArray(relays) ? relays : [])
  ])]
  const effectiveBlossomServers = [...new Set([
    ...manifestHints(manifestEvent, 'server'),
    ...(Array.isArray(blossomServers) ? blossomServers : [])
  ])]
  const direct = getManifestMetadata(manifestEvent)
  const metadata = {
    name: direct.name,
    description: direct.description || direct.summary,
    icon: null
  }

  try {
    if (!metadata.name || !metadata.description) {
      const indexAsset = findManifestPathAsset(manifestEvent, path => path === 'index.html' || path === 'index.htm')
      if (indexAsset) {
        const chunks = await assetBytes(
          indexAsset,
          manifestEvent.pubkey,
          effectiveRelays,
          effectiveBlossomServers,
          DEFAULT_METADATA_FILE_LIMIT
        )
        if (chunks) {
          const extracted = extractHtmlMetadata(chunksToText(chunks))
          metadata.name ||= extracted.name
          metadata.description ||= extracted.description
        }
      }
    }

    let iconAsset = findMarkedManifestAsset(manifestEvent, 'icon')
    if (!iconAsset) {
      iconAsset = findManifestPathAsset(manifestEvent, path =>
        /^favicon\.(ico|svg|webp|png|jpg|jpeg|gif)$/i.test(path.split('/').pop())
      )
    }
    if (iconAsset) {
      if (iconAsset.service === 'blossom') {
        const url = buildBlossomUrl(iconAsset.root, effectiveBlossomServers)
        if (url) metadata.icon = { fx: iconAsset.root, url }
      } else {
        const chunks = await fetchFileFromChunks(manifestEvent.pubkey, iconAsset.root, effectiveRelays, {
          maxSizeBytes: DEFAULT_METADATA_FILE_LIMIT,
          size: iconAsset.size
        })
        if (chunks) {
          const mimeType = iconAsset.mimeType || 'image/png'
          metadata.icon = { fx: iconAsset.root, url: await chunksToDataUrl(chunks, mimeType) }
        }
      }
    }
  } catch (error) {
    console.error('Error fetching app metadata:', error)
  }
  return metadata
}

export { fetchFileFromChunks, parseIrfsChunk }
