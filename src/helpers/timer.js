export function maybeUnref (timer) {
  if (typeof window === 'undefined') timer.unref()
  return timer
}
