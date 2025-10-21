export function maybeUnref (timer) {
  timer.unref?.()
  return timer
}
