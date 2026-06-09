import { useEffect, useState } from 'react';
import { fetchVersionCheck } from '../../lib/api';
import { useLocalStorage } from '../../hooks/useLocalStorage';

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  // Fallback for non-secure contexts (e.g. http://127.0.0.1)
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
}

export default function UpdateToast() {
  const [info, setInfo] = useState<{ installed: string; latest: string; installCommand: string } | null>(null);
  const [dismissed, setDismissed] = useLocalStorage<string>('acr-toast-dismissed', '');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchVersionCheck().then((v: any) => {
      if (v.updateAvailable && v.latest !== dismissed) setInfo(v);
    }).catch(() => {});
  }, []);

  if (!info) return null;

  async function handleCopy() {
    if (!info) return;
    const ok = await copyToClipboard(info.installCommand);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="update-toast">
      <span>Update available: {info.installed} → {info.latest}</span>
      <button className="btn-sm" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy install command'}
      </button>
      <button className="toast-close" onClick={() => { setDismissed(info.latest); setInfo(null); }}>✕</button>
    </div>
  );
}
