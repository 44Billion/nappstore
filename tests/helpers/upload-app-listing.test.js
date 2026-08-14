import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createUploadAppFromManifestEvent,
  getMetadataText,
  mergeUploadAppMetadata
} from '#helpers/upload-app-listing.js'

const PUBKEY = '1'.repeat(64)
const ICON_ROOT = 'a'.repeat(64)

function manifestEvent (tags) {
  return {
    id: 'event-id',
    kind: 35128,
    pubkey: PUBKEY,
    created_at: 123,
    tags: [['d', 'sample-app'], ...tags]
  }
}

describe('upload app listing', () => {
  it('normalizes the first non-empty metadata value', () => {
    assert.equal(getMetadataText(null, '  ', ' Description '), 'Description')
    assert.equal(getMetadataText(undefined, ''), '')
  })

  it('publishes manifest metadata immediately without pending text states', () => {
    const app = createUploadAppFromManifestEvent(manifestEvent([
      ['name', 'Sample App'],
      ['description', 'Manifest description'],
      ['r', ICON_ROOT, 'mark icon', 'm image/png']
    ]))

    assert.equal(app.name, 'Sample App')
    assert.equal(app.nameIsFallback, false)
    assert.equal(app.nameResolutionPending, false)
    assert.equal(app.description, 'Manifest description')
    assert.equal(app.descriptionResolutionPending, false)
    assert.equal(app.iconFx, ICON_ROOT)
    assert.equal(app.iconResolutionPending, true)
  })

  it('keeps absent name and description pending without exposing text fallbacks', () => {
    const app = createUploadAppFromManifestEvent(manifestEvent([]))

    assert.equal(app.name, 'sample-app')
    assert.equal(app.nameIsFallback, true)
    assert.equal(app.nameResolutionPending, true)
    assert.equal(app.description, '')
    assert.equal(app.descriptionResolutionPending, true)
  })

  it('publishes discovered text while leaving unresolved fields pending', () => {
    const app = createUploadAppFromManifestEvent(manifestEvent([]))
    const merged = mergeUploadAppMetadata(app, { name: 'HTML name' }, true)

    assert.equal(merged.name, 'HTML name')
    assert.equal(merged.nameIsFallback, false)
    assert.equal(merged.nameResolutionPending, false)
    assert.equal(merged.description, '')
    assert.equal(merged.descriptionResolutionPending, true)
    assert.equal(merged.iconResolutionPending, true)
  })

  it('ends every pending state while retaining terminal fallbacks', () => {
    const app = createUploadAppFromManifestEvent(manifestEvent([]))
    const merged = mergeUploadAppMetadata(app, null, false)

    assert.equal(merged.name, 'sample-app')
    assert.equal(merged.nameIsFallback, true)
    assert.equal(merged.nameResolutionPending, false)
    assert.equal(merged.description, '')
    assert.equal(merged.descriptionResolutionPending, false)
    assert.equal(merged.iconResolutionPending, false)
  })

  it('ignores malformed manifests without a d tag', () => {
    assert.equal(createUploadAppFromManifestEvent({
      ...manifestEvent([]),
      tags: []
    }), null)
  })
})
