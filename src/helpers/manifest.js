const ROOT_HASH = /^[0-9a-f]{64}$/
const MARKS = new Set(['icon', 'key_art', 'screenshot'])

// Normalizes one optional leading slash and rejects unsafe route segments.
export function normalizeManifestPath (value) {
  if (typeof value !== 'string') throw new TypeError('Manifest path must be a string')
  const path = value.startsWith('/') ? value.slice(1) : value
  // eslint-disable-next-line no-control-regex
  if (!path || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('Unsafe manifest path')
  if (path.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Unsafe manifest path')
  return path
}

function optionalPath (value) {
  try { return normalizeManifestPath(value) } catch (_) { return null }
}

function optionalSize (value) {
  if (!/^(0|[1-9][0-9]*)$/.test(value || '')) return null
  const size = Number(value)
  return Number.isSafeInteger(size) ? size : null
}

function parseReference (tag, service) {
  if (!Array.isArray(tag) || tag[0] !== 'r' || !ROOT_HASH.test(tag[1])) return null
  const asset = {
    service,
    root: tag[1],
    paths: [],
    marks: [],
    countries: [],
    mimeType: null,
    size: null
  }
  for (const field of tag.slice(2)) {
    if (typeof field !== 'string') continue
    const separator = field.indexOf(' ')
    if (separator < 1) continue
    const name = field.slice(0, separator)
    const value = field.slice(separator + 1)
    if (name === 'path') {
      const path = optionalPath(value)
      if (path && !asset.paths.includes(path)) asset.paths.push(path)
    } else if (name === 'mark' && MARKS.has(value)) {
      asset.marks.push(value)
    } else if (name === 'm' && value) {
      asset.mimeType = value
    } else if (name === 'size') {
      asset.size = optionalSize(value)
    } else if (name === 'country' && value) {
      asset.countries.push(value)
    }
  }
  return asset
}

// Converts Blossom path tags and IRFS r tags into one descriptor shape.
export function getManifestAssets (manifest) {
  const tags = Array.isArray(manifest?.tags) ? manifest.tags : []
  const advertisedService = tags.find(tag => tag[0] === 'service')?.[1]
  if (advertisedService !== undefined && !['irfs', 'blossom'].includes(advertisedService)) return []
  const service = advertisedService || 'blossom'
  const assets = []
  if (service === 'blossom') {
    for (const tag of tags) {
      if (!Array.isArray(tag) || tag[0] !== 'path' || !ROOT_HASH.test(tag[2])) continue
      const path = optionalPath(tag[1])
      if (path) assets.push({ service, root: tag[2], paths: [path], marks: [], countries: [], mimeType: null, size: null })
    }
  }
  for (const tag of tags) {
    const asset = parseReference(tag, service)
    if (asset && (asset.paths.length || asset.marks.length)) assets.push(asset)
  }
  return assets
}

// Finds the first asset carrying a recognized media mark.
export function findMarkedManifestAsset (manifest, mark) {
  return findMarkedManifestAssets(manifest, mark)[0] || null
}

// Finds every asset carrying a recognized media mark in manifest order.
export function findMarkedManifestAssets (manifest, mark) {
  if (!MARKS.has(mark)) return []
  return getManifestAssets(manifest).filter(asset => asset.marks.includes(mark))
}

// Finds the first routed asset accepted by a path predicate.
export function findManifestPathAsset (manifest, predicate) {
  for (const asset of getManifestAssets(manifest)) {
    const path = asset.paths.find(predicate)
    if (path) return { ...asset, path }
  }
  return null
}

// Reads listing metadata now embedded directly in the manifest.
export function getManifestMetadata (manifest) {
  const tags = Array.isArray(manifest?.tags) ? manifest.tags : []
  const first = name => tags.find(tag => tag[0] === name && typeof tag[1] === 'string' && tag[1].trim())?.[1]?.trim() || null
  return {
    name: first('name'),
    summary: first('summary'),
    description: first('description')
  }
}
