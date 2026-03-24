// Fetches app metadata (name, description, icon) from Nostr relays or Blossom servers

import nostrRelays from '#services/nostr-relays.js'
import { decode as base93Decode } from '#services/base93-decoder.js'
import { extractHtmlMetadata } from '#services/app-metadata.js'

// Deduplicate events by their NIP-01 address (kind:pubkey:d-tag)
// Keep the event with the most recent created_at timestamp
export function deduplicateEvents (events) {
  const eventMap = new Map()

  for (const event of events) {
    // Find the d tag value for this event
    const dTag = event.tags.find(t => t[0] === 'd')
    const dTagValue = dTag ? dTag[1] : ''

    // Create the address as specified in NIP-01
    const address = `${event.kind}:${event.pubkey}:${dTagValue}`

    // If we haven't seen this address before, or if this event is newer, keep it
    const existingEvent = eventMap.get(address)
    if (!existingEvent || event.created_at > existingEvent.created_at) {
      eventMap.set(address, event)
    }
  }

  return [...eventMap.values()]
}

function getServiceFromEvent (event) {
  const serviceTag = event.tags.find(t => t[0] === 'service')
  return serviceTag?.[1] || 'blossom'
}

function normalizePath (path) {
  if (!path) return path
  return path.startsWith('/') ? path.slice(1) : path
}

// Get file metadata from a site manifest event
// Format: ["path", path, hash] — path should have a leading "/" but we normalize without it
function getFileFromManifest (manifestEvent, pathPredicate) {
  const pathTag = manifestEvent.tags.find(t =>
    t[0] === 'path' && t[1] && t[2] && pathPredicate(normalizePath(t[1]))
  )

  if (!pathTag) return null

  return {
    path: normalizePath(pathTag[1]),
    hash: pathTag[2]
  }
}

// Fetch a file from a blossom server given its hash
async function fetchFromBlossom (hash, blossomServers) {
  for (const server of blossomServers) {
    try {
      const url = `${server.replace(/\/$/, '')}/${hash}`
      const response = await fetch(url)
      if (response.ok) return response
    } catch (_err) {
      continue
    }
  }
  return null
}

// Build a blossom URL for a file hash (uses first available server)
function buildBlossomUrl (hash, blossomServers) {
  if (!blossomServers || blossomServers.length === 0) return null
  return `${blossomServers[0].replace(/\/$/, '')}/${hash}`
}

// Fetch and reconstruct a file from its IRFS chunks
async function fetchFileFromChunks (pubkey, fileRootHash, relays, maxSizeBytes = null) {
  // Calculate max chunks to fetch based on size limit
  let maxChunksToFetch = null
  if (maxSizeBytes !== null) {
    maxChunksToFetch = Math.floor(maxSizeBytes / 51000) + 1
  }

  let cTagValues = []
  if (maxChunksToFetch !== null) {
    for (let i = 0; i < maxChunksToFetch; i++) {
      cTagValues.push(`${fileRootHash}:${i}`)
    }
  } else {
    cTagValues = [`${fileRootHash}:0`]
  }

  const { result: chunkEvents } = await nostrRelays.getEvents(
    {
      kinds: [34600],
      authors: [pubkey],
      '#c': cTagValues,
      limit: cTagValues.length
    },
    relays
  )

  if (chunkEvents.length === 0) return null

  const deduplicatedEvents = deduplicateEvents(chunkEvents)

  if (maxSizeBytes !== null) {
    const maxAllowedChunks = maxChunksToFetch - 1
    if (deduplicatedEvents.length >= maxAllowedChunks) {
      console.log(`File exceeds size limit: at least ${deduplicatedEvents.length} chunks > ${maxAllowedChunks} chunks`)
      return null
    }
  }

  let totalChunks = null
  for (const event of deduplicatedEvents) {
    const cTag = event.tags.find(t => t[0] === 'c' && t[1].startsWith(`${fileRootHash}:`))
    if (cTag && cTag.length > 2) {
      totalChunks = cTag[2]
      try {
        totalChunks = parseInt(totalChunks, 10)
        if (isNaN(totalChunks) || totalChunks <= 0) totalChunks = null
      } catch (_err) { totalChunks = null }
      break
    }
  }

  if (totalChunks === null) {
    console.log('Unable to determine total chunk count from chunk events')
    return null
  }

  if (maxChunksToFetch === null && totalChunks !== null) {
    cTagValues = []
    for (let i = 1; i < totalChunks; i++) {
      cTagValues.push(`${fileRootHash}:${i}`)
    }

    const { result: allChunkEvents } = await nostrRelays.getEvents(
      {
        kinds: [34600],
        authors: [pubkey],
        '#c': cTagValues,
        limit: [cTagValues.length]
      },
      relays
    )

    const allDeduplicatedEvents = deduplicateEvents(allChunkEvents)
    deduplicatedEvents.push(...allDeduplicatedEvents)
  }

  const chunks = []
  for (const event of deduplicatedEvents) {
    const cTags = event.tags.filter(t => t[0] === 'c' && t[1])
    for (const cTag of cTags) {
      const [rootHash, indexStr] = cTag[1].split(':')
      if (rootHash === fileRootHash) {
        const index = parseInt(indexStr, 10)
        if (!isNaN(index)) {
          chunks.push({ index, content: event.content })
        }
      }
    }
  }

  if (chunks.length !== totalChunks) {
    console.log(`Missing chunks: expected ${totalChunks} chunks, got ${chunks.length}`)
    return null
  }

  chunks.sort((a, b) => a.index - b.index)

  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].index !== i) {
      console.log(`Non-contiguous chunk indexes: expected index ${i}, got ${chunks[i].index}`)
      return null
    }
  }

  const binaryChunks = chunks.map(chunk => base93Decode(chunk.content))
  return binaryChunks
}

function chunksToText (binaryChunks) {
  const blob = new Blob(binaryChunks, { type: 'text/html' })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(blob)
  })
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

// Fetch a file and convert it to a data URL (IRFS only)
export async function fetchFileDataUrl ({ pubkey, rootHash, relays, mimeType, maxSizeBytes = null }) {
  if (!pubkey || !rootHash || !Array.isArray(relays) || relays.length === 0) {
    return null
  }

  try {
    const chunks = await fetchFileFromChunks(pubkey, rootHash, relays, maxSizeBytes)
    if (!chunks) return null
    return await chunksToDataUrl(chunks, mimeType || 'application/octet-stream')
  } catch (error) {
    console.error('Error fetching file data URL:', error)
    return null
  }
}

// Fetch app metadata from a site manifest event
export async function fetchAppMetadata (manifestEvent, relays, { blossomServers } = {}) {
  const pubkey = manifestEvent.pubkey
  const service = getServiceFromEvent(manifestEvent)
  const metadata = {
    name: null,
    description: null,
    icon: null
  }

  try {
    // Find index.html
    const indexFile = getFileFromManifest(manifestEvent, path =>
      path === 'index.html' || path === 'index.htm'
    )

    if (indexFile) {
      if (service === 'blossom' && blossomServers && blossomServers.length > 0) {
        const response = await fetchFromBlossom(indexFile.hash, blossomServers)
        if (response) {
          const htmlContent = await response.text()
          const extracted = extractHtmlMetadata(htmlContent)
          metadata.name = extracted.name
          metadata.description = extracted.description
        }
      } else {
        // IRFS: reconstruct from chunks
        const indexChunks = await fetchFileFromChunks(pubkey, indexFile.hash, relays)
        if (indexChunks) {
          const htmlContent = await chunksToText(indexChunks)
          const extracted = extractHtmlMetadata(htmlContent)
          metadata.name = extracted.name
          metadata.description = extracted.description
        }
      }
    }

    // Find favicon file
    const faviconFile = getFileFromManifest(manifestEvent, path => {
      const filename = path.split('/').pop()
      return /^favicon\.(ico|svg|webp|png|jpg|jpeg|gif)$/i.test(filename)
    })

    if (faviconFile) {
      if (service === 'blossom' && blossomServers && blossomServers.length > 0) {
        const url = buildBlossomUrl(faviconFile.hash, blossomServers)
        if (url) {
          metadata.icon = { fx: faviconFile.hash, url }
        }
      } else {
        // IRFS: reconstruct from chunks
        const MAX_ICON_SIZE = 5.5 * 1024 * 1024
        const faviconChunks = await fetchFileFromChunks(
          pubkey,
          faviconFile.hash,
          relays,
          MAX_ICON_SIZE
        )

        if (faviconChunks) {
          const ext = faviconFile.path.split('.').pop()?.toLowerCase()
          const mimeType = { ico: 'image/x-icon', svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[ext] || 'image/png'
          const dataUrl = await chunksToDataUrl(faviconChunks, mimeType)
          metadata.icon = { fx: faviconFile.hash, url: dataUrl }
        }
      }
    }
  } catch (error) {
    console.error('Error fetching app metadata:', error)
  }

  return metadata
}
