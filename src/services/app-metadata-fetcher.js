// Fetches app metadata (name, description, icon) from Nostr relays by reconstructing files from chunks

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

// Fetch and reconstruct a file from its chunks
async function fetchFileFromChunks (pubkey, fileRootHash, relays, maxSizeBytes = null) {
  // Calculate max chunks to fetch based on size limit
  let maxChunksToFetch = null
  if (maxSizeBytes !== null) {
    // Calculate how many chunks we can afford (each chunk is ~51000 bytes)
    // We'll fetch one extra chunk to determine if there are more chunks than allowed
    maxChunksToFetch = Math.floor(maxSizeBytes / 51000) + 1
  }

  // Create array of c tag values to fetch
  // Format: ["rootHash:0", "rootHash:1", ..., "rootHash:maxChunksToFetch-1"]
  let cTagValues = []
  if (maxChunksToFetch !== null) {
    // Fetch specific range of chunks
    for (let i = 0; i < maxChunksToFetch; i++) {
      cTagValues.push(`${fileRootHash}:${i}`)
    }
  } else {
    // If no size limit, fetch first chunk to determine total count
    cTagValues = [`${fileRootHash}:0`]
  }

  // Fetch chunk events for this file using c tag filtering
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

  // Deduplicate events by their NIP-01 address
  const deduplicatedEvents = deduplicateEvents(chunkEvents)

  // Check if we have more chunks than allowed based on maxSizeBytes
  // This check should be done early to avoid unnecessary processing
  if (maxSizeBytes !== null) {
    const maxAllowedChunks = maxChunksToFetch - 1

    // If we fetched maxChunksToFetch and got that many chunks, the file is too large
    if (deduplicatedEvents.length >= maxAllowedChunks) {
      console.log(`File exceeds size limit: at least ${deduplicatedEvents.length} chunks > ${maxAllowedChunks} chunks (${deduplicatedEvents.length * 51000} bytes > ${maxSizeBytes} bytes)`)
      return null
    }
  }

  // Extract total chunk count from any chunk's c tag (third element)
  let totalChunks = null
  for (const event of deduplicatedEvents) {
    const cTag = event.tags.find(t => t[0] === 'c' && t[1].startsWith(`${fileRootHash}:`))
    if (cTag && cTag.length > 2) {
      totalChunks = cTag[2] // Third element contains the total number of chunks
      try {
        totalChunks = parseInt(totalChunks, 10)
        if (isNaN(totalChunks) || totalChunks <= 0) totalChunks = null
      } catch (_err) { totalChunks = null }
      break
    }
  }

  // Validate that we have the total chunk count
  if (totalChunks === null) {
    console.log('Unable to determine total chunk count from chunk events')
    return null
  }

  // If we only fetched the first chunk to determine count, now fetch all chunks
  if (maxChunksToFetch === null && totalChunks !== null) {
    // Now fetch all chunks
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

    // Deduplicate all events
    const allDeduplicatedEvents = deduplicateEvents(allChunkEvents)
    deduplicatedEvents.push(...allDeduplicatedEvents)
  }

  // Sort chunks by their c tag (format: "rootHash:index")
  // Extract all c tags and sort by index
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

  // Validate that all chunks are present (contiguous from 0 to totalChunks-1)
  if (chunks.length !== totalChunks) {
    console.log(`Missing chunks: expected ${totalChunks} chunks, got ${chunks.length}`)
    return null
  }

  // Sort by index
  chunks.sort((a, b) => a.index - b.index)

  // Validate that chunk indexes are contiguous
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].index !== i) {
      console.log(`Non-contiguous chunk indexes: expected index ${i}, got ${chunks[i].index}`)
      return null
    }
  }

  // Decode chunks from base93
  const binaryChunks = chunks.map(chunk => base93Decode(chunk.content))
  return binaryChunks
}

// Convert binary chunks to text
function chunksToText (binaryChunks) {
  const blob = new Blob(binaryChunks, { type: 'text/html' })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(blob)
  })
}

// Convert binary chunks to data URL
function chunksToDataUrl (binaryChunks, mimeType) {
  const blob = new Blob(binaryChunks, { type: mimeType })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Get file metadata from bundle event
function getFileFromBundle (bundleEvent, filenamePredicate) {
  const fileTag = bundleEvent.tags.find(t =>
    t[0] === 'file' && t[1] && t[2] && filenamePredicate(t[2])
  )

  if (!fileTag) return null

  return {
    rootHash: fileTag[1],
    filename: fileTag[2],
    mimeType: fileTag[3] || 'application/octet-stream'
  }
}

// Fetch app metadata from relays
export async function fetchAppMetadata (bundleEvent, relays) {
  const pubkey = bundleEvent.pubkey
  const metadata = {
    name: null,
    description: null,
    icon: null
  }

  try {
    // Find index.html file
    const indexFile = getFileFromBundle(bundleEvent, filename =>
      filename === 'index.html' || filename === 'index.htm'
    )

    if (indexFile) {
      // Fetch and reconstruct index.html
      const indexChunks = await fetchFileFromChunks(pubkey, indexFile.rootHash, relays)

      if (indexChunks) {
        const htmlContent = await chunksToText(indexChunks)
        const extracted = extractHtmlMetadata(htmlContent)

        metadata.name = extracted.name
        metadata.description = extracted.description
      }
    }

    // Find favicon file
    const faviconFile = getFileFromBundle(bundleEvent, filename =>
      /^favicon\.(ico|svg|webp|png|jpg|jpeg|gif)$/i.test(filename)
    )

    if (faviconFile) {
      // Fetch and reconstruct favicon with 5.5MB size limit
      const MAX_ICON_SIZE = 5.5 * 1024 * 1024 // 5.5MB
      const faviconChunks = await fetchFileFromChunks(
        pubkey,
        faviconFile.rootHash,
        relays,
        MAX_ICON_SIZE
      )

      if (faviconChunks) {
        const dataUrl = await chunksToDataUrl(faviconChunks, faviconFile.mimeType)
        metadata.icon = { fx: faviconFile.rootHash, url: dataUrl }
      }
    }
  } catch (error) {
    console.error('Error fetching app metadata:', error)
  }

  return metadata
}
