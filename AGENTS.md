# Project

This is Nappstore, a Nostr app store that enable users
to discover nostr apps (`napps`) and upload their own napps.

A `napp` is a good ol' static website bundled as a Nostr event. Each of its files is split into tiny chunk events, all signed by the author.

This project itself is a napp, so it is expected to be launched within
a `napp launcher`.

A `napp launcher` handles all the multi-account sign in/up flow and make the NIP-07's window.nostr object available to the napps.

Napps can use the new `await window.nostr.peekPublicKey()` method to learn who is the logged-in user.

The classic `await window.nostr.getPublicKey()` function is still there, but it was conceived to prompt the user for confirmation, while `peekPublicKey` is expected to be available when auto-login is on, which is the default when using a napp launcher.

As far as a installed napp is concerned, it always sees the same single logged user
that never changes and never logs out.

Other NIP07 methods:

```js
async window.nostr.signEvent(event: { created_at: number, kind: number, tags: string[][], content: string }): Event // takes an event object, adds `id`, `pubkey` and `sig` and returns it

async window.nostr.nip44.encrypt(pubkey, plaintext): string // returns ciphertext as specified in nip-44

async window.nostr.nip44.decrypt(pubkey, ciphertext): string // takes ciphertext as specified in nip-44
```

## General Instructions:

- Use vanilla Javascript.
- Use package.json "imports" aliases for importing files.
- Ensure all new functions and classes have regular comments instead of JSDoc with a brief description.
- Prefer functional programming paradigms where appropriate.
- Use kebab-case for filenames.
- If there is no "tests" root folder, don't create one and don't add tests.
- Do not change the src/assets/html/index.html file. Instead,
  change the src/components/app.js component (`<a-app>`) it loads. In fact keep
  app.js lean. It loads the src/components/router.js component,
  which then loads other components placed at src/components/views folder.
- Note that navigation should be performed using src/components/hooks/use-location.js
  hook's methods such as location.pushState and location.replaceState.

## Coding Style:

- Read and use current eslint.config.js rules.
- Avoid using semicolons.
- Prefer single quotes for strings.
- Use camel-case, but regarding JSON fields, you may keep the original key name
when turning it into a variable, even if it's not in camel-case.
- When declaring a function, object/class method or constructor. Add a space between its name and the parentheses.
- When declaring a generator, add a space between the function keyword and its asterisk.
- When using core node imports, add the "node:" prefix, e.g.: `import fs from 'node:fs'`.
- Prefer using promises instead of callbacks.

## Regarding Dependencies:

- Avoid introducing new external dependencies unless absolutely necessary.
- If a new dependency is required, please state the reason.
