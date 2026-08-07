import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  cssClasses,
  cssStrings,
  cssVars,
  defaultThemeColorValues,
  getThemeByContract,
  themes
} from '#assets/styles/theme.js'

const sourceRoot = path.resolve(import.meta.dirname, '../src')
const themeSource = path.join(sourceRoot, 'assets/styles/theme.js')

const textPairs = [
  ['fg', 'bg'],
  ['fg2', 'bg2'],
  ['fg2', 'bgAvatar'],
  ['fg', 'bgSelected2'],
  ['fg3', 'bg3'],
  ['fg', 'bgAvatar'],
  ['fgInfo', 'bg'],
  ['fgSuccess', 'bgSuccess'],
  ['fgError', 'bgError'],
  ['fgWarning', 'bgWarning'],
  ['fgInfo', 'bgInfo'],
  ['fgOnAccent', 'bgSelected'],
  ['fgOnAccent', 'error']
]

describe('native color themes', () => {
  it('keeps the CSS-variable API and emits a single stable theme class', () => {
    for (const key of Object.keys(defaultThemeColorValues)) {
      assert.equal(cssVars.colors[key], `var(--${toKebabCase(key)})`)
      assert.ok(defaultThemeColorValues[key].light, `${key} must define a light value`)
      assert.ok(defaultThemeColorValues[key].dark, `${key} must define a dark value`)
    }

    assert.equal(cssClasses.defaultTheme, 'theme-default')
    assert.equal(themes.default.name, 'theme-default')
    assert.equal(getThemeByContract(defaultThemeColorValues), themes.default)
    assert.match(cssStrings.defaultTheme, /^\.theme-default/)
    assert.match(cssStrings.defaultTheme, /--bg: light-dark\(/)
    assert.doesNotMatch(cssStrings.defaultTheme, /:root/)
  })

  it('applies the theme class once on documentElement instead of embedding it', async () => {
    const appSource = await readFile(path.join(sourceRoot, 'components/app.js'), 'utf8')
    assert.match(appSource, /document\.documentElement\.classList\.add\(cssClasses\.defaultTheme\)/)

    const files = (await listSourceFiles(sourceRoot)).filter(file => file !== themeSource)
    for (const file of files) {
      if (file.endsWith('components/app.js')) continue
      const source = await readFile(file, 'utf8')
      assert.doesNotMatch(
        source,
        /cssStrings\.defaultTheme|cssClasses\.defaultTheme/,
        path.relative(sourceRoot, file)
      )
    }
  })

  it('keeps every used text pair at WCAG AA contrast in both schemes', () => {
    for (const scheme of ['light', 'dark']) {
      for (const [foreground, background] of textPairs) {
        assert.ok(
          contrastRatio(
            defaultThemeColorValues[foreground][scheme],
            defaultThemeColorValues[background][scheme]
          ) >= 4.5,
          `${scheme} ${foreground}/${background} must reach 4.5:1`
        )
      }
    }
  })

  it('keeps authored color literals and dead inversion classes out of consumers', async () => {
    const files = (await listSourceFiles(sourceRoot)).filter(file => file !== themeSource)
    const authoredColorLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\(/i
    const authoredColorKeyword = /(?:color|background(?:-color)?|border(?:-color)?|fill|stroke)\s*:\s*(?:black|white)\b/i

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const relative = path.relative(sourceRoot, file)
      assert.doesNotMatch(source, authoredColorLiteral, relative)
      assert.doesNotMatch(source, authoredColorKeyword, relative)
      assert.doesNotMatch(source, /\b(?:hue-revert)\b/, relative)
      if (!file.endsWith('assets/styles/reset.css')) {
        assert.doesNotMatch(source, /filter\s*:\s*invert\(/, relative)
      }
      // Purpose-specific exception: app-icon monograms keep a local
      // light-dark() pair fed by the theme.js palettes (like the
      // inverted-colors rule, it is not an authored theme literal).
      if (!file.endsWith('components/shared/app-icon.js')) {
        assert.doesNotMatch(source, /light-dark\(/, relative)
      }
    }
  })
})

async function listSourceFiles (directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(entryPath)
    return /\.(?:css|html|js)$/.test(entry.name) ? [entryPath] : []
  }))
  return nestedFiles.flat()
}

function toKebabCase (value) {
  return value.replace(/([A-Z])/g, '-$1').toLowerCase()
}

function contrastRatio (foreground, background) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance (color) {
  const match = /^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/.exec(color)
  assert.ok(match, `Expected an opaque OKLCH color, received ${color}`)
  const [, lightness, chroma, hue] = match.map(Number)
  const hueRadians = hue * Math.PI / 180
  const a = chroma * Math.cos(hueRadians)
  const b = chroma * Math.sin(hueRadians)
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3
  const [red, green, blue] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map(channel => Math.min(1, Math.max(0, channel)))

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}
