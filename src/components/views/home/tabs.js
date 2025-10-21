import { f, useStore, useComputed } from '#f'
import { cssVars } from '#assets/styles/theme.js'
import useLocation from '#hooks/use-location.js'
import '#shared/icons/icon-cube-spark.js'
import '#shared/icons/icon-arrow-big-up-line.js'

f(function homeTabs () {
  const loc = useLocation()
  const currentPath$ = useComputed(() => loc.route$().url.pathname)

  const store = useStore(() => ({
    onHomeClick (e) {
      e.preventDefault()
      loc.pushState(null, '', '/')
    },
    onUploadClick (e) {
      e.preventDefault()
      loc.pushState(null, '', '/upload')
    }
  }))

  const currentPath = currentPath$()
  const isHomeActive = currentPath === '/'
  const isUploadActive = currentPath === '/upload'

  const baseTabStyle = {
    padding: '8px 20px',
    borderRadius: '16px',
    fontSize: '14px',
    fontWeight: '600',
    textDecoration: 'none',
    transition: 'all 0.2s',
    cursor: 'pointer',
    border: '1px solid ' + cssVars.colors.bg2,
    outline: 'none',
    whiteSpace: 'nowrap'
  }

  const activeTabStyle = {
    ...baseTabStyle,
    backgroundColor: cssVars.colors.bgSelected,
    color: cssVars.colors.fg2,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
  }

  const inactiveTabStyle = {
    ...baseTabStyle,
    backgroundColor: cssVars.colors.bgSelected2,
    color: cssVars.colors.fg,
    border: '1px solid ' + cssVars.colors.bg2
  }

  return this.h`
    <div style=${{
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      padding: '8px 0'
    }}>
      <a
        href='/'
        onclick=${store.onHomeClick}
        style=${isHomeActive ? activeTabStyle : inactiveTabStyle}
        onmouseenter=${(e) => {
          if (!isHomeActive) {
            e.currentTarget.style.backgroundColor = cssVars.colors.mgBorder
          }
          e.currentTarget.style.transform = 'translateY(-2px)'
        }}
        onmouseleave=${(e) => {
          if (!isHomeActive) {
            e.currentTarget.style.backgroundColor = cssVars.colors.mg
          }
          e.currentTarget.style.transform = 'translateY(0)'
        }}
      >
        <icon-cube-spark
          props=${{
            weight$: 'duotone',
            style: 'svg { color: #fdd835; width: 1.2em; height: 1.2em; }'
          }}
        /><span style=${{ paddingLeft: '10px' }}>Discover</span>
      </a>

      <a
        href='/upload'
        onclick=${store.onUploadClick}
        style=${isUploadActive ? activeTabStyle : inactiveTabStyle}
        onmouseenter=${(e) => {
          if (!isUploadActive) {
            e.currentTarget.style.backgroundColor = cssVars.colors.mgBorder
          }
          e.currentTarget.style.transform = 'translateY(-2px)'
        }}
        onmouseleave=${(e) => {
          if (!isUploadActive) {
            e.currentTarget.style.backgroundColor = cssVars.colors.mg
          }
          e.currentTarget.style.transform = 'translateY(0)'
        }}
      >
        <icon-arrow-big-up-line
          props=${{
            weight$: 'duotone',
            style: `
              svg { color: #8cafbf; width: 1.2em; height: 1.2em; }
              path { fill-opacity: .4; }
            `
          }}
        /><span style=${{ paddingLeft: '7px' }}>Upload</span>
      </a>
    </div>
  `
})
