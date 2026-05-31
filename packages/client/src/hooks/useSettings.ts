import { useState, useEffect, useCallback } from 'react';
import { fetchSettings, patchSettings, type Settings } from '../lib/api';

const DEFAULTS: Settings = {
  autoCloseMs: 0,
  firstRunDone: false,
  platform: '',
  provider: 'claude',
  providerLabel: 'Claude',
  chatModel: 'sonnet',
  chatModelLabel: 'Claude Sonnet',
  modelRole: 'balanced',
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await fetchSettings();
      setSettings(s);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    let rollback: Settings | null = null;
    setSettings(prev => {
      rollback = prev;
      return { ...prev, ...patch };
    });
    try {
      const updated = await patchSettings(patch);
      setSettings(updated);
      return updated;
    } catch (error) {
      if (rollback) setSettings(rollback);
      throw error;
    }
  }, []);

  return { settings, updateSettings, isLoading };
}
