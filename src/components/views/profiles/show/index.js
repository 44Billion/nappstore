import { f, useClosestStore, useStore } from '#f'

// Show a user's profile and their uploaded apps
f(function profilesShow () {
  const { params$ } = useClosestStore('<a-route>')
  const store = useStore(() => ({
    npub$ () { return params$().npub }
  }))

  return this.h`<div>Profile for user identified by ${store.npub$()}</div>`
})
