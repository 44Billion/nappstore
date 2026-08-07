/*
 * Theme architecture
 * ------------------
 * This module is the single source of authored UI colors. Components consume
 * cssVars.colors instead of embedding color literals; the palette lives here as
 * { light, dark } pairs that become light-dark(light, dark), with
 * `color-scheme: light dark` in global.css letting the browser follow
 * prefers-color-scheme natively. UGC media (avatars, images, video) is
 * intentionally outside this palette and must not receive theme filters.
 *
 * Each theme is emitted once, as a class with a stable, deterministic name,
 * applied to document.documentElement. Because <html> is the root of the DOM
 * tree, every element — including fixed overlays and top-layer boxes —
 * inherits the same variables through the normal inheritance chain. Adding
 * another theme means registering another class here and swapping the class
 * on <html>.
 *
 * Purpose-specific palettes (app-icon monograms and tab decorations) also
 * live here; they are decorative and do not follow WCAG text floors.
 */
const colorPair = (light, dark) => Object.freeze({ light, dark })

export const defaultThemeColorValues = Object.freeze({
  bg: colorPair('oklch(0.97 0.005 219.69)', 'oklch(0.22 0 219.69)'),
  bg2: colorPair('oklch(0.99 0.005 219.69)', 'oklch(0.27 0 219.69)'),
  bg3: colorPair('oklch(0.93 0.005 219.69)', 'oklch(0.33 0 219.69)'),
  bgSelected: colorPair('oklch(0.50 0.23 266.63)', 'oklch(0.56 0.23 266.63)'),
  bgSelected2: colorPair('oklch(0.90 0 256)', 'oklch(0.35 0 256)'),
  bgAvatar: colorPair('oklch(0.90 0.01 271.18)', 'oklch(0.25 0.01 271.18)'),
  bgAvatarLoading: colorPair('oklch(0.85 0.01 271.18)', 'oklch(0.35 0.01 271.18)'),
  bgSuccess: colorPair('oklch(0.96 0.005 219.69)', 'oklch(0.23 0 219.69)'),
  bgError: colorPair('oklch(0.96 0.005 219.69)', 'oklch(0.23 0 219.69)'),
  bgWarning: colorPair('oklch(0.96 0.005 219.69)', 'oklch(0.23 0 219.69)'),
  bgInfo: colorPair('oklch(0.96 0.005 219.69)', 'oklch(0.23 0 219.69)'),
  fg: colorPair('oklch(0.25 0 264.48)', 'oklch(0.8 0 264.48)'),
  fg2: colorPair('oklch(0.35 0 264.48)', 'oklch(0.9 0 264.48)'),
  fg3: colorPair('oklch(0.40 0 264.48)', 'oklch(0.85 0 264.48)'),
  fgSuccess: colorPair('oklch(0.50 0.16 162.48)', 'oklch(0.62 0.15 162.48)'),
  fgError: colorPair('oklch(0.48 0.20 25.33)', 'oklch(0.66 0.15 25.33)'),
  fgWarning: colorPair('oklch(0.52 0.14 70.08)', 'oklch(0.64 0.15 70.08)'),
  fgInfo: colorPair('oklch(0.48 0.19 259.81)', 'oklch(0.62 0.19 259.81)'),
  error: colorPair('oklch(0.55 0.20 25.33)', 'oklch(0.55 0.20 25.33)'),
  fgOnAccent: colorPair('oklch(0.98 0 0)', 'oklch(0.98 0 0)'),
  shadow: colorPair('rgb(0 0 0 / 0.12)', 'rgb(0 0 0 / 0.15)'),
  tabDiscover: colorPair('#b8860b', '#fdd835'),
  tabUpload: colorPair('#5c7c8f', '#8cafbf')
})

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

function toCssValue (value) {
  return `light-dark(${value.light}, ${value.dark})`
}

function toCssVarName (key) {
  return `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
}

function createCssDeclarations (colors, cssVars = {}) {
  return Object.entries(colors).map(([key, value]) => {
    const cssVarName = toCssVarName(key)
    cssVars[key] = `var(${cssVarName})`
    return `  ${cssVarName}: ${toCssValue(value)};`
  }).join('\n')
}

function createThemeClass (name, colors) {
  const cssVars = {}
  const declarations = createCssDeclarations(colors, cssVars)
  return Object.freeze({
    name,
    cssClass: name,
    cssVars,
    css: `.${name} {\n${declarations}\n}`
  })
}

const defaultTheme = createThemeClass('theme-default', defaultThemeColorValues)

export const themes = Object.freeze({
  default: defaultTheme
})

const themesByContract = new Map([
  [defaultThemeColorValues, defaultTheme]
])

export function getThemeByContract (colors) {
  return themesByContract.get(colors) ?? null
}

export const cssStrings = {
  defaultTheme: defaultTheme.css
}

export const cssClasses = {
  defaultTheme: defaultTheme.cssClass
}

export const cssVars = {
  colors: defaultTheme.cssVars
}

export const jsVars = {
  breakpoints: {
    mobile: '(max-width: 718px)',
    desktop: '(min-width: 719px)'
  }
}
