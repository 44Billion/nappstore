import { f } from '#f'
import '#f/components/f-to-signals.js'
import '#shared/app-icon.js'
import '#shared/avatar.js'
import { cssVars } from '#assets/styles/theme.js'

const DEFAULT_CURATION_D_TAG = 'starred'

function appAddress (app) {
  return `${app.kind}:${app.pubkey}:${app.dTag}`
}

function renderBubbleIcon (h, app, onOpenApp) {
  return h({ key: app.id })`
    <f-to-signals
      props=${{
        from: ['app'],
        app,
        render: ({ h, props }) => h`
          <div
            title=${app.name}
            onclick=${(e) => {
              e.stopPropagation()
              onOpenApp(app)
            }}
            style=${{
              width: '100%',
              height: '100%',
              cursor: 'pointer',
              borderRadius: '8px',
              overflow: 'hidden',
              backgroundColor: cssVars.colors.bgAvatar,
              color: cssVars.colors.fg2
            }}
          >
            <app-icon props=${props} />
          </div>
        `
      }}
    />
  `
}

// Curation set summary card. `group$` and `apps$` arrive as signals.
f('curation-set-card', ({ h, props }) => {
  const group = props.group$()
  const apps = props.apps$()
  const author = props.author$()
  const { onOpenApp, onOpenCard } = props
  const authorPending = author?.pending ?? !author?.pubkey
  const authorName = author?.name || 'Anonymous'
  const isAnonymous = !authorPending && !author?.name
  const allApps = apps.filter(app => group.addresses.includes(appAddress(app)))
  const shownApps = allApps.slice(0, 4)
  const overflowCount = allApps.length - shownApps.length
  const title = group.title || group.dTag.toUpperCase()
  const description = group.description ||
    (group.dTag === DEFAULT_CURATION_D_TAG ? 'Apps starred by this author.' : '')

  return h`
    <div
      class='nappstore-curation-card'
      onclick=${() => onOpenCard(group)}
      style=${{
        display: 'flex',
        gap: '12px',
        alignItems: 'stretch',
        padding: '12px',
        backgroundColor: cssVars.colors.bg2,
        borderRadius: '12px',
        border: '2px solid ' + cssVars.colors.bg2,
        minWidth: 0,
        boxSizing: 'border-box',
        cursor: 'pointer',
        transition: 'all 0.2s'
      }}
      onmouseenter=${(e) => {
        e.currentTarget.style.borderColor = cssVars.colors.bgSelected
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onmouseleave=${(e) => {
        e.currentTarget.style.borderColor = cssVars.colors.bg2
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div style=${{
        width: '104px',
        height: '104px',
        flexShrink: 0,
        alignSelf: 'flex-start',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: '4px',
        padding: '6px',
        backgroundColor: cssVars.colors.bgAvatar,
        borderRadius: '14px'
      }}>
        ${
          [0, 1, 2, 3].map(slot => shownApps[slot]
            ? renderBubbleIcon(h, shownApps[slot], onOpenApp)
            : h`<div style=${{ width: '100%', height: '100%' }} />`)
        }
      </div>
      <div style=${{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '4px 0'
      }}>
        <div style=${{
          fontSize: '15px',
          fontWeight: '600',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: cssVars.colors.fg3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          ${title}
        </div>
        ${
          description
            ? h`
                <div style=${{
                  fontSize: '13px',
                  color: cssVars.colors.fg2,
                  lineHeight: '1.4',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  ${description}
                </div>
              `
            : ''
        }
        ${
          overflowCount > 0
            ? h`
                <div style=${{
                  fontSize: '12px',
                  color: cssVars.colors.fg3,
                  marginTop: '4px',
                  fontWeight: '600'
                }}>
                  +${overflowCount} more
                </div>
              `
            : ''
        }
        ${
          author?.pubkey
            ? h`
                <div style=${{
                  marginTop: 'auto',
                  paddingTop: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  minWidth: 0
                }}>
                  <div style=${{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    overflow: 'hidden',
                    backgroundColor: cssVars.colors.bgAvatar,
                    flexShrink: 0
                  }}>
                    <a-avatar props=${{ pk: author.pubkey, style: 'svg { width: 100%; height: 100%; border-radius: 50%; }' }} />
                  </div>
                  <div style=${{
                    fontSize: '12px',
                    color: authorPending ? 'transparent' : cssVars.colors.fg2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: authorPending ? '84px' : 'auto',
                    minHeight: authorPending ? '14px' : 'auto',
                    borderRadius: authorPending ? '7px' : '0',
                    backgroundColor: authorPending
                      ? cssVars.colors.bgAvatarLoading
                      : 'transparent',
                    animation: authorPending
                      ? 'metadataTextPulse 1.4s ease-in-out infinite'
                      : 'none'
                  }}>
                    ${
                      authorPending
                        ? ''
                        : h`<span style=${{ fontStyle: isAnonymous ? 'italic' : 'normal' }}>
                            ${authorName}
                          </span>`
                    }
                  </div>
                </div>
              `
            : ''
        }
      </div>
    </div>
  `
})
