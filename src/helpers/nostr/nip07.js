// Helper function to get the public key, using peekPublicKey if available (for napp launchers),
// or falling back to getPublicKey (for browser extensions) in development mode.
export async function maybePeekPublicKey (signer = window.nostr) {
  if (signer?.peekPublicKey) {
    return await signer.peekPublicKey()
  }

  // In development, fall back to getPublicKey which prompts the user
  if (IS_DEVELOPMENT && signer?.getPublicKey) {
    return await signer.getPublicKey()
  }

  throw new Error('No Nostr extension found')
}
