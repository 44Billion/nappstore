function createTheme (obj) {
  const themeCssClass = `theme-${Math.random().toString(36).slice(2)}`
  const cssVars = {}
  const cssString =
`.${themeCssClass} {
${Object.entries(obj).map(([k, v], i, array) => {
  const cssVarName = `--${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`
  cssVars[k] = `var(${cssVarName})`

  return `  ${cssVarName}: ${v};` + ((array.length - 1) === i ? '' : '\n')
}).join('')}
}
`
  return [themeCssClass, cssVars, cssString]
}

const [defaultThemeCssClass, colorCssVarsObj, defaultThemeCssString] = createTheme({
  bg: 'oklch(0.12 0 256)',
  bgFont: 'oklch(0.87 0.01 256)',
  mg: 'oklch(0.22 0 256)',
  mgBorder: 'oklch(0.35 0 256)',
  mgFont: 'oklch(0.79 0 256)',
  fg: 'oklch(0.35 0 256)',
  fgPrimary: 'oklch(0.44 0.16 291.61)',
  fgSecondary: 'oklch(0.53 0.13 56.36)',
  fgFont: 'oklch(0.96 0.01 256)',
  ffg: 'oklch(0.49 0.01 17.47)',
  accentPrimary: 'oklch(0.56 0.25 256)',
  accentSecondary: 'oklch(0.56 0.25 195.17)',
  primary: 'oklch(0.62 0.12 256)',
  secondary: 'oklch(0.70 0.11 195.17)',
  success: 'oklch(0.72 0.19 149.58)',
  error: 'oklch(0.55 0.22 25)'
})

export const cssStrings = {
  defaultTheme: defaultThemeCssString
}

export const cssClasses = {
  defaultTheme: defaultThemeCssClass
}

export const cssVars = {
  colors: colorCssVarsObj
}

export const jsVars = {
  breakpoints: {
    mobile: '(max-width: 718px)',
    desktop: '(min-width: 719px)'
  }
}
