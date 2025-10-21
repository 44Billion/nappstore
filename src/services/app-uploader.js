// Handles app upload to Nostr relays

import NMMR from 'nmmr'
import Base93Encoder from '#services/base93-encoder.js'
import nostrRelays from '#services/nostr-relays.js'
import { getRelays } from '#helpers/nostr/queries.js'
import { maybePeekPublicKey } from '#helpers/nostr/nip07.js'
import { isNostrAppDTagSafe, deriveNostrAppDTag } from '#helpers/app.js'

const PRIMAL_RELAY = 'wss://relay.primal.net'
const CHUNK_SIZE = 51000

// Stream file to chunks
async function * streamToChunks (stream, chunkSize) {
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      let offset = 0
      while (offset < value.length) {
        const chunk = value.slice(offset, offset + chunkSize)
        offset += chunkSize
        yield chunk
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function getDTag (fileList, folderName) {
  folderName ??= fileList[0].webkitRelativePath.split('/')[0].trim()
  if (isNostrAppDTagSafe(folderName)) return folderName

  return deriveNostrAppDTag(folderName || Math.random().toString(36))
}

// Upload app files to Nostr
export async function uploadApp (fileList, dTag, onProgress) {
  dTag ??= await getDTag(fileList)

  if (!window.nostr) {
    throw new Error('Nostr signer not available')
  }

  const signer = window.nostr
  const pubkey = await maybePeekPublicKey(signer)

  // Get user's write relays
  let writeRelays
  try {
    const relays = await getRelays(pubkey)
    writeRelays = relays.write || []
  } catch (err) {
    console.log('Error getting relays:', err)
    writeRelays = []
  }

  // Add Primal relay if not already there
  if (!writeRelays.includes(PRIMAL_RELAY)) {
    writeRelays.push(PRIMAL_RELAY)
  }

  if (writeRelays.length === 0) {
    throw new Error('No write relays found')
  }

  const fileMetadata = []
  let fileIndex = 0
  const totalFiles = fileList.length

  for (const file of fileList) {
    fileIndex++
    onProgress({ filesProgress: fileIndex, totalFiles, chunkProgress: 0 })

    const filename = file.webkitRelativePath?.split('/').slice(1).join('/') || file.name
    const mimeType = file.type || 'application/octet-stream'

    const fileMetadataEntry = await uploadFileWithNMMR({
      file,
      filename,
      mimeType,
      signer,
      writeRelays,
      onProgress: (chunkProgress) => {
        onProgress({ filesProgress: fileIndex, totalFiles, chunkProgress })
      }
    })

    fileMetadata.push(fileMetadataEntry)
  }

  // Upload bundle
  await uploadBundle({
    dTag,
    fileMetadata,
    signer,
    writeRelays
  })

  return { dTag, fileMetadata }
}

// Upload file using NMMR for proper Merkle tree hashing
async function uploadFileWithNMMR ({ file, filename, mimeType, signer, writeRelays, onProgress }) {
  const nmmr = new NMMR()
  const stream = file.stream()

  // Read file and build NMMR tree
  let chunkCount = 0
  for await (const chunk of streamToChunks(stream, CHUNK_SIZE)) {
    nmmr.append(chunk)
    chunkCount++
  }

  if (chunkCount === 0) {
    throw new Error(`File ${filename} is empty`)
  }

  // Get root hash
  const rootHash = nmmr.getRoot()

  // Upload each chunk
  let currentChunkIndex = 0
  for await (const chunk of nmmr.getChunks()) {
    currentChunkIndex++
    onProgress(Math.round((currentChunkIndex / chunkCount) * 100))

    const dTag = chunk.x
    const currentCtag = `${chunk.rootX}:${chunk.index}`

    // Get previous ctags for this file
    const { otherCtags } = await getPreviousCtags(dTag, currentCtag, writeRelays, signer)

    const encoded = new Base93Encoder().update(chunk.contentBytes).getEncoded()

    const event = {
      kind: 34600,
      tags: [
        ['d', dTag],
        ...otherCtags,
        ['c', currentCtag, chunk.length, ...chunk.proof],
        ...(mimeType ? [['m', mimeType]] : [])
      ],
      content: encoded,
      created_at: Math.floor(Date.now() / 1000)
    }

    const signedEvent = await signer.signEvent(event)
    await sendEventToRelays(signedEvent, writeRelays, 10000)
  }

  return {
    rootHash,
    filename,
    mimeType
  }
}

// Get previous ctags for a file
async function getPreviousCtags (dTagValue, currentCtagValue, writeRelays, signer) {
  try {
    const pubkey = await maybePeekPublicKey(signer)
    const { result: storedEvents } = await nostrRelays.getEvents({
      kinds: [34600],
      authors: [pubkey],
      '#d': [dTagValue],
      limit: 1
    }, writeRelays)

    if (storedEvents.length === 0) {
      return { otherCtags: [], hasCurrentCtag: false }
    }

    const cTagValues = { [currentCtagValue]: true }
    const prevTags = storedEvents.sort((a, b) => b.created_at - a.created_at)[0].tags || []

    const hasCurrentCtag = prevTags.some(tag =>
      Array.isArray(tag) && tag[0] === 'c' && tag[1] === currentCtagValue
    )

    const otherCtags = prevTags.filter(v => {
      const isCTag = Array.isArray(v) && v[0] === 'c' && typeof v[1] === 'string' && /^[0-9a-f]{64}:\d+$/.test(v[1])
      if (!isCTag) return false

      const isntDuplicate = !cTagValues[v[1]]
      cTagValues[v[1]] = true
      return isntDuplicate
    })

    return { otherCtags, hasCurrentCtag }
  } catch (err) {
    console.log('Error getting previous ctags:', err)
    return { otherCtags: [], hasCurrentCtag: false }
  }
}

// Send event to relays
async function sendEventToRelays (event, relays, timeout) {
  const { errors, success } = await nostrRelays.sendEvent(event, relays, timeout)

  if (errors.length > 0) {
    console.log(`Errors publishing to relays: ${errors.map(e => `${e.relay}: ${e.reason?.message || e.reason}`).join(', ')}`)
  }

  if (!success) {
    throw new Error(`Failed to publish to any relays: ${errors.map(e => `${e.relay}: ${e.reason?.message || e.reason}`).join(', ')}`)
  }
}

// Upload bundle metadata
async function uploadBundle ({ dTag, fileMetadata, signer, writeRelays }) {
  const bundle = {
    kind: 37448,
    tags: [
      ['d', dTag],
      ...fileMetadata.map(f => ['file', f.rootHash, f.filename, f.mimeType])
    ],
    content: '',
    created_at: Math.floor(Date.now() / 1000)
  }

  const signedBundle = await signer.signEvent(bundle)
  await sendEventToRelays(signedBundle, writeRelays, 10000)
}
