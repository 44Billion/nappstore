// Handles app upload to Nostr relays

import NMMR from 'nmmr'
import Base93Encoder from '#services/base93-encoder.js'
import nostrRelays from '#services/nostr-relays.js'
import { getRelays } from '#helpers/nostr/queries.js'
import { maybePeekPublicKey } from '#helpers/nostr/nip07.js'
import { isNostrAppDTagSafe, deriveNostrAppDTag } from '#helpers/app.js'
import { extractHtmlMetadata, findFavicon, findIndexFile } from '#services/app-metadata.js'

const PRIMAL_RELAY = 'wss://relay.primal.net'
const CHUNK_SIZE = 51000
const RATE_LIMIT_BACKOFF_STEP = 2000
const MAX_UPLOAD_RETRIES = 5

// Receives a stream and yields Uint8Array binary chunks of a given size.
// The last chunk may be smaller than the chunkSize.
async function * streamToChunks (stream, chunkSize) {
  let buffer = new Uint8Array(0)

  for await (const chunk of stream) {
    const newBuffer = new Uint8Array(buffer.length + chunk.length)
    newBuffer.set(buffer)
    newBuffer.set(chunk, buffer.length)
    buffer = newBuffer

    while (buffer.length >= chunkSize) {
      const chunkToYield = buffer.slice(0, chunkSize)
      buffer = buffer.slice(chunkSize)
      yield chunkToYield
    }
  }

  if (buffer.length > 0) yield buffer
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export async function getDTag (fileList, folderName) {
  folderName ??= fileList[0].webkitRelativePath.split('/')[0].trim()
  if (isNostrAppDTagSafe(folderName)) return folderName

  return deriveNostrAppDTag(folderName || Math.random().toString(36))
}

// Upload app files to Nostr
export async function uploadApp (fileList, dTag, onProgress, stallOptions = {}) {
  dTag ??= await getDTag(fileList)

  if (!window.nostr) {
    throw new Error('Nostr signer not available')
  }

  const signer = window.nostr
  const pubkey = await maybePeekPublicKey(signer)

  let writeRelays
  try {
    const relays = await getRelays(pubkey)
    writeRelays = relays.write || []
  } catch (err) {
    console.log('Error getting relays:', err)
    writeRelays = []
  }

  if (!writeRelays.includes(PRIMAL_RELAY)) {
    writeRelays.push(PRIMAL_RELAY)
  }

  if (writeRelays.length === 0) {
    throw new Error('No write relays found')
  }

  const resolveRelativePath = (file) => file.webkitRelativePath?.split('/').slice(1).join('/') || file.name

  let stallName = typeof stallOptions.name === 'string' ? stallOptions.name.trim() : undefined
  let stallSummary = typeof stallOptions.summary === 'string' ? stallOptions.summary.trim() : undefined

  const needsHtmlExtraction = !stallName || !stallSummary
  if (needsHtmlExtraction) {
    const indexFile = findIndexFile(fileList)
    if (indexFile) {
      try {
        const htmlContent = await indexFile.text()
        const { name, description } = extractHtmlMetadata(htmlContent)
        if (!stallName && name) stallName = name.trim()
        if (!stallSummary && description) stallSummary = description.trim()
      } catch (err) {
        console.log('Error extracting HTML metadata for stall event:', err)
      }
    }
  }

  let iconRelativePath = typeof stallOptions.iconRelativePath === 'string'
    ? stallOptions.iconRelativePath.trim()
    : null

  if (!iconRelativePath) {
    const faviconFile = findFavicon(fileList)
    if (faviconFile) {
      iconRelativePath = resolveRelativePath(faviconFile)
    }
  }

  let iconMetadata

  const totalFiles = fileList.length
  const progressState = {
    filesProgress: 0,
    totalFiles,
    chunkProgress: 0,
    status: ''
  }
  // Maintain a single progress object so UI keeps previous fields when only one changes.
  const reportProgress = (patch = {}) => {
    if (typeof onProgress !== 'function') return
    Object.assign(progressState, patch)
    onProgress({ ...progressState })
  }
  reportProgress({ totalFiles })

  const throttleState = { pause: 0 }
  const fileMetadata = []
  let fileIndex = 0

  for (const file of fileList) {
    fileIndex++
    const filename = resolveRelativePath(file)
    const mimeType = file.type || 'application/octet-stream'

    reportProgress({
      filesProgress: fileIndex,
      chunkProgress: 0,
      status: `Preparing "${filename}"`
    })

    const fileMetadataEntry = await uploadFileWithNMMR({
      file,
      filename,
      mimeType,
      signer,
      writeRelays,
      reportProgress,
      throttleState
    })

    fileMetadata.push(fileMetadataEntry)
    if (!iconMetadata && iconRelativePath && filename === iconRelativePath) {
      iconMetadata = {
        rootHash: fileMetadataEntry.rootHash,
        mimeType: fileMetadataEntry.mimeType
      }
    }
    reportProgress({ status: `Uploaded "${filename}"` })
  }

  await maybeUploadStall({
    dTag,
    name: stallName,
    summary: stallSummary,
    icon: iconMetadata,
    signer,
    writeRelays,
    throttleState,
    reportProgress
  })

  reportProgress({ status: 'Publishing bundle metadata...' })

  await uploadBundle({
    dTag,
    fileMetadata,
    signer,
    writeRelays,
    throttleState,
    reportProgress
  })

  reportProgress({ status: 'Upload complete' })

  return { dTag, fileMetadata }
}

// Upload file using NMMR for proper Merkle tree hashing
async function uploadFileWithNMMR ({ file, filename, mimeType, signer, writeRelays, reportProgress, throttleState }) {
  const nmmr = new NMMR()
  const stream = file.stream()

  // Read file and build NMMR tree
  let chunkCount = 0
  for await (const chunk of streamToChunks(stream, CHUNK_SIZE)) {
    await nmmr.append(chunk)
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
    if (IS_DEVELOPMENT) console.log(`Uploading: [${currentChunkIndex}/${chunkCount}] ${filename}`)
    const chunkPercent = Math.round((currentChunkIndex / chunkCount) * 100)
    reportProgress?.({ chunkProgress: chunkPercent, status: `Uploading chunk ${currentChunkIndex}/${chunkCount} for "${filename}"` })

    const dTag = chunk.x
    const currentCtag = `${chunk.rootX}:${chunk.index}`

    // Get previous ctags for this file
    const { otherCtags, hasCurrentCtag } = await getPreviousCtags(dTag, currentCtag, writeRelays, signer)

    if (hasCurrentCtag) {
      reportProgress?.({ chunkProgress: chunkPercent, status: `Chunk ${currentChunkIndex}/${chunkCount} already uploaded, skipping "${filename}"` })
      continue
    }

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
    await sendEventToRelays(signedEvent, writeRelays, {
      timeout: 15000,
      throttleState,
      reportStatus: status => reportProgress?.({ status: `${status} (${filename})` })
    })
    reportProgress?.({ chunkProgress: chunkPercent, status: `Uploaded chunk ${currentChunkIndex}/${chunkCount} for "${filename}"` })
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

// Fetch most recent stall event for this app, if any
async function getPreviousStall (dTagValue, writeRelays, signer) {
  try {
    const pubkey = await maybePeekPublicKey(signer)
    const { result: storedEvents } = await nostrRelays.getEvents({
      kinds: [37348],
      authors: [pubkey],
      '#d': [dTagValue],
      limit: 1
    }, writeRelays)

    if (storedEvents.length === 0) return null

    if (storedEvents.length > 1) {
      storedEvents.sort((a, b) => b.created_at - a.created_at)
    }

    return storedEvents[0]
  } catch (err) {
    console.log('Error getting previous stall:', err)
    return null
  }
}

async function maybeUploadStall ({
  dTag,
  name,
  summary,
  icon,
  signer,
  writeRelays,
  throttleState,
  reportProgress
}) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const trimmedSummary = typeof summary === 'string' ? summary.trim() : ''
  const iconRootHash = icon?.rootHash
  const iconMimeType = icon?.mimeType
  const hasMetadata = Boolean(trimmedName) || Boolean(trimmedSummary) || Boolean(iconRootHash)
  const previous = await getPreviousStall(dTag, writeRelays, signer)
  if (!previous && !hasMetadata) return false

  const publishStall = async (event) => {
    reportProgress?.({ status: 'Publishing stall metadata...' })
    const signedEvent = await signer.signEvent(event)
    await sendEventToRelays(signedEvent, writeRelays, {
      timeout: 15000,
      throttleState,
      reportStatus: status => reportProgress?.({ status })
    })
    return true
  }

  const createdAt = Math.floor(Date.now() / 1000)

  if (!previous) {
    const tags = [
      ['d', dTag],
      ['c', '*']
    ]

    let hasIcon = false
    let hasName = false
    if (iconRootHash && iconMimeType) {
      hasIcon = true
      tags.push(['icon', iconRootHash, iconMimeType])
      tags.push(['auto', 'icon'])
    }

    if (trimmedName) {
      hasName = true
      tags.push(['name', trimmedName])
      tags.push(['auto', 'name'])
    }

    if (trimmedSummary) {
      tags.push(['summary', trimmedSummary])
      tags.push(['auto', 'summary'])
    }

    if (!hasIcon || !hasName) return false

    return publishStall({
      kind: 37348,
      tags,
      content: '',
      created_at: createdAt
    })
  }

  const tags = Array.isArray(previous.tags)
    ? previous.tags.map(tag => (Array.isArray(tag) ? [...tag] : tag))
    : []
  let changed = false

  const ensureTagValue = (key, updater) => {
    const index = tags.findIndex(tag => Array.isArray(tag) && tag[0] === key)
    if (index === -1) {
      const next = updater(null)
      if (!next) return
      tags.push(next)
      changed = true
      return
    }

    const next = updater(tags[index])
    if (!next) return
    if (!tags[index] || tags[index].some((value, idx) => value !== next[idx])) {
      tags[index] = next
      changed = true
    }
  }

  ensureTagValue('d', (existing) => {
    if (existing && existing[1] === dTag) return existing
    return ['d', dTag]
  })

  ensureTagValue('c', (existing) => {
    if (!existing) return ['c', '*']
    const currentValue = typeof existing[1] === 'string' ? existing[1].trim() : ''
    if (currentValue === '') return ['c', '*']
    return existing
  })

  const hasAuto = (field) => tags.some(tag => Array.isArray(tag) && tag[0] === 'auto' && tag[1] === field)

  if (trimmedName && hasAuto('name')) {
    ensureTagValue('name', (existing) => {
      if (existing && existing[1] === trimmedName) return existing
      return ['name', trimmedName]
    })
  }

  if (trimmedSummary && hasAuto('summary')) {
    ensureTagValue('summary', (existing) => {
      if (existing && existing[1] === trimmedSummary) return existing
      return ['summary', trimmedSummary]
    })
  }

  if (iconRootHash && iconMimeType && hasAuto('icon')) {
    ensureTagValue('icon', (existing) => {
      if (existing && existing[1] === iconRootHash && existing[2] === iconMimeType) return existing
      return ['icon', iconRootHash, iconMimeType]
    })
  }

  if (!changed) return false

  return publishStall({
    kind: 37348,
    tags,
    content: typeof previous.content === 'string' ? previous.content : '',
    created_at: createdAt
  })
}

// Send event to relays with rate limit awareness
async function sendEventToRelays (event, relays, {
  timeout = 10000,
  throttleState,
  reportStatus,
  trailingPause = true
} = {}) {
  if (!Array.isArray(relays) || relays.length === 0) {
    throw new Error('No relays available to publish event')
  }

  await throttledSendEvent({
    event,
    relays,
    timeout,
    pauseState: throttleState ?? { pause: 0 },
    reportStatus,
    trailingPause
  })
}

const formatReason = (reason) => {
  if (!reason) return 'unknown error'
  if (typeof reason === 'string') return reason
  if (reason instanceof Error) return reason.message
  if (typeof reason.message === 'string') return reason.message
  try {
    return JSON.stringify(reason)
  } catch (_) {
    return 'unknown error'
  }
}

// Retries publishing events while backing off when relays respond with rate limits.
async function throttledSendEvent ({
  event,
  relays,
  timeout,
  pauseState,
  reportStatus,
  retries = 0,
  maxRetries = MAX_UPLOAD_RETRIES,
  minSuccessfulRelays = 1,
  trailingPause = false
}) {
  const pause = pauseState.pause ?? 0

  const { errors, success } = await nostrRelays.sendEvent(event, relays, timeout)

  if (errors.length === 0) {
    if (pause && trailingPause) await sleep(pause)
    return
  }

  const partitioned = errors.reduce((acc, current) => {
    const message = formatReason(current.reason)
    if (message.startsWith('rate-limited:')) {
      acc.rateLimited.push({ relay: current.relay, message })
    } else {
      acc.unretryable.push({ relay: current.relay, message })
    }
    return acc
  }, { rateLimited: [], unretryable: [] })

  if (partitioned.unretryable.length > 0 && reportStatus) {
    reportStatus(`Relay errors: ${partitioned.unretryable.map(err => `${err.relay} (${err.message})`).join(', ')}`)
  }

  const maybeSuccessfulRelays = relays.length - partitioned.unretryable.length
  if (retries >= maxRetries || maybeSuccessfulRelays < minSuccessfulRelays || (!success && partitioned.rateLimited.length === 0)) {
    const details = errors.map(err => `${err.relay}: ${formatReason(err.reason)}`).join(', ')
    throw new Error(`Failed to publish to relays: ${details}`)
  }

  if (partitioned.rateLimited.length === 0) {
    if (pause && trailingPause) await sleep(pause)
    return
  }

  const newPause = pause + RATE_LIMIT_BACKOFF_STEP
  pauseState.pause = newPause
  if (reportStatus) {
    reportStatus(`Rate limited by ${partitioned.rateLimited.length} relay(s). Retrying in ${newPause}ms...`)
  }

  await sleep(newPause)

  const nextMinSuccessfulRelays = Math.max(0, minSuccessfulRelays - (relays.length - partitioned.rateLimited.length))
  const nextRelays = partitioned.rateLimited.map(err => err.relay)

  await throttledSendEvent({
    event,
    relays: nextRelays,
    timeout,
    pauseState,
    reportStatus,
    retries: retries + 1,
    maxRetries,
    minSuccessfulRelays: nextMinSuccessfulRelays,
    trailingPause
  })
}

// Upload bundle metadata
async function uploadBundle ({ dTag, fileMetadata, signer, writeRelays, throttleState, reportProgress }) {
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
  await sendEventToRelays(signedBundle, writeRelays, {
    timeout: 15000,
    throttleState,
    reportStatus: status => reportProgress?.({ status })
  })
}
