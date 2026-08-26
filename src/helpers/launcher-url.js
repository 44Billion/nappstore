import { appEncode } from 'libp2r2p/nip19'
import { tryDecodeUserReference } from 'libp2r2p/nip27'
import { encodeAppUrl } from 'libp2r2p/url'

function isLocalHostname (hostname) {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1'
}

export function getLauncherOrigin (
  locationLike = globalThis.location,
  { isProduction = typeof IS_PRODUCTION !== 'undefined' && IS_PRODUCTION } = {}
) {
  const hostname = locationLike?.hostname || ''
  if (isLocalHostname(hostname)) {
    const protocol = locationLike.protocol || 'http:'
    const port = locationLike.port ? `:${locationLike.port}` : ''
    return `${protocol}//${hostname === '127.0.0.1' ? hostname : 'localhost'}${port}`
  }
  return isProduction ? 'https://44billion.net' : 'http://localhost:10000'
}

export function getAppLauncherUrl (encodedApp, options) {
  return `${getLauncherOrigin(options?.locationLike, options)}/${encodedApp}`
}

// Builds a friendly `+<dTag>@<user>` URL when the author has a NIP-05;
// falls back to the canonical NIP-19 app entity otherwise.
export function getAppLauncherUrlForApp ({ dTag, pubkey, kind, nip05 }, options) {
  const user = typeof nip05 === 'string' && nip05 && tryDecodeUserReference(nip05)
    ? nip05
    : null
  if (!user) {
    return getAppLauncherUrl(appEncode({ dTag, pubkey, kind, relays: [] }), options)
  }
  const channel = { 35128: 'main', 35129: 'next', 35130: 'draft' }[kind] || 'main'
  try {
    const segment = encodeAppUrl({ appName: dTag, channel, user })
    return `${getLauncherOrigin(options?.locationLike, options)}/${segment}`
  } catch {
    return getAppLauncherUrl(appEncode({ dTag, pubkey, kind, relays: [] }), options)
  }
}

// Builds a shareable nappstore URL for the current filters.
export function getStoreShareUrl ({ by = [], as = [], is = [], no = [], at = [] }, options) {
  const params = new URLSearchParams()
  for (const value of by) params.append('by', value)
  for (const value of as) params.append('as', value)
  for (const value of is) params.append('is', value)
  for (const value of no) params.append('no', value)
  for (const value of at) params.append('at', value.replace(/^wss:\/\//, ''))
  const query = params.toString()
  return `${getLauncherOrigin(options?.locationLike, options)}/+apps${query ? `?${query}` : ''}`
}
