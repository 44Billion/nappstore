// Extracts metadata (name, description, favicon) from app files

export function extractHtmlMetadata (htmlContent) {
  let name
  let description

  try {
    // Extract title from <title> tag
    const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/i
    const titleMatch = htmlContent.match(titleRegex)
    if (titleMatch && titleMatch[1]) {
      name = titleMatch[1].trim()
    }

    // Extract description from <meta name="description"> tag
    const metaDescRegex = /<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i
    const metaDescMatch = htmlContent.match(metaDescRegex)
    if (metaDescMatch && metaDescMatch[1]) {
      description = metaDescMatch[1].trim()
    }

    // Try alternative pattern if the first one didn't match (content before name)
    if (!description) {
      const altMetaDescRegex = /<meta\s+[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']description["'][^>]*>/i
      const altMetaDescMatch = htmlContent.match(altMetaDescRegex)
      if (altMetaDescMatch && altMetaDescMatch[1]) {
        description = altMetaDescMatch[1].trim()
      }
    }
  } catch (error) {
    console.log('Error parsing HTML metadata:', error)
  }

  return { name, description }
}

// Find favicon file in file list
export function findFavicon (fileList) {
  const faviconExtensions = ['ico', 'svg', 'webp', 'png', 'jpg', 'jpeg', 'gif']

  for (const file of fileList) {
    const filename = file.name.toLowerCase()
    if (filename.startsWith('favicon.')) {
      const ext = filename.split('.').pop()
      if (faviconExtensions.includes(ext)) {
        return file
      }
    }
  }

  return null
}

// Check if index.html or index.htm exists in file list
export function findIndexFile (fileList) {
  for (const file of fileList) {
    const filename = file.name.toLowerCase()
    if (filename === 'index.html' || filename === 'index.htm') {
      return file
    }
  }

  return null
}

// Convert File to data URL
export async function fileToDataUrl (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Convert File to text
export async function fileToText (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}
