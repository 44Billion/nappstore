import NMMR from 'nmmr'
import { bytesToBase16 } from 'libp2r2p/base16'
import { decode as base93Decode } from 'libp2r2p/base93'
import { appDecode } from 'libp2r2p/nip19'
import nostrRelays, { nappRelays } from '#services/nostr-relays.js'
import { getBlossomServersByPubkey, getRelaysByPubkey } from '#helpers/nostr/queries.js'
import {
  extractHtmlMetadata,
  extractWebManifestIcons,
  resolveAppPath,
  resolveExternalImageUrl
} from '#services/app-metadata.js'
import {
  findManifestPathAsset,
  findMarkedManifestAssets,
  getManifestAssets,
  getManifestMetadata
} from '#helpers/manifest.js'
import { isRenderableAppIconUrl } from '#helpers/app-icon.js'

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

// Adds an asset entry once while preserving discovery order.
function addAssetEntry (entries, seenAssets, asset, source = 'manifest') {
  if (!asset) return
  const key = `${asset.service}:${asset.root}`
  if (seenAssets.has(key)) return
  seenAssets.add(key)
  entries.push({ asset, source })
}

// Resolves every usable icon URL while preserving asset and server priority.
async function resolveIconCandidates (entries, manifestEvent, relays, blossomServers, cachedIcon) {
  const candidates = []
  const seenUrls = new Set()
  const cachedCandidates = normalizeCachedIconCandidates(cachedIcon)
  for (const entry of entries) {
    if (entry.candidate) {
      if (!seenUrls.has(entry.candidate.url)) {
        seenUrls.add(entry.candidate.url)
        candidates.push({ ...entry.candidate, source: entry.source })
      }
      continue
    }

    const { asset, source } = entry
    if (asset.service === 'blossom') {
      for (const server of blossomServers) {
        const url = `${server.replace(/\/$/, '')}/${asset.root}`
        if (seenUrls.has(url)) continue
        seenUrls.add(url)
        candidates.push({ fx: asset.root, url, source })
      }
      continue
    }

    try {
      const cached = cachedCandidates.find(candidate => candidate.fx === asset.root)
      if (cached && !seenUrls.has(cached.url)) {
        seenUrls.add(cached.url)
        candidates.push({ ...cached, source })
        continue
      }
      const chunks = await fetchFileFromChunks(manifestEvent.pubkey, asset.root, relays, {
        maxSizeBytes: DEFAULT_METADATA_FILE_LIMIT,
        size: asset.size
      })
      if (!chunks) continue
      const mimeType = asset.mimeType || 'image/png'
      const url = await chunksToDataUrl(chunks, mimeType)
      if (!seenUrls.has(url)) {
        seenUrls.add(url)
        candidates.push({ fx: asset.root, url, source })
      }
    } catch (error) {
      console.error(`Failed to resolve icon asset ${asset.root}:`, error)
    }
  }
  return candidates
}

// Expands HTML sources into signed assets, Web App Manifest icons or remote URLs.
async function addHtmlIconEntries ({
  entries,
  seenAssets,
  sources,
  htmlMetadata,
  indexPath,
  manifestEvent,
  relays,
  blossomServers
}) {
  for (const source of sources) {
    const path = resolveAppPath(source.href, indexPath, htmlMetadata.baseHref)
    const asset = path && findManifestPathAsset(manifestEvent, candidate => candidate === path)

    if (source.kind === 'manifest') {
      if (!asset) continue
      try {
        const bytes = await assetBytes(
          asset,
          manifestEvent.pubkey,
          relays,
          blossomServers,
          DEFAULT_METADATA_FILE_LIMIT
        )
        if (!bytes) continue
        for (const icon of extractWebManifestIcons(chunksToText(bytes))) {
          const iconPath = resolveAppPath(icon.href, path)
          const iconAsset = iconPath && findManifestPathAsset(manifestEvent, candidate => candidate === iconPath)
          if (iconAsset) {
            addAssetEntry(entries, seenAssets, iconAsset, 'html')
          } else {
            const url = resolveExternalImageUrl(icon.href)
            if (url) entries.push({ candidate: { fx: null, url }, source: 'html' })
          }
        }
      } catch (error) {
        console.error('Failed to read Web App Manifest icons:', error)
      }
      continue
    }

    if (asset) {
      addAssetEntry(entries, seenAssets, asset, 'html')
      continue
    }
    const url = resolveExternalImageUrl(source.href, htmlMetadata.baseHref)
    if (url) entries.push({ candidate: { fx: null, url }, source: 'html' })
  }
}

function normalizeCachedIconCandidates (icon) {
  if (!icon || typeof icon !== 'object') return []
  const candidates = [icon, ...(Array.isArray(icon.candidates) ? icon.candidates : [])]
  const seen = new Set()
  return candidates.flatMap(candidate => {
    if (!isRenderableAppIconUrl(candidate?.url) || seen.has(candidate.url)) return []
    seen.add(candidate.url)
    return [{
      fx: typeof candidate.fx === 'string' ? candidate.fx : null,
      url: candidate.url,
      source: candidate.source === 'html' ? 'html' : 'manifest'
    }]
  })
}

function mergeCandidates (...groups) {
  const seen = new Set()
  return groups.flat().filter(candidate => {
    if (!isRenderableAppIconUrl(candidate?.url) || seen.has(candidate.url)) return false
    seen.add(candidate.url)
    return true
  })
}

// Keeps the primary icon shape compatible while recording discovery freshness.
function createIconMetadata (candidates, manifestEvent, indexAsset, htmlDiscovered, htmlMetadata) {
  const first = candidates[0] || { fx: null, url: null }
  return {
    fx: first.fx,
    url: first.url,
    candidates,
    manifestEventId: manifestEvent.id || null,
    htmlRoot: indexAsset?.root || null,
    htmlDiscovered,
    htmlName: htmlMetadata?.name,
    htmlDescription: htmlMetadata?.description
  }
}

function getManifestIconAssets (manifestEvent) {
  const marked = findMarkedManifestAssets(manifestEvent, 'icon')
  const seenRoots = new Set(marked.map(asset => asset.root))
  const favicons = getManifestAssets(manifestEvent).flatMap(asset => {
    const path = asset.paths.find(path =>
      /^favicon\.(ico|svg|webp|png|jpg|jpeg|gif|avif)$/i.test(path.split('/').pop())
    )
    return path && !seenRoots.has(asset.root) ? [{ ...asset, path }] : []
  })
  return [...marked, ...favicons]
}

// Reads direct metadata first and discovers HTML only when it is needed.
export async function fetchAppMetadata (manifestEvent, relays, {
  blossomServers,
  cachedIcon = null,
  forceHtml = false
} = {}) {
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

  const indexAsset = findManifestPathAsset(manifestEvent, path => path === 'index.html' || path === 'index.htm')
  const manifestAssets = getManifestIconAssets(manifestEvent)
  const entries = []
  const seenAssets = new Set()
  for (const asset of manifestAssets) addAssetEntry(entries, seenAssets, asset)

  let directCandidates = []
  try {
    directCandidates = await resolveIconCandidates(
      entries,
      manifestEvent,
      effectiveRelays,
      effectiveBlossomServers,
      cachedIcon
    )
  } catch (error) {
    console.error('Error resolving manifest icon candidates:', error)
  }

  const cachedHtmlCandidates = cachedIcon?.htmlDiscovered && cachedIcon.htmlRoot === (indexAsset?.root || null)
    ? normalizeCachedIconCandidates(cachedIcon).filter(candidate => candidate.source === 'html')
    : []
  const canReuseHtml = cachedIcon?.htmlDiscovered === true && cachedIcon.htmlRoot === (indexAsset?.root || null)
  if (canReuseHtml) {
    metadata.name ||= cachedIcon.htmlName
    metadata.description ||= cachedIcon.htmlDescription
  }
  let htmlCandidates = cachedHtmlCandidates
  let htmlDiscovered = canReuseHtml
  let discoveredHtmlMetadata = canReuseHtml
    ? { name: cachedIcon.htmlName, description: cachedIcon.htmlDescription }
    : null
  const shouldReadHtml = forceHtml || !metadata.name || !metadata.description || manifestAssets.length === 0

  if (shouldReadHtml && !htmlDiscovered) {
    if (!indexAsset) {
      htmlDiscovered = true
    } else {
      try {
        const chunks = await assetBytes(
          indexAsset,
          manifestEvent.pubkey,
          effectiveRelays,
          effectiveBlossomServers,
          DEFAULT_METADATA_FILE_LIMIT
        )
        if (chunks) {
          const htmlMetadata = extractHtmlMetadata(chunksToText(chunks))
          discoveredHtmlMetadata = htmlMetadata
          metadata.name ||= htmlMetadata.name
          metadata.description ||= htmlMetadata.description
          const htmlEntries = []
          const htmlSeenAssets = new Set(manifestAssets.map(asset => `${asset.service}:${asset.root}`))
          const specificSources = htmlMetadata.iconSources.filter(source => !['tile-image', 'social-image'].includes(source.kind))
          const socialSources = htmlMetadata.iconSources.filter(source => ['tile-image', 'social-image'].includes(source.kind))
          const sourceOptions = {
            entries: htmlEntries,
            seenAssets: htmlSeenAssets,
            htmlMetadata,
            indexPath: indexAsset.path || 'index.html',
            manifestEvent,
            relays: effectiveRelays,
            blossomServers: effectiveBlossomServers
          }
          await addHtmlIconEntries({ ...sourceOptions, sources: specificSources })
          await addHtmlIconEntries({ ...sourceOptions, sources: socialSources })
          htmlCandidates = await resolveIconCandidates(
            htmlEntries,
            manifestEvent,
            effectiveRelays,
            effectiveBlossomServers,
            cachedIcon
          )
          htmlDiscovered = true
        }
      } catch (error) {
        console.error('Error fetching HTML app metadata:', error)
      }
    }
  }

  metadata.icon = createIconMetadata(
    mergeCandidates(directCandidates, htmlCandidates),
    manifestEvent,
    indexAsset,
    htmlDiscovered,
    discoveredHtmlMetadata
  )
  return metadata
}

const htmlDiscoveryByAppId = new Map()

// Refetches one current manifest and expands its HTML icon fallbacks on demand.
export function discoverHtmlIconFallbacks (appId, cachedIcon, {
  _getRelaysByPubkey = getRelaysByPubkey,
  _getBlossomServersByPubkey = getBlossomServersByPubkey,
  _nostrRelays = nostrRelays
} = {}) {
  if (htmlDiscoveryByAppId.has(appId)) return htmlDiscoveryByAppId.get(appId)
  const request = (async () => {
    const { dTag, pubkey, kind } = appDecode(appId)
    const [relaysByAuthor, blossomServersByAuthor] = await Promise.all([
      _getRelaysByPubkey([pubkey]),
      _getBlossomServersByPubkey([pubkey])
    ])
    const relays = [...new Set([
      ...(relaysByAuthor[pubkey]?.write || []),
      ...nappRelays
    ])]
    const { result } = await _nostrRelays.getEvents({
      kinds: [kind],
      authors: [pubkey],
      '#d': [dTag]
    }, relays)
    const manifestEvent = result.sort((left, right) => right.created_at - left.created_at)[0]
    if (!manifestEvent) throw new Error('App manifest not found while discovering icon fallbacks')
    const metadata = await fetchAppMetadata(manifestEvent, relays, {
      blossomServers: blossomServersByAuthor[pubkey] || [],
      cachedIcon,
      forceHtml: true
    })
    return metadata.icon
  })().finally(() => htmlDiscoveryByAppId.delete(appId))
  htmlDiscoveryByAppId.set(appId, request)
  return request
}

export { fetchFileFromChunks, parseIrfsChunk }
