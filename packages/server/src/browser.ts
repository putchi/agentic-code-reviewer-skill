export function openBrowser(url: string) {
  if (process.env.ACR_NO_OPEN === '1') return;
  const plat = process.platform;
  const cmd = plat === 'darwin' ? ['open', url]
            : plat === 'win32'  ? ['cmd', '/c', 'start', '', url]
            :                     ['xdg-open', url];
  try { Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }).unref?.(); } catch {}
}
