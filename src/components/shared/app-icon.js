import { f, useComputed, useSignal, useTask } from '#f'
import useWebStorage from '#hooks/use-web-storage.js'
import lru from '#services/lru.js'

f(function appIcon () {
  const storage = useWebStorage(localStorage)
  const appId$ = useComputed(() => this.props.app$().id)
  const appIndex$ = useComputed(() => this.props.app$().index ?? '?')
  const style$ = useComputed(() => this.props.style$?.() ?? this.props.style ?? '')

  const iconUrl$ = useSignal(null)
  const hasIcon$ = useComputed(() => !!iconUrl$())
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

  return hasIcon$()
    ? this.h`
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
    : this.h`
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
