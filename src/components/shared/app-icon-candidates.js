import { isRenderableAppIconUrl } from '#helpers/app-icon.js'
import { appIconMonogramPalettes } from '#assets/styles/theme.js'

export { appIconMonogramPalettes }

const DEFAULT_MANIFEST_ICON_PRIORITY = 200
const DEFAULT_HTML_ICON_PRIORITY = 100

function getCandidatePriority (candidate) {
  if (Number.isFinite(candidate?.priority)) return candidate.priority
  return candidate?.source === 'html' ? DEFAULT_HTML_ICON_PRIORITY : DEFAULT_MANIFEST_ICON_PRIORITY
}

// Splits text by user-perceived characters when the platform supports it.
function getGraphemes (value) {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
      .map(segment => segment.segment)
  }
  return Array.from(value)
}

// Extracts meaningful words while treating camel-case as separate initials.
function getWords (value) {
  const separatedValue = value.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(separatedValue)]
      .filter(segment => segment.isWordLike)
      .map(segment => segment.segment)
  }
  return separatedValue.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

// Builds a stable one- or two-character app monogram and accessible color pair.
export function getAppIconMonogram (appId, appName) {
  const normalizedName = typeof appName === 'string'
    ? appName.trim().replace(/\s+/gu, ' ')
    : ''
  const words = normalizedName ? getWords(normalizedName) : []
  const rawLabel = words.length > 1
    ? `${getGraphemes(words[0])[0]}${getGraphemes(words.at(-1))[0]}`
    : getGraphemes(words[0] || '').slice(0, 2).join('')
  const label = getGraphemes(rawLabel.toUpperCase()).slice(0, 2).join('') || '◈'
  const seed = String(appId || normalizedName || 'app')
  let hash = 2166136261
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return {
    label,
    ...appIconMonogramPalettes[(hash >>> 0) % appIconMonogramPalettes.length]
  }
}

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
      source: candidate.source === 'html' ? 'html' : 'manifest',
      ...(Number.isFinite(candidate.priority) ? { priority: candidate.priority } : {})
    }]
  })
}

// Makes a confirmed candidate the durable first choice while retaining fallbacks.
export function promoteAppIconCandidate (icon, candidate) {
  if (!candidate || !isRenderableAppIconUrl(candidate.url)) return icon
  const promoted = {
    fx: typeof candidate.fx === 'string' ? candidate.fx : null,
    url: candidate.url,
    source: candidate.source === 'html' ? 'html' : 'manifest',
    ...(Number.isFinite(candidate.priority) ? { priority: candidate.priority } : {})
  }
  const candidates = [
    promoted,
    ...normalizeAppIconCandidates(icon).filter(entry => entry.url !== promoted.url)
  ]
  return {
    ...(icon && typeof icon === 'object' ? icon : {}),
    ...promoted,
    candidates
  }
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

// Chooses one metadata-preferred upgrade without switching between servers for the same asset.
export function getAppIconUpgradeIndex (
  candidates,
  displayedIcon,
  rejectedUrls,
  { discoveryComplete = false, upgradeAttempted = false } = {}
) {
  if (!discoveryComplete || upgradeAttempted || !displayedIcon || candidates.length === 0) return -1
  const preferred = candidates.reduce((best, candidate) =>
    getCandidatePriority(candidate) < getCandidatePriority(best) ? candidate : best
  )
  if (preferred.url === displayedIcon.url || rejectedUrls.has(preferred.url)) return -1
  if (preferred.fx && displayedIcon.fx && preferred.fx === displayedIcon.fx) return -1
  return candidates.findIndex(candidate => candidate.url === preferred.url)
}

// Finds another server URL for the same preferred asset without changing quality tiers.
export function getEquivalentAppIconCandidateIndex (candidates, candidate, rejectedUrls) {
  if (!candidate?.fx) return -1
  return candidates.findIndex(next =>
    next.fx === candidate.fx && !rejectedUrls.has(next.url)
  )
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

// Keeps a declared icon pending until a candidate loads or resolution is exhausted.
export function isAppIconResolutionPending ({
  hasReadIconState,
  consumerResolutionPending,
  isDiscovering,
  appFx,
  currentIcon,
  exhausted
}) {
  if (exhausted && !currentIcon) return false
  return !hasReadIconState ||
    consumerResolutionPending === true ||
    isDiscovering ||
    (!!appFx && !currentIcon && !exhausted)
}
