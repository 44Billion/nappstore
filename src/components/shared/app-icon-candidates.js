import { isRenderableAppIconUrl } from '#helpers/app-icon.js'

// Normalizes current and legacy cached icon shapes into an ordered URL list.
export function normalizeAppIconCandidates (icon) {
  if (!icon || typeof icon !== 'object') return []

  const candidates = [icon, ...(Array.isArray(icon.candidates) ? icon.candidates : [])]
  const seenUrls = new Set()
  return candidates.flatMap(candidate => {
    if (!candidate || !isRenderableAppIconUrl(candidate.url)) return []
    const url = candidate.url
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

// Keeps a confirmed image selected while refreshed candidates still represent it.
export function reconcileAppIconCandidates (candidates, displayedIcon, rejectedUrls) {
  const index = candidates.findIndex(candidate => !rejectedUrls.has(candidate.url))
  if (!displayedIcon || rejectedUrls.has(displayedIcon.url)) {
    return { candidates, index: index < 0 ? candidates.length : index }
  }

  const exactIndex = candidates.findIndex(candidate => candidate.url === displayedIcon.url)
  if (exactIndex >= 0) return { candidates, index: exactIndex }

  if (displayedIcon.fx && candidates.some(candidate => candidate.fx === displayedIcon.fx)) {
    return { candidates: [displayedIcon, ...candidates], index: 0 }
  }

  return { candidates, index: index < 0 ? candidates.length : index }
}

// Describes the two image layers without hiding a confirmed image during preload.
export function getAppIconLayerState (displayedIcon, candidateIcon) {
  const hasDisplayedIcon = !!displayedIcon
  const isCandidateDisplayed = displayedIcon?.url === candidateIcon?.url
  return {
    isShimmerVisible: !hasDisplayedIcon,
    isDisplayedLayerVisible: hasDisplayedIcon && !isCandidateDisplayed,
    isCandidateLayerVisible: isCandidateDisplayed
  }
}

// Distinguishes an unresolved icon from a confirmed numeric fallback.
export function isAppIconResolutionPending ({
  hasReadIconState,
  consumerResolutionPending,
  isDiscovering,
  appFx,
  currentIcon,
  exhausted
}) {
  return !hasReadIconState ||
    consumerResolutionPending === true ||
    isDiscovering ||
    (consumerResolutionPending === undefined && !!appFx && !currentIcon && !exhausted)
}
