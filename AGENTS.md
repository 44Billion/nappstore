# Project

This is +App, a Nostr app store that enable users
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

- There are AGENTS.md files on many of the projects subfolders explaining further
what is expected to be on each of these subfolders and how to use them. After finishing
reading this current AGENTS.md file, find and read all the other
ones to get the project's complete picture.
- Use vanilla Javascript.
- Use package.json "imports" aliases for importing files.
- Ensure all new functions and classes have regular comments instead of JSDoc with a brief description.
- Prefer functional programming paradigms where appropriate.
- Use kebab-case for filenames.
- If there is no "tests" root folder, don't create one and don't add tests.
- Do not change the src/assets/html/index.html file. Instead,
  change the src/components/app.js component (`<a-app>`) it loads (the root component).
  In fact keep app.js lean. It loads the src/components/router.js component,
  which then loads other components placed at src/components/views folder.
- This is a SPA using pathname URLs and the browser History API. Use
  `useLocation` from `#f` with `url-router` and import
  `#f/components/f-route.js` to render matched views. Navigate through the
  location store's `pushState`, `replaceState`, `back`, and `forward` methods.
  Read route data from `props.route$` or `useClosestStore('<f-route>').route$`.
  Keep nested routers scoped to their owning components and verify deep links,
  reloads, and browser Back/Forward. Do not restore the legacy `a-route` copy.

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

## Styling Rules:

- Colors come from `src/assets/styles/theme.js`: each token is a
  `light-dark(<light>, <dark>)` pair resolved natively from
  `prefers-color-scheme` (`color-scheme: light dark` in `global.css`). Do not
  author color literals (`oklch(...)`, `#hex`, `rgb(...)`, `light-dark(...)`)
  outside `theme.js` (or the `inverted-colors` accessibility rule in
  `reset.css`); consume tokens via `cssVars.colors.*`. UGC media (avatars,
  images, video) must never receive theme inversion filters.
- Component `<style>` tags render into the global stylesheet scope — always
  scope selectors under the component's host tag or a root id. Never write
  top-level class selectors inside a component's style block.
- Interaction is mobile-first: never use `:hover` as feedback. Use `:active`,
  `:focus-visible` and `:disabled` with theme tokens.
- The CSS reset sets `html { font-size: 0.0625em }`, so `1rem ≈ 1px`: use
  `rem` for `font-size` only and `px` for everything else.

## Regarding Dependencies:

- Avoid introducing new external dependencies unless absolutely necessary.
- If a new dependency is required, please state the reason.

## Connectivity recovery

- Use `isOnline` and `onOnline` from `libp2r2p/network`. The shared library
  monitor owns connectivity probes, capped retry delays, and browser wake-up
  listeners. `ConnectivityRetryCoordinator` owns waiters, cancellation, and
  concurrency of resumed app work; do not restore its duplicate probe timer.
- These consumer changes depend on the companion libp2r2p monitor update.
  Until it is published, validate against the sibling library locally. Update
  the npm dependency and lockfile to a version containing it before shipping;
  the current published version does not contain the monitor.

## Local publishing credentials

- This workspace shares the encrypted publisher configuration with other nsites/apps
  in `$HOME/repositories/napps/.env`. Export `DOTENV_CONFIG_PATH` with that absolute
  path in the shell running nappup; Bash startup files configure it locally.
- Restart existing shells/watchers, or export the variable before publishing.
  The path is private environment configuration, not an app asset. Never copy
  credentials into bundles, logs, or version control. Preserve the shared identity;
  do not generate or migrate keys implicitly. Use separate dotenv files for tests.

## Local nappup checkout

- Run `npm run link:nappup` after initial installation, switching Node/npm, or
  `npm ci`. Install dependencies in `../../nappup` first. The script registers
  that checkout globally for the active Node installation, then restores the
  local link with `--no-save --package-lock=false`; keep links out of the lockfile.
- Keep nappup declared as a runtime dependency because the in-app uploader imports
  it. The local link overrides the registry package during development.
- `npm run upload` builds and invokes the installed nappup CLI; do not bypass the
  checkout with `npx nappup@latest`. Restart active build/watch processes after
  changing the link. Linking does not select or migrate publisher credentials.

## Upload recovery messages

- nappup owns success thresholds and signer classification. Only a rejected
  publication sets the user-facing upload error; partial replication failures
  remain console diagnostics. Do not promote individual log messages to errors.
- Use `NAPPUP_*` codes and `details.failures` records (`destination`, optional
  `filename`, original `reason`). Prefer a specific action only when it applies
  to every blocking destination; retain a general message for mixed failures.
- Keep the manifest-failure context: files can upload successfully before the
  app publication fails. Do not parse server messages to classify signing errors.
- Validate recovery messages against the linked nappup API with
  `tests/helpers/upload-error.test.js`; no legacy error-message parsing is needed.
