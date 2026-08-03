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
