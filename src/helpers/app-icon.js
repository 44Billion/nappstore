// Accepts only self-contained images and absolute HTTP(S) icon URLs.
export function isRenderableAppIconUrl (value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    /\s/.test(value)
  ) return false

  if (/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value)) return true

  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch (_) {
    return false
  }
}
