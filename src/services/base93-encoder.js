// https://github.com/ticlo/arrow-code/blob/master/src/base93.ts
// https://github.com/ticlo/arrow-code/blob/master/LICENSE - Apache 2.0

// JSON-safe (space included; " and \ excluded)
const BASE93_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'()*+,-./:;<=>?@[]^_`{|}~ "
const ENCODING_TABLE = (() => {
  const out = new Uint16Array(93)
  for (let i = 0; i < 93; i++) out[i] = BASE93_ALPHABET.charCodeAt(i)
  return out
})()

function codesToString (codes, len) {
  const CHUNK = 16384 // 16k chars per slice
  let s = ''
  for (let i = 0; i < len; i += CHUNK) {
    const end = i + CHUNK < len ? i + CHUNK : len
    s += String.fromCharCode.apply(
      null,
      Array.prototype.slice.call(codes, i, end)
    )
  }
  return s
}

export default class Base93Encoder {
  constructor (prefix = '') {
    // bit reservoir
    this._ebq = 0 // queued bits
    this._en = 0  // number of bits in ebq

    // output parts
    this._parts = []
    this._finished = false

    if (prefix) this._parts.push(prefix)
  }

  // Stream bytes; keeps reservoir across calls.
  update (bytes) {
    if (this._finished) throw new Error('Encoder already finalized.')
    const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)

    // Over-allocate for this update; we’ll trim to 'pos'
    const outCodes = new Uint16Array(Math.ceil(src.length * 8 / 6.5) + 4)
    let pos = 0

    let ebq = this._ebq
    let en = this._en
    let ev = 0

    for (let i = 0; i < src.length; i++) {
      ebq |= (src[i] & 0xff) << en
      en += 8
      if (en > 13) {
        ev = ebq & 0x1fff
        if (ev > 456) {
          ebq >>>= 13
          en -= 13
        } else {
          ev = ebq & 0x3fff
          ebq >>>= 14
          en -= 14
        }
        outCodes[pos++] = ENCODING_TABLE[ev % 93]
        outCodes[pos++] = ENCODING_TABLE[(ev / 93) | 0]
      }
    }

    // persist reservoir
    this._ebq = ebq
    this._en = en

    if (pos) this._parts.push(codesToString(outCodes, pos))
    return this
  }

  // Finalize on first call: flush trailing partial block, join, lock.
  getEncoded () {
    if (!this._finished) {
      if (this._en > 0) {
        const outCodes = new Uint16Array(2)
        let pos = 0
        outCodes[pos++] = ENCODING_TABLE[this._ebq % 93]
        if (this._en > 7 || this._ebq > 92) {
          outCodes[pos++] = ENCODING_TABLE[(this._ebq / 93) | 0]
        }
        this._parts.push(codesToString(outCodes, pos))
      }
      this._finished = true
      this._ebq = 0
      this._en = 0
    }
    return this._parts.join('')
  }
}
