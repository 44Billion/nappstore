import { getRandomId } from '#helpers/misc.js'

// TODO: offline
export const getSvgAvatar = async function (seed) {
  try {
    return await fetchApi(getAvatarUrl(seed), { headers: getHeaders() })
  } catch (err) {
    console.log('Could not get avatar image', err.stack)
    return getDefaultSvg()
  }
}

const getAvatarUrl = function (seed = getRandomId()) {
  const queryParams = new URLSearchParams({
    radius: 50,
    randomizeIds: 'true',
    seed
  }).toString()

  return `https://api.dicebear.com/9.x/avataaars/svg?${queryParams}`
}

// https://api.dicebear.com/9.x/avataaars/svg?radius=50&randomizeIds=true&seed=1b3pbdhwjtu
const getDefaultSvg = () => {
  // eslint-disable-next-line @stylistic/quotes
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 280" fill="none" shape-rendering="auto"><metadata xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><rdf:RDF><rdf:Description><dc:title>Avataaars</dc:title><dc:creator>Pablo Stanley</dc:creator><dc:source xsi:type="dcterms:URI">https://avataaars.com/</dc:source><dcterms:license xsi:type="dcterms:URI">https://avataaars.com/</dcterms:license><dc:rights>Remix of „Avataaars” (https://avataaars.com/) by „Pablo Stanley”, licensed under „Free for personal and commercial use” (https://avataaars.com/)</dc:rights></rdf:Description></rdf:RDF></metadata><mask id="an70z9ld"><rect width="280" height="280" rx="140" ry="140" x="0" y="0" fill="#fff"/></mask><g mask="url(#an70z9ld)"><g transform="translate(8)"><path d="M132 36a56 56 0 0 0-56 56v6.17A12 12 0 0 0 66 110v14a12 12 0 0 0 10.3 11.88 56.04 56.04 0 0 0 31.7 44.73v18.4h-4a72 72 0 0 0-72 72v9h200v-9a72 72 0 0 0-72-72h-4v-18.39a56.04 56.04 0 0 0 31.7-44.73A12 12 0 0 0 198 124v-14a12 12 0 0 0-10-11.83V92a56 56 0 0 0-56-56Z" fill="#d08b5b"/><path d="M108 180.61v8a55.79 55.79 0 0 0 24 5.39c8.59 0 16.73-1.93 24-5.39v-8a55.79 55.79 0 0 1-24 5.39 55.79 55.79 0 0 1-24-5.39Z" fill="#000" fill-opacity=".1"/><g transform="translate(0 170)"><path d="M132.5 65.83c27.34 0 49.5-13.2 49.5-29.48 0-1.37-.16-2.7-.46-4.02A72.03 72.03 0 0 1 232 101.05V110H32v-8.95A72.03 72.03 0 0 1 83.53 32a18 18 0 0 0-.53 4.35c0 16.28 22.16 29.48 49.5 29.48Z" fill="#ffffff"/></g><g transform="translate(78 134)"><path d="M40 16c0 5.37 6.16 9 14 9s14-3.63 14-9c0-1.1-.95-2-2-2-1.3 0-1.87.9-2 2-1.24 2.94-4.32 4.72-10 5-5.68-.28-8.76-2.06-10-5-.13-1.1-.7-2-2-2-1.05 0-2 .9-2 2Z" fill="#000" fill-opacity=".6"/></g><g transform="translate(104 122)"><path fill-rule="evenodd" clip-rule="evenodd" d="M16 8c0 4.42 5.37 8 12 8s12-3.58 12-8" fill="#000" fill-opacity=".16"/></g><g transform="translate(76 90)"><path d="M27 16c-4.84 0-9 2.65-10.84 6.45-.54 1.1.39 1.85 1.28 1.12a15.13 15.13 0 0 1 9.8-3.22 6 6 0 1 0 10.7 2.8 2 2 0 0 0-.12-.74l-.15-.38a6 6 0 0 0-1.64-2.48C33.9 17.32 30.5 16 27 16ZM85 16c-4.84 0-9 2.65-10.84 6.45-.54 1.1.39 1.85 1.28 1.12a15.13 15.13 0 0 1 9.8-3.22 6 6 0 1 0 10.7 2.8 2 2 0 0 0-.12-.74l-.15-.38a6 6 0 0 0-1.64-2.48C91.9 17.32 88.5 16 85 16Z" fill="#000" fill-opacity=".6"/></g><g transform="translate(76 82)"><path d="M38.03 5.6c-1.48 8.38-14.1 14.17-23.24 10.42a2.04 2.04 0 0 0-2.64 1c-.43.97.04 2.1 1.05 2.5 11.45 4.7 26.84-2.37 28.76-13.3a1.92 1.92 0 0 0-1.64-2.2 2 2 0 0 0-2.3 1.57ZM73.97 5.6c1.48 8.38 14.1 14.17 23.24 10.42 1.02-.41 2.2.03 2.63 1 .43.97-.04 2.1-1.05 2.5-11.44 4.7-26.84-2.37-28.76-13.3a1.92 1.92 0 0 1 1.64-2.2 2 2 0 0 1 2.3 1.57Z" fill="#000" fill-opacity=".6"/></g><g transform="translate(-1)"><path fill-rule="evenodd" clip-rule="evenodd" d="M76 98c.35 1.49 1.67 1.22 2 0-.46-1.55 3.3-28.75 13-36 3.62-2.52 23-4.77 42.31-4.75 19.1 0 38.11 2.26 41.69 4.75 9.7 7.25 13.46 34.45 13 36 .33 1.22 1.65 1.49 2 0 .72-10.3 0-63.73-57-63-57 .73-57.72 52.7-57 63Z" fill="#2c1b18"/></g><g transform="translate(49 72)"/><g transform="translate(62 42)"/></g></g></svg>`
  const maskId = svg.match(/mask id="([^"]*)"/)
  return svg.replaceAll(maskId, getRandomId())
}

const fetchApi = async (url, options, timeout = 5000) => {
  const controller = new AbortController()
  const promise = fetch(url, options)
  const kill = new Promise(resolve => setTimeout(resolve, timeout))
  const res = await Promise.race([promise, kill])

  if (!res) {
    controller.abort()
    throw new Error('API took too long to respond')
  }

  const responseText = await res.text()
  if (!res.ok) { throw new Error(responseText) }

  return responseText
}

const getHeaders = () => {
  const requestHeaders = new Headers()
  requestHeaders.append('Accept', 'image/svg+xml')
  return requestHeaders
}
