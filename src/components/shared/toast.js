import { f, useStore, useGlobalStore } from '#f'
import { cssVars } from '#assets/styles/theme.js'
import '#shared/icons/icon-x.js'
import '#shared/icons/icon-check.js'
import '#shared/icons/icon-exclamation-mark.js'
import '#shared/icons/icon-info-small.js'

let toastIdCounter = 0

// Show a toast notification
export function showToast (toastStore, message, type = 'info', duration = 3000) {
  const id = toastIdCounter++
  const toasts = toastStore.toasts$()

  toastStore.toasts$([...toasts, { id, message, type, duration }])

  if (duration > 0) {
    setTimeout(() => {
      removeToast(toastStore, id)
    }, duration)
  }

  return id
}

export function useToast (toastStore) {
  toastStore ??= useGlobalStore('<a-toast>')
  return useStore(() => ({
    showToast (message, type = 'info', duration = 3000) {
      return showToast(toastStore, message, type, duration)
    },
    removeToast (id) { removeToast(toastStore, id) }
  }))
}

// Remove a toast by id
export function removeToast (toastStore, id) {
  const toasts = toastStore.toasts$()
  toastStore.toasts$(toasts.filter(t => t.id !== id))
}

// Toast container component
f('aToast', function () {
  const toastStore = useGlobalStore('<a-toast>', () => ({
    toasts$: []
  }))
  const {
    removeToast
  } = useToast(toastStore)

  const getToastColor = (type) => {
    switch (type) {
      case 'success':
        return { color: cssVars.colors.fgSuccess, backgroundColor: cssVars.colors.bgSuccess }
      case 'error':
        return { color: cssVars.colors.fgError, backgroundColor: cssVars.colors.bgError }
      case 'warning':
        return { color: cssVars.colors.fgWarning, backgroundColor: cssVars.colors.bgWarning }
      case 'info':
      default:
        return { color: cssVars.colors.fgInfo, backgroundColor: cssVars.colors.bgInfo }
    }
  }

  const getToastIcon = type => {
    switch (type) {
      case 'success':
        return this.h`<icon-check />`
      case 'error':
        return '✗'
      case 'warning':
        return this.h`<icon-exclamation-mark />`
      case 'info':
      default:
        return this.h`<icon-info-small />`
    }
  }

  return this.h`
    <div style=${{
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      maxWidth: '400px',
      pointerEvents: 'none'
    }}>
      ${toastStore.toasts$().map(toast => {
        const { color, backgroundColor } = getToastColor(toast.type)
        const icon = getToastIcon(toast.type)

        return this.h({ key: toast.id })`
          <div
            key=${toast.id}
            style=${{
              backgroundColor,
              color,
              padding: '16px 20px',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '14px',
              fontWeight: '500',
              pointerEvents: 'auto',
              cursor: 'pointer',
              animation: 'slideIn 0.3s ease-out',
              maxWidth: '100%'
            }}
            onclick=${() => removeToast(toast.id)}
          >
            <div style=${{
              fontSize: '18px',
              flexShrink: 0,
              fontWeight: 'bold'
            }}>
              ${icon}
            </div>
            <div style=${{
              flex: 1,
              lineHeight: '1.4',
              wordBreak: 'break-word'
            }}>
              ${toast.message}
            </div>
            <div style=${{
              color: cssVars.colors.fg2,
              fontSize: '16px',
              opacity: 0.7,
              flexShrink: 0,
              fontWeight: 'bold'
            }}>
              <icon-x />
            </div>
          </div>
        `
      })}
    </div>

    <style>
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    </style>
  `
})
