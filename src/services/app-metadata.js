import { isRenderableAppIconUrl } from '#helpers/app-icon.js'

const IMAGE_EXTENSIONS = /\.(?:ico|svg|webp|png|jpe?g|gif|avif)(?:[?#].*)?$/i

// Decodes the character references commonly used in metadata attributes.
function decodeHtml (value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    const codePoint = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10)
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : _
  })
}

// Parses attributes without depending on a browser DOM implementation.
function parseAttributes (tag) {
  const attributes = {}
  const source = tag.replace(/^<\s*[^\s>]+/, '').replace(/\/?\s*>$/, '')
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase()
    if (!(name in attributes)) attributes[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

// Scans selected HTML start tags while respecting quoted greater-than signs.
function scanTags (htmlContent, names) {
  const tags = []
  const start = new RegExp(`<\\s*(${[...names].join('|')})\\b`, 'ig')
  for (const match of htmlContent.matchAll(start)) {
    let quote = null
    let end = match.index + match[0].length
    for (; end < htmlContent.length; end++) {
      const char = htmlContent[end]
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
    }
    if (end < htmlContent.length) {
      tags.push({ name: match[1].toLowerCase(), attributes: parseAttributes(htmlContent.slice(match.index, end + 1)), index: match.index })
    }
  }
  return tags
}

// Adds a unique icon source with a stable priority and document order.
function addIconSource (sources, seen, href, kind, priority, index) {
  const value = typeof href === 'string' ? href.trim() : ''
  if (!value || seen.has(value)) return
  seen.add(value)
  sources.push({ href: value, kind, priority, index })
}

function metadataMarkup (htmlContent) {
  return String(htmlContent || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
}

// Extracts metadata (name, description and icon sources) from app HTML.
export function extractHtmlMetadata (htmlContent) {
  const html = metadataMarkup(htmlContent)
  let name = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).trim() || undefined
  let namePriority = name ? 0 : Infinity
  let description
  let descriptionPriority = Infinity
  let baseHref
  const iconSources = []
  const seenIcons = new Set()

  try {
    const tags = scanTags(html, new Set(['base', 'link', 'meta']))
    for (const { name: tagName, attributes, index } of tags) {
      if (tagName === 'base' && !baseHref && attributes.href) {
        baseHref = attributes.href.trim()
        continue
      }
      if (tagName === 'link') {
        const rels = new Set((attributes.rel || '').toLowerCase().split(/\s+/).filter(Boolean))
        if (rels.has('icon')) addIconSource(iconSources, seenIcons, attributes.href, 'icon', 10, index)
        else if (rels.has('apple-touch-icon')) addIconSource(iconSources, seenIcons, attributes.href, 'apple-touch-icon', 20, index)
        else if (rels.has('apple-touch-icon-precomposed')) addIconSource(iconSources, seenIcons, attributes.href, 'apple-touch-icon', 21, index)
        else if (rels.has('mask-icon') || rels.has('fluid-icon')) addIconSource(iconSources, seenIcons, attributes.href, 'mask-icon', 30, index)
        else if (rels.has('manifest')) addIconSource(iconSources, seenIcons, attributes.href, 'manifest', 40, index)
        else if (rels.has('image_src')) addIconSource(iconSources, seenIcons, attributes.href, 'social-image', 70, index)
        continue
      }

      const key = (attributes.property || attributes.name || attributes.itemprop || '').toLowerCase()
      const content = attributes.content?.trim()
      if (!content) continue
      const nextNamePriority = key === 'application-name'
        ? 10
        : key === 'apple-mobile-web-app-title'
          ? 20
          : key === 'og:title' ? 30 : Infinity
      if (nextNamePriority < namePriority) {
        name = content
        namePriority = nextNamePriority
      }
      const priority = key === 'description' ? 10 : key === 'og:description' ? 20 : Infinity
      if (priority < descriptionPriority) {
        description = content
        descriptionPriority = priority
      }
      if (key === 'msapplication-tileimage') addIconSource(iconSources, seenIcons, content, 'tile-image', 60, index)
      else if (key === 'og:image:secure_url') addIconSource(iconSources, seenIcons, content, 'social-image', 71, index)
      else if (key === 'og:image' || key === 'og:image:url') addIconSource(iconSources, seenIcons, content, 'social-image', 72, index)
      else if (key === 'image') addIconSource(iconSources, seenIcons, content, 'social-image', 75, index)
      else if (key === 'twitter:image' || key === 'twitter:image:src') addIconSource(iconSources, seenIcons, content, 'social-image', 80, index)
    }
  } catch (error) {
    console.log('Error parsing HTML metadata:', error)
  }

  iconSources.sort((left, right) => left.priority - right.priority || left.index - right.index)
  return {
    name,
    description,
    baseHref,
    iconSources: iconSources.map(({ href, kind, priority }) => ({ href, kind, priority }))
  }
}

// Extracts ordered icon references from a parsed Web App Manifest.
export function extractWebManifestIcons (manifest) {
  try {
    const parsed = typeof manifest === 'string' ? JSON.parse(manifest) : manifest
    return (Array.isArray(parsed?.icons) ? parsed.icons : [])
      .map((icon, index) => ({
        href: typeof icon?.src === 'string' ? icon.src.trim() : '',
        kind: 'web-app-manifest',
        purpose: typeof icon?.purpose === 'string' ? icon.purpose.toLowerCase().split(/\s+/) : ['any'],
        index
      }))
      .filter(icon => icon.href)
      .sort((left, right) => {
        const rank = icon => icon.purpose.includes('any') ? 0 : icon.purpose.includes('maskable') ? 1 : 2
        return rank(left) - rank(right) || left.index - right.index
      })
      .map(({ href, kind }) => ({ href, kind }))
  } catch (_) {
    return []
  }
}

// Returns the path portion of a reference as it would resolve inside the app.
export function resolveAppPath (reference, basePath = 'index.html', baseHref) {
  try {
    const documentUrl = new URL(basePath, 'https://napp.invalid/')
    const effectiveBase = baseHref ? new URL(baseHref, documentUrl) : documentUrl
    const url = new URL(reference, effectiveBase)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return decodeURIComponent(url.pathname).replace(/^\/+/, '') || null
  } catch (_) {
    return null
  }
}

// Returns a directly renderable external image URL, if safe.
export function resolveExternalImageUrl (reference, baseHref) {
  const value = typeof reference === 'string' ? reference.trim() : ''
  if (!value || /\s/.test(value)) return null
  if (value.startsWith('data:')) return isRenderableAppIconUrl(value) ? value : null
  const hasRemoteBase = typeof baseHref === 'string' && /^(?:https?:)?\/\//i.test(baseHref.trim())
  if (!/^(?:https?:)?\/\//i.test(value) && !hasRemoteBase) return null
  try {
    const url = new URL(value, baseHref || 'https://napp.invalid/')
    return isRenderableAppIconUrl(url.href) ? url.href : null
  } catch (_) {
    return null
  }
}

// Finds a conventional favicon file in a file list.
export function findFavicon (fileList) {
  for (const file of fileList) {
    const filename = file.name.toLowerCase()
    if (filename.startsWith('favicon.') && IMAGE_EXTENSIONS.test(filename)) return file
  }
  return null
}

// Finds an index HTML file in a file list.
export function findIndexFile (fileList) {
  for (const file of fileList) {
    const filename = file.name.toLowerCase()
    if (filename === 'index.html' || filename === 'index.htm') return file
  }
  return null
}

// Converts a File to a data URL.
export async function fileToDataUrl (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Converts a File to text.
export async function fileToText (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}
