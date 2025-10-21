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
  // oklch is like lsh (0-1, 0-0.26~0.37, 0-360)
  bg: 'oklch(0.22 0 219.69)',
  // bg: 'oklch(0.21 0.02 260.49)',
  // bg: 'oklch(0.12 0 264.48)',
  // bg2 is a card above bg; needs fg2 pair and maybe bg2Header etc
  bg2: 'oklch(0.27 0 219.69)',
  bg3: 'oklch(0.33 0 219.69)',
  bgSuccess: 'oklch(0.23 0 219.69)',
  bgError: 'oklch(0.23 0 219.69)',
  bgWarning: 'oklch(0.23 0 219.69)',
  bgInfo: 'oklch(0.23 0 219.69)',
  // bgHeader: 'oklch(0.21 0 264.48)',
  // bg(Active|Hover) if needed for :active/:hover states
  bgSelected: 'oklch(0.56 0.23 266.63)', // primary color
  bgSelected2: 'oklch(0.35 0 256)', // secondary color
  bgAvatar: 'oklch(0.25 0.01 271.18)',
  bgAvatarLoading: 'oklch(0.35 0.01 271.18)',
  fg: 'oklch(0.8 0 264.48)', // font color
  fg2: 'oklch(0.9 0 264.48)',
  fgLogo: 'oklch(0.87 0 258.33)',
  fgSuccess: 'oklch(0.62 0.15 162.48)',
  fgError: 'oklch(0.62 0.15 25.33)',
  fgWarning: 'oklch(0.62 0.15 70.08)',
  fgInfo: 'oklch(0.62 0.19 259.81)',
  // fgHeader: 'oklch(0.39 0 256)',
  //
  // primary: 'oklch(0.11 0.01 266.51)',
  // secondary: 'oklch(0.44 0.23 195.17)',
  // // background
  // bg: 'oklch(0.12 0 256)',
  // bgFont: 'oklch(0.87 0.01 256)',
  // bgAvatar: '#202124',
  // // middleground
  // mg: 'oklch(0.22 0 256)',
  // mgBorder: 'oklch(0.35 0 256)',
  // mgFont: 'oklch(0.79 0 256)',
  // // foreground
  // fg: 'oklch(0.35 0 256)',
  // fgPrimary: 'oklch(0.6 0.23 266.63)',
  // fgSecondary: 'oklch(0.6 0.23 195.17)',
  // fgFont: 'oklch(0.96 0.01 256)',
  // // foreforeground
  // ffg: 'oklch(0.49 0.01 17.47)',
  // accentPrimary: 'oklch(0.56 0.23 266.63)',
  // accentSecondary: 'oklch(0.56 0.23 195.17)',
  // success: 'oklch(0.72 0.19 149.58)',
  // error: 'oklch(0.55 0.22 25)'
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
