# assets folder

- Place assets such as html on the html subfolder, images/vidoes on the media subfolder, and css on the styles subfolder.

## General Instructions:

- For styling, don't change src/assets/styles/global.css if possible, prefer using style tags inside components (see componets folder's AGENTS.md for more info on styling components)
- The src/assets/styles/theme.js file is the single source of authored colors:
each token is a light-dark(<light>, <dark>) pair resolved natively from
prefers-color-scheme. Do not author color literals outside theme.js (or the
inverted-colors rule in reset.css); consume tokens via cssVars.colors.*.
Media breakpoints also live there.
- For css's font-size prefer using the rem unit.
  For that, consider 1rem equals 1px, so if you were to use 16px, use instead 16rem.
  For things other than font-size do not use rem.
