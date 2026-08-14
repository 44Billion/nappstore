import { appEncode } from 'libp2r2p/nip19'
import { findMarkedManifestAsset, getManifestMetadata } from '#helpers/manifest.js'

// Returns the first non-empty metadata value in display-ready form.
export function getMetadataText (...values) {
  return values
    .find(value => typeof value === 'string' && value.trim())
    ?.trim() || ''
}

// Builds an upload-list card immediately from metadata carried by a manifest.
export function createUploadAppFromManifestEvent (manifestEvent) {
  const tags = Array.isArray(manifestEvent?.tags) ? manifestEvent.tags : []
  const dTag = tags.find(tag => Array.isArray(tag) && tag[0] === 'd')?.[1]
  if (!dTag) return null

  const id = appEncode({
    dTag,
    pubkey: manifestEvent.pubkey,
    kind: manifestEvent.kind
  })
  const metadata = getManifestMetadata(manifestEvent)
  const publishedName = getMetadataText(metadata.name)
  const description = getMetadataText(metadata.description, metadata.summary)
  const icon = findMarkedManifestAsset(manifestEvent, 'icon')

  return {
    id,
    manifestId: manifestEvent.id,
    dTag,
    pubkey: manifestEvent.pubkey,
    kind: manifestEvent.kind,
    name: publishedName || dTag,
    nameIsFallback: !publishedName,
    nameResolutionPending: !publishedName,
    description,
    descriptionResolutionPending: !description,
    iconFx: icon?.root || null,
    iconResolutionPending: true,
    uploadedAt: manifestEvent.created_at * 1000
  }
}

// Merges progressively discovered metadata while retaining explicit fallback state.
export function mergeUploadAppMetadata (app, metadata, resolutionPending) {
  const publishedName = getMetadataText(metadata?.name)
  const description = getMetadataText(metadata?.description, app.description)
  const nameIsFallback = publishedName ? false : app.nameIsFallback
  return {
    ...app,
    name: publishedName || app.name,
    nameIsFallback,
    nameResolutionPending: resolutionPending && nameIsFallback,
    description,
    descriptionResolutionPending: resolutionPending && !description,
    iconFx: metadata?.icon?.fx || app.iconFx,
    iconResolutionPending: resolutionPending
  }
}
