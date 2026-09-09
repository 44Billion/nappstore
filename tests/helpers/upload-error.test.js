import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toApp, NAPPUP_ERROR_CODES } from 'nappup'
import { getUploadErrorMessage } from '#helpers/upload-error.js'

// Models the public API's blocking destination failures, with original error objects.
function uploadError (reasons, code = 'NAPPUP_BLOSSOM_UPLOAD_FAILED') {
  return { code, details: { failures: reasons.map(reason => ({ filename: 'app.js', destination: 'https://server.test', reason })) } }
}

// HTTP response text is deliberately misleading: only structured status is actionable.
function httpError (status) {
  return Object.assign(new Error('Permission denied; please retry'), { code: 'BLOSSOM_HTTP_ERROR', status })
}

describe('upload recovery instructions', () => {
  it('handles every public code with a short instruction', () => {
    for (const code of Object.values(NAPPUP_ERROR_CODES)) {
      const message = getUploadErrorMessage({ code })
      assert.ok(message.length > 0 && message.length < 200)
      if (code !== 'NAPPUP_UPLOAD_FAILED') assert.notEqual(message, getUploadErrorMessage({}))
    }
  })

  for (const [status, instruction] of [
    [401, 'Reconnect your Nostr account or choose another Blossom server.'],
    [402, 'Check the server’s payment requirements or choose another Blossom server.'],
    [403, 'Choose a Blossom server that allows this upload.'],
    [404, 'Check the Blossom server address or choose another server.'],
    [409, 'Update the uploader or choose another Blossom server.'],
    [411, 'Update the uploader or choose another Blossom server.'],
    [413, 'Reduce the file size or choose another Blossom server.'],
    [415, 'Choose a Blossom server that accepts this file type.'],
    [429, 'Wait before trying again, or choose another Blossom server.'],
    [503, 'Try again later or choose another Blossom server.'],
    [501, 'Check the Blossom server address or choose another server.']
  ]) {
    it(`offers a matching action for HTTP ${status}`, () => {
      assert.equal(getUploadErrorMessage(uploadError([httpError(status), httpError(status)])), instruction)
    })
  }

  it('uses a general instruction for mixed, missing or unknown destination reasons', () => {
    for (const reasons of [[httpError(413), httpError(415)], [httpError(415), new Error('unknown')], [httpError(418)], [new AggregateError([httpError(413), httpError(415)], 'mixed')], []]) {
      assert.equal(getUploadErrorMessage(uploadError(reasons)), 'Check your Blossom servers, then try the upload again.')
    }
  })

  it('preserves the published-files context when the manifest fails', () => {
    const error = uploadError([Object.assign(new Error(''), { category: 'timeout' })], 'NAPPUP_MANIFEST_UPLOAD_FAILED')
    assert.equal(getUploadErrorMessage(error), 'The files uploaded, but the app could not be published. No confirmation arrived in time. Try again shortly.')
  })

  it('distinguishes connection problems from relay policy rejection', () => {
    const error = category => uploadError([Object.assign(new Error(''), { category })], 'NAPPUP_IRFS_UPLOAD_FAILED')
    assert.equal(getUploadErrorMessage(error('connection')), 'Check your connection, then try again.')
    assert.equal(getUploadErrorMessage(error('transport')), 'Check your connection, then try again.')
    assert.equal(getUploadErrorMessage(error('relay')), 'Try another write relay that accepts this app.')
  })

  it('handles cyclic and deeply nested reasons without exposing technical text', () => {
    const cycle = new Error('private diagnostic')
    cycle.cause = cycle
    assert.equal(getUploadErrorMessage(uploadError([cycle])), 'Check your Blossom servers, then try the upload again.')
    let deep = httpError(415)
    for (let i = 0; i < 30; i++) deep = new Error('wrapper', { cause: deep })
    assert.equal(getUploadErrorMessage(uploadError([deep])), 'Check your Blossom servers, then try the upload again.')
    assert.equal(getUploadErrorMessage(new TypeError('implementation detail')), 'Upload failed. Check your connection and try again.')
  })

  it('uses signer codes normalized by the real linked nappup API', async () => {
    for (const [reason, expected] of [
      [new Error('VAULT_LOCKED'), 'Your signing account is locked. Unlock it, then try the upload again.'],
      [Object.assign(new Error(''), { code: 'DENIED_BY_USER' }), 'Approve the Nostr signing request, then try again.']
    ]) {
      const signer = { getRelays: async () => { throw new AggregateError([reason], 'Signing failed') } }
      await assert.rejects(toApp([{ name: 'app.js', webkitRelativePath: 'test/app.js' }], signer), error => {
        assert.equal(getUploadErrorMessage(error), expected)
        return true
      })
    }
  })
})
