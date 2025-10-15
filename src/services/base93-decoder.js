// https://github.com/ticlo/arrow-code/blob/master/src/base93.ts
// https://github.com/ticlo/arrow-code/blob/master/LICENSE - Apache 2.0

// JSON-safe (space included; " and \ excluded)
const BASE93_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'()*+,-./:;<=>?@[]^_`{|}~ "

const DECODING_TABLE = (() => {
  const out = new Int16Array(128)
  out.fill(93) // sentinel = invalid
  for (let i = 0; i < 93; i++) out[BASE93_ALPHABET.charCodeAt(i)] = i
  return out
})()

/**
 * Decode Base93 string to Uint8Array
 * @param {string} str - The Base93 encoded string to decode
 * @param {number} [offset=0] - The starting position in the string
 * @param {number} [length=-1] - The number of characters to decode, or -1 for all remaining
 * @returns {Uint8Array} The decoded bytes
 */
export function decode (str, offset = 0, length = -1) {
  let end = offset + length
  if (length < 0 || end > str.length) end = str.length

  // Over-allocate; we’ll trim at the end
  const out = new Uint8Array(Math.ceil((end - offset) * 7 / 8))

  let dbq = 0
  let dn = 0
  let dv = -1
  let pos = 0

  for (let i = offset; i < end; i++) {
    const code = str.charCodeAt(i)
    if (code > 126) continue // ignore non-ASCII
    const v = DECODING_TABLE[code]
    if (v === 93) continue // ignore invalids
    if (dv === -1) {
      dv = v
    } else {
      const t = dv + v * 93
      dv = -1
      dbq |= t << dn
      dn += ((t & 0x1fff) > 456 ? 13 : 14)
      while (dn > 7) {
        out[pos++] = dbq & 0xff
        dbq >>>= 8
        dn -= 8
      }
    }
  }

  if (dv !== -1) {
    out[pos++] = (dbq | (dv << dn)) & 0xff
  }
  return out.subarray(0, pos)
}

export default class Base93Decoder {
  constructor (source, { mimeType = '', preferTextStreamDecoding = false } = {}) {
    this.sourceIterator = source?.[Symbol.iterator]?.() || source?.[Symbol.asyncIterator]?.() || source()
    this.asTextStream = preferTextStreamDecoding && mimeType.startsWith('text/')
    if (this.asTextStream) this.textDecoder = new TextDecoder()
  }

  // decoder generator
  * [Symbol.iterator] (base93String) {
    if (this.asTextStream) {
      while (base93String) {
        // stream=true avoids cutting a multi-byte character
        base93String = yield this.textDecoder.decode(decode(base93String), { stream: true })
      }
    } else {
      while (base93String) {
        base93String = yield decode(base93String)
      }
    }
  }

  // Gets the decoded data.
  getDecoded () { return iteratorToStream(this, this.sourceIterator) }
}

function iteratorToStream (decoder, sourceIterator) {
  return new ReadableStream({
    decoderIterator: null,
    async start (controller) {
      const { value: chunk, done } = await sourceIterator.next()
      if (done) return controller.close()

      // Pass first chunk when instantiating the decoder generator
      this.decoderIterator = decoder[Symbol.iterator](chunk)
      const { value } = this.decoderIterator.next()
      if (value) controller.enqueue(value)
    },
    async pull (controller) {
      if (!this.decoderIterator) return

      const { value: chunk, done: sourceDone } = await sourceIterator.next()
      const { value, done } = this.decoderIterator.next(chunk)

      if (value) controller.enqueue(value)
      if (done || sourceDone) controller.close()
    }
  })
}
