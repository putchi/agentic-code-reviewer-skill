let timer: ReturnType<typeof setTimeout> | null = null;
let lastOnTimeout: (() => void) | null = null;

export function resetIdle(onTimeout: () => void) {
  lastOnTimeout = onTimeout;
  if (timer) clearTimeout(timer);
  timer = setTimeout(onTimeout, 30 * 60 * 1000);
}

// Re-arm the idle timer without needing the callback — used by long-lived
// SSE streams so an active chat can't get the server shut down mid-stream.
export function touchIdle() {
  if (lastOnTimeout) resetIdle(lastOnTimeout);
}
