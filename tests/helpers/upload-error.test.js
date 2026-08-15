import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getUploadErrorMessage } from '#helpers/upload-error.js'

describe('upload error messages', () => {
  it('maps nappup codes to concise recovery instructions', () => {
    assert.equal(
      getUploadErrorMessage({ code: 'NAPPUP_GENERIC_FOLDER_NAME' }),
      'Rename the folder to a unique app name, then select it again.'
    )
    assert.equal(
      getUploadErrorMessage({ code: 'NAPPUP_NO_OUTBOX_RELAYS' }),
      'Add a write relay to your Nostr account, then try again.'
    )
    assert.equal(
      getUploadErrorMessage({ code: 'NAPPUP_MANIFEST_UPLOAD_FAILED' }),
      'The files uploaded, but the app could not be published. Check your write relays and try again.'
    )
    assert.equal(
      getUploadErrorMessage({ code: 'NAPPUP_SIGNER_LOCKED' }),
      'Your signing account is locked. Unlock it, then try the upload again.'
    )
    assert.equal(
      getUploadErrorMessage({ code: 'NAPPUP_SIGNER_DENIED' }),
      'Approve the Nostr signing request, then try again.'
    )
    assert.equal(
      getUploadErrorMessage({ code: 'NAPPUP_UPLOAD_FAILED' }),
      'Upload failed. Check your connection and try again.'
    )
  })

  it('keeps compatibility with the current uncoded nappup release', () => {
    assert.equal(
      getUploadErrorMessage(new Error('Folder name "dist" is a generic build folder. Please provide a d tag with the -d flag.')),
      'Rename the folder to a unique app name, then select it again.'
    )
  })

  it('recognizes rejected signing prompts through a wrapped cause', () => {
    assert.equal(
      getUploadErrorMessage({ cause: new Error('User rejected request') }),
      'Approve the Nostr signing request, then try again.'
    )
  })

  it('recognizes a locked signing account through a wrapped cause', () => {
    assert.equal(
      getUploadErrorMessage({
        code: 'NAPPUP_MANIFEST_UPLOAD_FAILED',
        cause: new Error('VAULT_LOCKED')
      }),
      'Your signing account is locked. Unlock it, then try the upload again.'
    )
    assert.equal(
      getUploadErrorMessage({
        code: 'NAPPUP_IRFS_UPLOAD_FAILED',
        cause: new Error('The vault is locked')
      }),
      'Your signing account is locked. Unlock it, then try the upload again.'
    )
  })

  it('recognizes a denied signing prompt through a wrapped cause', () => {
    assert.equal(
      getUploadErrorMessage({
        code: 'NAPPUP_BLOSSOM_UPLOAD_FAILED',
        cause: new Error('Permission denied')
      }),
      'Approve the Nostr signing request, then try again.'
    )
  })

  it('does not expose unexpected technical errors', () => {
    assert.equal(
      getUploadErrorMessage(new TypeError('Cannot read properties of undefined')),
      'Upload failed. Check your connection and try again.'
    )
  })
})
