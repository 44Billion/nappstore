import { f } from '#f'
import '#f/components/f-to-signals.js'
import '#shared/app-icon.js'
import '#shared/avatar.js'
import '#shared/icons/icon-link.js'
import '#shared/icons/icon-star.js'
import { cssVars } from '#assets/styles/theme.js'

function getAppDescription (...values) {
  return values
    .find(value => typeof value === 'string' && value.trim())
    ?.trim() || ''
}

// Renders one normal app list item. All data props arrive as signals.
f('app-list-item', ({ h, props }) => {
  const app = props.app$()
  const profile = props.profile$()
  const isStarred = props.isStarred$()
  const hasUser = props.hasUser$()
  const isPendingOpen = props.isPendingOpen$()
  const { onOpen, onToggleStar, onCopyUrl } = props
  const isAuthorPending = !profile
  const publishedAuthorName = profile?.meta?.generatedName
    ? ''
    : [profile?.name, profile?.display_name]
        .find(name => typeof name === 'string' && name.trim())
        ?.trim() || ''
  const isAnonymous = !isAuthorPending && !publishedAuthorName
  const authorName = publishedAuthorName || 'Anonymous'
  const description = getAppDescription(app.description)
  const isDescriptionPending = app.descriptionResolutionPending && !description
  const isDescriptionFallback = !isDescriptionPending && !description

  return h`
    <f-to-signals
      props=${{
        from: ['app', 'profile'],
        app,
        profile,
        render: ({ h, props }) => h`
          <div
            data-app-id=${app.id}
            onclick=${onOpen}
            style=${{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '12px',
              backgroundColor: cssVars.colors.bg2,
              borderRadius: '12px',
              border: '2px solid ' + cssVars.colors.bg2,
              cursor: 'pointer',
              transition: 'all 0.2s',
              position: 'relative'
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
            ${
              isPendingOpen
                ? h`
                    <div style=${{
                      position: 'absolute',
                      inset: '0',
                      borderRadius: '12px',
                      backgroundColor: cssVars.colors.bgSelected,
                      pointerEvents: 'none',
                      animation: 'feedbackPulse 1.2s ease-in-out infinite',
                      opacity: 0.2,
                      zIndex: 1
                    }} />
                  `
                : ''
            }
            <div style=${{
              width: '56px',
              height: '56px',
              flexShrink: 0,
              backgroundColor: cssVars.colors.bgAvatar,
              borderRadius: '12px',
              overflow: 'hidden',
              color: cssVars.colors.fg2
            }}>
              <app-icon props=${props} />
            </div>

            <div style=${{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minWidth: 0
            }}>
              <div style=${{
                fontSize: '16px',
                fontWeight: 'bold',
                color: cssVars.colors.fg2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                ${app.name}
              </div>
              <div style=${{
                fontSize: '13px',
                color: isDescriptionPending ? 'transparent' : cssVars.colors.fg2,
                opacity: isDescriptionFallback ? 0.6 : 1,
                fontStyle: isDescriptionFallback ? 'italic' : 'normal',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: isDescriptionPending ? '65%' : 'auto',
                maxWidth: '100%',
                minHeight: '15px',
                borderRadius: isDescriptionPending ? '7px' : '0',
                backgroundColor: isDescriptionPending
                  ? cssVars.colors.bgAvatarLoading
                  : 'transparent',
                animation: isDescriptionPending
                  ? 'metadataTextPulse 1.4s ease-in-out infinite'
                  : 'none'
              }}>
                ${isDescriptionPending ? '' : description || 'No description'}
              </div>
              <div style=${{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: 'auto',
                position: 'relative',
                bottom: '5px'
              }}>
                <div style=${{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  backgroundColor: cssVars.colors.bgAvatar,
                  flexShrink: 0
                }}>
                  <a-avatar
                    props=${{
                      pk: app.pubkey,
                      profile$: props.profile$,
                      style: 'svg { width: 100%; height: 100%; border-radius: 50%; }'
                    }}
                  />
                </div>
                <div style=${{
                  fontSize: '12px',
                  color: isAuthorPending ? 'transparent' : cssVars.colors.fg2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  width: isAuthorPending ? '84px' : 'auto',
                  minHeight: '14px',
                  borderRadius: isAuthorPending ? '7px' : '0',
                  backgroundColor: isAuthorPending
                    ? cssVars.colors.bgAvatarLoading
                    : 'transparent',
                  animation: isAuthorPending
                    ? 'metadataTextPulse 1.4s ease-in-out infinite'
                    : 'none'
                }}>
                  ${isAuthorPending ? '' : 'by '}
                  <span style=${{ fontStyle: isAnonymous ? 'italic' : 'normal' }}>
                    ${isAuthorPending ? '' : authorName}
                  </span>
                </div>
              </div>
            </div>

            <div style=${{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              alignItems: 'center',
              flexShrink: 0
            }}>
              <button
                title=${isStarred ? 'Remove from starred' : 'Add to starred'}
                onclick=${(e) => {
                  e.stopPropagation()
                  onToggleStar()
                }}
                style=${{
                  cursor: hasUser ? 'pointer' : 'not-allowed',
                  opacity: hasUser ? 1 : 0.35,
                  border: 'none',
                  background: 'transparent',
                  color: isStarred ? cssVars.colors.tabDiscover : cssVars.colors.fg3,
                  padding: '4px'
                }}
              >
                <icon-star
                  props=${{
                    size: '18px',
                    weight: 'thin',
                    fill: isStarred ? 'currentColor' : 'none'
                  }}
                />
              </button>
              <button
                title='Copy app URL'
                onclick=${(e) => {
                  e.stopPropagation()
                  onCopyUrl()
                }}
                style=${{
                  cursor: 'pointer',
                  border: 'none',
                  background: 'transparent',
                  color: cssVars.colors.fg3,
                  padding: '4px'
                }}
              >
                <icon-link props=${{ size: '16px' }} />
              </button>
            </div>
          </div>
        `
      }}
    />
  `
})
