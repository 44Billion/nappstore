import { f, useComputed, useSignal, useTask } from '#f'
import useWebStorage from '#hooks/use-web-storage.js'
import lru from '#services/lru.js'

// Displays an app icon from cache, a pulsating placeholder while loading, or a fallback index
f('appIcon', function () {
  const storage = useWebStorage(localStorage)
  const appId$ = useComputed(() => this.props.app$().id)
  const appIndex$ = useComputed(() => this.props.app$().index ?? '?')
  const appFx$ = useComputed(() => this.props.app$().fx ?? null)
  const style$ = useComputed(() => this.props.style$?.() ?? this.props.style ?? '')

  const iconUrl$ = useSignal(null)
  const hasIcon$ = useComputed(() => !!iconUrl$())
  const isPending$ = useComputed(() => !!appFx$() && !iconUrl$())
  const previousCachedIconFx$ = useSignal(null)

  // Check for cached icon first, then load if needed
  useTask(async ({ track }) => {
    const [, cachedIcon] = track(() => [appId$(), lru.ns('apps').getReactiveItem(`appById_${appId$()}_icon`, storage)])
    if (cachedIcon?.fx && previousCachedIconFx$() === cachedIcon.fx) return

    previousCachedIconFx$(cachedIcon?.fx || null)

    // Check if icon is already cached in storage
    if (cachedIcon?.url) {
      iconUrl$(cachedIcon.url)
      return
    }

    // If no cached icon, reset the icon URL
    iconUrl$(null)
  })

  if (hasIcon$()) {
    return this.h`
      <img
        src=${iconUrl$()}
        alt="App Icon"
        style=${`
          width: 100%;
          height: 100%;
          object-fit: cover;
          ${style$()}
        `}
      />
    `
  }

  if (isPending$()) {
    return this.h`
      <style>
        @keyframes iconPulse {
          0% { opacity: 0.1; }
          50% { opacity: 0.25; }
          100% { opacity: 0.1; }
        }
      </style>
      <span style=${`
        display: flex;
        width: 100%;
        height: 100%;
        border-radius: inherit;
        background: currentColor;
        opacity: 0.1;
        animation: iconPulse 1.4s ease-in-out infinite;
        ${style$()}
      `} />
    `
  }

  return this.h`
    <span style=${`
      font-weight: bold;
      font-size: 14px;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
      ${style$()}
    `}>${appIndex$()}</span>
  `
})
