const messagesByCode = Object.freeze({
  NAPPUP_UPLOAD_CANCELLED: 'Upload cancelled. Try again when you are ready.',
  NAPPUP_NO_SIGNER: 'Reconnect your Nostr account, then try again.',
  NAPPUP_EMPTY_FILE_LIST: 'Select the app folder, then try again.',
  NAPPUP_RELAY_LOOKUP_FAILED: 'Check your connection, then try again.',
  NAPPUP_NO_OUTBOX_RELAYS: 'Add a write relay to your Nostr account, then try again.',
  NAPPUP_INVALID_D_TAG: 'Rename the folder using 1–260 characters, then select it again.',
  NAPPUP_GENERIC_FOLDER_NAME: 'Rename the folder to a unique app name, then select it again.',
  NAPPUP_INVALID_FOLDER_NAME: 'Rename the folder using 1–260 characters, then select it again.',
  NAPPUP_BLOSSOM_UPLOAD_FAILED: 'Check your Blossom servers, then try the upload again.',
  NAPPUP_IRFS_UPLOAD_FAILED: 'Check your write relays, then try the upload again.',
  NAPPUP_MANIFEST_UPLOAD_FAILED: 'The files uploaded, but the app could not be published. Check your write relays and try again.',
  NAPPUP_SIGNER_LOCKED: 'Your signing account is locked. Unlock it, then try the upload again.',
  NAPPUP_SIGNER_DENIED: 'Approve the Nostr signing request, then try again.',
  NAPPUP_UPLOAD_FAILED: 'Upload failed. Check your connection and try again.'
})

const messagesByRecovery = Object.freeze({
  connection: 'Check your connection, then try again.',
  timeout: 'No confirmation arrived in time. Try again shortly.',
  relay: 'Try another write relay that accepts this app.',
  authentication: 'Reconnect your Nostr account or choose another Blossom server.',
  payment: 'Check the server’s payment requirements or choose another Blossom server.',
  policy: 'Choose a Blossom server that allows this upload.',
  size: 'Reduce the file size or choose another Blossom server.',
  type: 'Choose a Blossom server that accepts this file type.',
  limit: 'Wait before trying again, or choose another Blossom server.',
  server: 'Try again later or choose another Blossom server.',
  endpoint: 'Check the Blossom server address or choose another server.',
  request: 'Update the uploader or choose another Blossom server.'
})

// Keeps specific transport and protocol facts ahead of nested low-level causes.
function recoveryForReason (error, seen = new Set(), depth = 0) {
  if (!error || typeof error !== 'object' || seen.has(error) || depth >= 12) return null
  seen.add(error)
  try {
    if (error.code === 'BLOSSOM_HTTP_ERROR') {
      if (error.status === 401) return 'authentication'
      if (error.status === 402) return 'payment'
      if (error.status === 403) return 'policy'
      if (error.status === 413) return 'size'
      if (error.status === 415) return 'type'
      if (error.status === 429) return 'limit'
      if (error.status === 408 || error.status === 425) return 'server'
      if ([404, 405, 410, 501, 505].includes(error.status)) return 'endpoint'
      if ([400, 409, 411, 422].includes(error.status)) return 'request'
      if (error.status >= 500) return 'server'
      return null
    }
    if (error.category === 'connection' || error.category === 'transport') return 'connection'
    if (error.category === 'timeout') return 'timeout'
    if (error.category === 'relay') return 'relay'
    const children = [...(error.cause ? [error.cause] : []), ...(Array.isArray(error.errors) ? error.errors : [])]
    const recoveries = children.map(child => recoveryForReason(child, seen, depth + 1))
    const recovery = recoveries[0]
    return recovery && recoveries.every(item => item === recovery) ? recovery : null
  } finally {
    seen.delete(error)
  }
}

// Uses one specific instruction only when it applies to every blocking destination.
function recoveryForFailures (error) {
  const failures = error?.details?.failures
  if (!Array.isArray(failures) || failures.length === 0) return null
  const recoveries = failures.map(failure => recoveryForReason(failure.reason))
  const recovery = recoveries[0]
  return recovery && recoveries.every(item => item === recovery) ? messagesByRecovery[recovery] : null
}

// Converts public upload errors into concise recovery instructions.
export function getUploadErrorMessage (error) {
  if (error?.code === 'NAPPUP_SIGNER_LOCKED' || error?.code === 'NAPPUP_SIGNER_DENIED') {
    return messagesByCode[error.code]
  }
  const recovery = recoveryForFailures(error)
  if (recovery) {
    return error.code === 'NAPPUP_MANIFEST_UPLOAD_FAILED'
      ? `The files uploaded, but the app could not be published. ${recovery}`
      : recovery
  }
  if (messagesByCode[error?.code]) return messagesByCode[error.code]

  return messagesByCode.NAPPUP_UPLOAD_FAILED
}
