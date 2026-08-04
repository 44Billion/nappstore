// Normalizes current and legacy cached icon shapes into an ordered URL list.
export function normalizeAppIconCandidates (icon) {
  if (!icon || typeof icon !== 'object') return []

  const candidates = [icon, ...(Array.isArray(icon.candidates) ? icon.candidates : [])]
  const seenUrls = new Set()
  return candidates.flatMap(candidate => {
    if (!candidate || typeof candidate.url !== 'string' || !candidate.url.trim()) return []
    const url = candidate.url.trim()
    if (seenUrls.has(url)) return []
    seenUrls.add(url)
    return [{
      fx: typeof candidate.fx === 'string' ? candidate.fx : null,
      url,
      source: candidate.source === 'html' ? 'html' : 'manifest'
    }]
  })
}

// Selects the first non-rejected candidate and identifies terminal discovery states.
export function getAppIconCandidateState (icon, rejectedUrls, { discoveryAttempted = false } = {}) {
  const candidates = normalizeAppIconCandidates(icon)
  const index = candidates.findIndex(candidate => !rejectedUrls.has(candidate.url))
  const htmlDiscovered = icon?.htmlDiscovered === true
  return {
    candidates,
    index: index < 0 ? candidates.length : index,
    htmlDiscovered,
    exhausted: index < 0 && (htmlDiscovered || discoveryAttempted)
  }
}
