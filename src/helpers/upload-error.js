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
  NAPPUP_UPLOAD_FAILED: 'Upload failed. Check your connection and try again.'
})

// Detects a rejected signing prompt across common NIP-07 provider errors.
function isSigningRejection (error) {
  const messages = []
  let current = error
  for (let depth = 0; current && depth < 4; depth++) {
    if (current.name === 'NotAllowedError') return true
    if (typeof current.message === 'string') messages.push(current.message)
    current = current.cause
  }
  return /user (?:rejected|denied)|request (?:rejected|denied)|permission denied/i.test(messages.join(' '))
}

// Converts library and legacy upload errors into concise recovery instructions.
export function getUploadErrorMessage (error) {
  if (isSigningRejection(error)) return 'Approve the Nostr signing request, then try again.'
  if (messagesByCode[error?.code]) return messagesByCode[error.code]

  const message = typeof error?.message === 'string' ? error.message : ''
  if (/generic build folder|provide (?:a )?d tag with (?:the )?-d/i.test(message)) {
    return messagesByCode.NAPPUP_GENERIC_FOLDER_NAME
  }
  if (/derive a valid d tag|dTag must be a non-empty string/i.test(message)) {
    return messagesByCode.NAPPUP_INVALID_FOLDER_NAME
  }
  if (/no nostr signer/i.test(message)) return messagesByCode.NAPPUP_NO_SIGNER
  if (/no outbox relays/i.test(message)) return messagesByCode.NAPPUP_NO_OUTBOX_RELAYS
  if (/failed to upload to blossom|file\(s\) failed to upload to blossom/i.test(message)) {
    return messagesByCode.NAPPUP_BLOSSOM_UPLOAD_FAILED
  }
  if (/network|fetch|offline|connection/i.test(message)) {
    return 'Check your connection, then try again.'
  }
  return messagesByCode.NAPPUP_UPLOAD_FAILED
}
