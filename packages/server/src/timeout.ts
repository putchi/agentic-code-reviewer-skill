let timer: ReturnType<typeof setTimeout> | null = null;
export function resetIdle(onTimeout: () => void) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(onTimeout, 30 * 60 * 1000);
}
