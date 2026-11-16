import { useCallback, useEffect, useState } from 'react';

/* Device-local preferences. Nothing here is team data; it never changes what others see. */

export type ThemePref = 'dark' | 'light' | 'system';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => (read('maestro.theme') as ThemePref) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(pref));
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => document.documentElement.setAttribute('data-theme', resolveTheme('system'));
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);
  const set = useCallback((t: ThemePref) => { write('maestro.theme', t); setPref(t); }, []);
  return [pref, set];
}

/** "I'm Rio": which member this device belongs to, per team. No accounts. */
export function useMe(teamId: number): [number | null, (id: number | null) => void] {
  const key = `maestro.me.${teamId}`;
  const [me, setMeState] = useState<number | null>(() => {
    const v = read(key);
    return v ? Number(v) : null;
  });
  useEffect(() => {
    const v = read(key);
    setMeState(v ? Number(v) : null);
  }, [key]);
  const setMe = useCallback((id: number | null) => { write(key, id === null ? null : String(id)); setMeState(id); }, [key]);
  return [me, setMe];
}

export function wasAsked(teamId: number): boolean { return read(`maestro.me.asked.${teamId}`) === '1'; }
export function markAsked(teamId: number) { write(`maestro.me.asked.${teamId}`, '1'); }
