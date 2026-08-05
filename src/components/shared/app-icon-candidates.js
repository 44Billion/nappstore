import { isRenderableAppIconUrl } from '#helpers/app-icon.js'

export const appIconMonogramPalettes = Object.freeze([
  { lightBg: '#fee2e2', lightFg: '#991b1b', darkBg: '#7f1d1d', darkFg: '#fecaca' },
  { lightBg: '#ffedd5', lightFg: '#9a3412', darkBg: '#7c2d12', darkFg: '#fed7aa' },
  { lightBg: '#fef3c7', lightFg: '#92400e', darkBg: '#78350f', darkFg: '#fde68a' },
  { lightBg: '#dcfce7', lightFg: '#166534', darkBg: '#14532d', darkFg: '#bbf7d0' },
  { lightBg: '#ccfbf1', lightFg: '#115e59', darkBg: '#134e4a', darkFg: '#99f6e4' },
  { lightBg: '#dbeafe', lightFg: '#1e40af', darkBg: '#1e3a8a', darkFg: '#bfdbfe' },
  { lightBg: '#e0e7ff', lightFg: '#3730a3', darkBg: '#312e81', darkFg: '#c7d2fe' },
  { lightBg: '#f3e8ff', lightFg: '#6b21a8', darkBg: '#581c87', darkFg: '#e9d5ff' },
  { lightBg: '#fce7f3', lightFg: '#9d174d', darkBg: '#831843', darkFg: '#fbcfe8' },
  { lightBg: '#e2e8f0', lightFg: '#334155', darkBg: '#334155', darkFg: '#e2e8f0' }
])

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
