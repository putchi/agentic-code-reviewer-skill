import { useEffect, useState } from 'react';
import { fetchVersionCheck } from '../../lib/api';
import { useLocalStorage } from '../../hooks/useLocalStorage';

export default function UpdateToast() {
  const [info, setInfo] = useState<{ installed: string; latest: string; installCommand: string } | null>(null);
  const [dismissed, setDismissed] = useLocalStorage<string>('acr-toast-dismissed', '');

  useEffect(() => {
    fetchVersionCheck().then((v: any) => {
      if (v.updateAvailable && v.latest !== dismissed) setInfo(v);
    }).catch(() => {});
  }, []);

  if (!info) return null;

  return (
    <div className="update-toast">
      <span>Update available: {info.installed} → {info.latest}</span>
      <button className="btn-sm" onClick={() => { navigator.clipboard.writeText(info.installCommand).catch(() => {}); }}>
        Copy install command
      </button>
      <button className="toast-close" onClick={() => { setDismissed(info.latest); setInfo(null); }}>✕</button>
    </div>
  );
}
