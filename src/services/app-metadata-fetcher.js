import NMMR from 'nmmr'
import { bytesToBase16 } from 'libp2r2p/base16'
import { decode as base93Decode } from 'libp2r2p/base93'
import { appDecode } from 'libp2r2p/nip19'
import {
  isValidPublicBlossomServerUrl,
  isValidPublicRelayUrl,
  normalizeBlossomServerUrl,
  normalizeRelayUrl
} from 'libp2r2p/url'
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
  getManifestMetadata,
  getPreferredManifestIconAssets
} from '#helpers/manifest.js'
import { isRenderableAppIconUrl } from '#helpers/app-icon.js'
import { getAppIconLogPrefix } from '#helpers/app.js'

const CHUNK_BYTES = 51000
const QUERY_BATCH_SIZE = 100
const DEFAULT_METADATA_FILE_LIMIT = 5.5 * 1024 * 1024
const BLOSSOM_PROBE_TIMEOUT_MS = 2000
const BLOSSOM_FETCH_TIMEOUT_MS = 6000
const BLOSSOM_FETCH_BUDGET_MS = 8000
const BLOSSOM_HEDGE_DELAY_MS = 750
const ICON_PRIORITY = Object.freeze({
  MARKED: 0,
  HTML: 100,
  CONVENTIONAL: 200,
  SOCIAL: 300
})
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

async function queryChunkBatch ({ pubkey, root, indexes, relays, signal }) {
  const dByIndex = new Map(indexes.map(index => [index, NMMR.deriveChunkId(root, index)]))
  const { result: events } = await nostrRelays.getEvents({
    kinds: [34601],
    authors: [pubkey],
    '#d': [...dByIndex.values()],
    limit: indexes.length
  }, relays, { signal })
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
async function fetchFileFromChunks (pubkey, root, relays, { maxSizeBytes = null, size = null, signal } = {}) {
  if (!/^[0-9a-f]{64}$/.test(root)) return null
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const advertisedSize = Number.isSafeInteger(size) && size >= 0 ? size : null

  const first = await queryChunkBatch({ pubkey, root, indexes: [0], relays, signal })
  const firstChunk = first.get(0)
  if (!firstChunk) return null
  const total = firstChunk.total
  const minimumSize = ((total - 1) * CHUNK_BYTES) + 1
  if (!Number.isSafeInteger(minimumSize) || (maxSizeBytes !== null && minimumSize > maxSizeBytes)) return null

  const chunks = new Array(total)
  chunks[0] = firstChunk.contentBytes
  for (let offset = 1; offset < total; offset += QUERY_BATCH_SIZE) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const end = Math.min(total, offset + QUERY_BATCH_SIZE)
    const indexes = Array.from({ length: end - offset }, (_, index) => offset + index)
    const batch = await queryChunkBatch({ pubkey, root, indexes, relays, signal })
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

async function fetchWithTimeout (url, { signal, timeoutMs, ...options } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// Waits before starting a fallback request and cancels the delay with its phase.
function waitWithSignal (delayMs, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// Downloads and validates one Blossom asset within a timeout that includes its body.
async function fetchBlossomBytes (asset, server, maxSizeBytes, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), BLOSSOM_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${server}/${asset.root}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`Blossom GET returned ${response.status}`)
    const bytes = await readResponseBytes(response, maxSizeBytes)
    if (!bytes || await sha256Hex(bytes) !== asset.root) throw new Error('Invalid Blossom asset')
    return bytes
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// Puts a responsive server first without waiting for an earlier dead host.
export async function rankBlossomServers (asset, blossomServers, {
  signal,
  timeoutMs = BLOSSOM_PROBE_TIMEOUT_MS
} = {}) {
  const servers = [...new Set((blossomServers || []).flatMap(server => {
    try { return [normalizeBlossomServerUrl(server)] } catch (_) { return [] }
  }))]
  if (servers.length < 2) return servers

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const winner = await Promise.any(servers.map(async server => {
      const response = await fetchWithTimeout(`${server}/${asset.root}`, {
        method: 'HEAD',
        signal: controller.signal,
        timeoutMs
      })
      if (!response.ok) throw new Error(`Blossom HEAD returned ${response.status}`)
      return server
    }))
    controller.abort()
    return [winner, ...servers.filter(server => server !== winner)]
  } catch (_error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return servers
  } finally {
    controller.abort()
    signal?.removeEventListener('abort', onAbort)
  }
}

async function fetchFromBlossom (asset, blossomServers, maxSizeBytes = null, signal) {
  const servers = await rankBlossomServers(asset, blossomServers, { signal })
  if (!servers.length) return null

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), BLOSSOM_FETCH_BUDGET_MS)
  try {
    const bytes = await Promise.any(servers.map(async (server, index) => {
      await waitWithSignal(index * BLOSSOM_HEDGE_DELAY_MS, controller.signal)
      return fetchBlossomBytes(asset, server, maxSizeBytes, controller.signal)
    }))
    warnSizeMismatch('blossom', asset.root, asset.size, bytes.length)
    return bytes
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  } finally {
    clearTimeout(timer)
    controller.abort()
    signal?.removeEventListener('abort', onAbort)
  }
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
export async function fetchFileDataUrl ({
  pubkey, rootHash, relays, mimeType, size = null, maxSizeBytes = null, signal
}) {
  if (!pubkey || !rootHash || !Array.isArray(relays) || !relays.length) return null
  try {
    const chunks = await fetchFileFromChunks(pubkey, rootHash, relays, { maxSizeBytes, size, signal })
    return chunks ? chunksToDataUrl(chunks, mimeType || 'application/octet-stream') : null
  } catch (error) {
    if (signal?.aborted) throw error
    console.error('Error fetching file data URL:', error)
    return null
  }
}

async function assetBytes (asset, pubkey, relays, blossomServers, maxSizeBytes, signal) {
  if (asset.service === 'blossom') {
    const bytes = await fetchFromBlossom(asset, blossomServers, maxSizeBytes, signal)
    return bytes ? [bytes] : null
  }
  return fetchFileFromChunks(pubkey, asset.root, relays, { maxSizeBytes, size: asset.size, signal })
}

function manifestHints (manifestEvent, tagName) {
  return (Array.isArray(manifestEvent?.tags) ? manifestEvent.tags : [])
    .filter(tag => Array.isArray(tag) && tag[0] === tagName && typeof tag[1] === 'string')
    .flatMap(tag => {
      try {
        if (tagName === 'relay') {
          return isValidPublicRelayUrl(tag[1]) ? [normalizeRelayUrl(tag[1])] : []
        }
        return isValidPublicBlossomServerUrl(tag[1]) ? [normalizeBlossomServerUrl(tag[1])] : []
      } catch (_) {
        return []
      }
    })
}

// Adds an asset entry once while preserving discovery order.
function addAssetEntry (entries, seenAssets, asset, source = 'manifest', priority = ICON_PRIORITY.CONVENTIONAL) {
  if (!asset) return
  const key = `${asset.service}:${asset.root}`
  if (seenAssets.has(key)) return
  seenAssets.add(key)
  entries.push({ asset, source, priority })
}

// Resolves every usable icon URL while preserving asset and server priority.
async function resolveIconCandidates (
  entries,
  manifestEvent,
  relays,
  blossomServers,
  cachedIcon,
  signal,
  logPrefix
) {
  const candidates = []
  const seenUrls = new Set()
  const cachedCandidates = normalizeCachedIconCandidates(cachedIcon)
  const firstBlossomAsset = entries.find(entry => entry.asset?.service === 'blossom')?.asset
  let orderedBlossomServers = blossomServers
  if (firstBlossomAsset) {
    const cached = cachedCandidates.find(candidate => candidate.fx === firstBlossomAsset.root)
    const cachedServer = blossomServers.find(server =>
      cached?.url === `${server}/${firstBlossomAsset.root}`
    )
    orderedBlossomServers = cachedServer
      ? [cachedServer, ...blossomServers.filter(server => server !== cachedServer)]
      : await rankBlossomServers(firstBlossomAsset, blossomServers, { signal })
  }
  for (const entry of entries) {
    if (entry.candidate) {
      if (!seenUrls.has(entry.candidate.url)) {
        seenUrls.add(entry.candidate.url)
        candidates.push({ ...entry.candidate, source: entry.source, priority: entry.priority })
      }
      continue
    }

    const { asset, source, priority } = entry
    if (asset.service === 'blossom') {
      for (const server of orderedBlossomServers) {
        const url = `${server}/${asset.root}`
        if (seenUrls.has(url)) continue
        seenUrls.add(url)
        candidates.push({ fx: asset.root, url, source, priority })
      }
      continue
    }

    try {
      const cached = cachedCandidates.find(candidate => candidate.fx === asset.root)
      if (cached && !seenUrls.has(cached.url)) {
        seenUrls.add(cached.url)
        candidates.push({ ...cached, source, priority })
        continue
      }
      const chunks = await fetchFileFromChunks(manifestEvent.pubkey, asset.root, relays, {
        maxSizeBytes: DEFAULT_METADATA_FILE_LIMIT,
        size: asset.size,
        signal
      })
      if (!chunks) continue
      const mimeType = asset.mimeType || 'image/png'
      const url = await chunksToDataUrl(chunks, mimeType)
      if (!seenUrls.has(url)) {
        seenUrls.add(url)
        candidates.push({ fx: asset.root, url, source, priority })
      }
    } catch (error) {
      if (signal?.aborted) throw error
      console.error(`${logPrefix} Failed to resolve icon asset ${asset.root}:`, error)
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
  blossomServers,
  signal,
  logPrefix
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
          DEFAULT_METADATA_FILE_LIMIT,
          signal
        )
        if (!bytes) continue
        for (const icon of extractWebManifestIcons(chunksToText(bytes))) {
          const iconPath = resolveAppPath(icon.href, path)
          const iconAsset = iconPath && findManifestPathAsset(manifestEvent, candidate => candidate === iconPath)
          if (iconAsset) {
            addAssetEntry(entries, seenAssets, iconAsset, 'html', ICON_PRIORITY.HTML + source.priority)
          } else {
            const url = resolveExternalImageUrl(icon.href)
            if (url) {
              entries.push({
                candidate: { fx: null, url },
                source: 'html',
                priority: ICON_PRIORITY.HTML + source.priority
              })
            }
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error
        console.error(`${logPrefix} Failed to read Web App Manifest icons:`, error)
      }
      continue
    }

    if (asset) {
      const basePriority = ['tile-image', 'social-image'].includes(source.kind)
        ? ICON_PRIORITY.SOCIAL
        : ICON_PRIORITY.HTML
      addAssetEntry(entries, seenAssets, asset, 'html', basePriority + source.priority)
      continue
    }
    const url = resolveExternalImageUrl(source.href, htmlMetadata.baseHref)
    if (url) {
      const basePriority = ['tile-image', 'social-image'].includes(source.kind)
        ? ICON_PRIORITY.SOCIAL
        : ICON_PRIORITY.HTML
      entries.push({
        candidate: { fx: null, url },
        source: 'html',
        priority: basePriority + source.priority
      })
    }
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
      source: candidate.source === 'html' ? 'html' : 'manifest',
      priority: Number.isFinite(candidate.priority)
        ? candidate.priority
        : candidate.source === 'html' ? ICON_PRIORITY.HTML : ICON_PRIORITY.CONVENTIONAL
    }]
  })
}

function mergeCandidates (...groups) {
  const seen = new Set()
  return groups.flat()
    .filter(candidate => {
      if (!isRenderableAppIconUrl(candidate?.url) || seen.has(candidate.url)) return false
      seen.add(candidate.url)
      return true
    })
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => left.candidate.priority - right.candidate.priority || left.index - right.index)
    .map(({ candidate }) => candidate)
}

// Keeps the primary icon shape compatible while recording discovery freshness.
function createIconMetadata (candidates, manifestEvent, indexAsset, htmlDiscovered, htmlMetadata) {
  const first = candidates[0] || { fx: null, url: null }
  return {
    fx: first.fx,
    url: first.url,
    ...(first.source ? { source: first.source } : {}),
    ...(Number.isFinite(first.priority) ? { priority: first.priority } : {}),
    candidates,
    manifestEventId: manifestEvent.id || null,
    htmlRoot: indexAsset?.root || null,
    htmlDiscovered,
    htmlName: htmlMetadata?.name,
    htmlDescription: htmlMetadata?.description
  }
}

// Missing listing metadata keeps HTML discovery relevant even when a direct icon exists.
export function needsHtmlMetadataFallback (metadata) {
  return !metadata?.icon?.url || !metadata?.name || !metadata?.description
}

// Reads direct metadata first and discovers HTML only when it is needed.
export async function fetchAppMetadata (manifestEvent, relays, {
  blossomServers,
  cachedIcon = null,
  forceHtml = false,
  skipHtml = false,
  signal,
  appId = null
} = {}) {
  const logPrefix = getAppIconLogPrefix(appId)
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
  const manifestAssets = getPreferredManifestIconAssets(manifestEvent)
  const entries = []
  const seenAssets = new Set()
  const iconWasAutomaticallySelected = manifestEvent.tags?.some(tag =>
    Array.isArray(tag) && tag[0] === 'auto' && tag[1] === 'icon'
  )
  for (const asset of manifestAssets) {
    const priority = !iconWasAutomaticallySelected && asset.marks.includes('icon')
      ? ICON_PRIORITY.MARKED
      : ICON_PRIORITY.CONVENTIONAL
    addAssetEntry(entries, seenAssets, asset, 'manifest', priority)
  }

  let directCandidates = []
  try {
    directCandidates = await resolveIconCandidates(
      entries,
      manifestEvent,
      effectiveRelays,
      effectiveBlossomServers,
      cachedIcon,
      signal,
      logPrefix
    )
  } catch (error) {
    if (signal?.aborted) throw error
    console.error(`${logPrefix} Error resolving manifest icon candidates:`, error)
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
  const shouldReadHtml = !skipHtml && (forceHtml || !metadata.name || !metadata.description || manifestAssets.length === 0)

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
          DEFAULT_METADATA_FILE_LIMIT,
          signal
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
            blossomServers: effectiveBlossomServers,
            signal,
            logPrefix
          }
          await addHtmlIconEntries({ ...sourceOptions, sources: specificSources })
          await addHtmlIconEntries({ ...sourceOptions, sources: socialSources })
          htmlCandidates = await resolveIconCandidates(
            htmlEntries,
            manifestEvent,
            effectiveRelays,
            effectiveBlossomServers,
            cachedIcon,
            signal,
            logPrefix
          )
          htmlDiscovered = true
        }
      } catch (error) {
        if (signal?.aborted) throw error
        console.error(`${logPrefix} Error fetching HTML app metadata:`, error)
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
  signal,
  _getRelaysByPubkey = getRelaysByPubkey,
  _getBlossomServersByPubkey = getBlossomServersByPubkey,
  _nostrRelays = nostrRelays
} = {}) {
  if (htmlDiscoveryByAppId.has(appId)) return htmlDiscoveryByAppId.get(appId)
  const request = (async () => {
    const { dTag, pubkey, kind } = appDecode(appId)
    const relaysByAuthor = await _getRelaysByPubkey([pubkey])
    const blossomServersByAuthor = await _getBlossomServersByPubkey([pubkey], {
      _getRelaysByPubkey: async () => relaysByAuthor
    })
    const relays = [...new Set([
      ...(relaysByAuthor[pubkey]?.write || []),
      ...nappRelays
    ])]
    const { result } = await _nostrRelays.getEvents({
      kinds: [kind],
      authors: [pubkey],
      '#d': [dTag]
    }, relays, { signal })
    const manifestEvent = result.sort((left, right) => right.created_at - left.created_at)[0]
    if (!manifestEvent) throw new Error('App manifest not found while discovering icon fallbacks')
    const metadata = await fetchAppMetadata(manifestEvent, relays, {
      blossomServers: blossomServersByAuthor[pubkey] || [],
      cachedIcon,
      forceHtml: true,
      signal,
      appId
    })
    return metadata.icon
  })().finally(() => htmlDiscoveryByAppId.delete(appId))
  htmlDiscoveryByAppId.set(appId, request)
  return request
}

export { fetchFileFromChunks, parseIrfsChunk }
