import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CircleDot, FileText, ListChecks, Moon, Plus, RefreshCw, Search, Settings2, Sun, User, Users } from 'lucide-react';
import { LogoMark } from '../components/Bulb.tsx';
import { Kbd } from '../ui/primitives.tsx';
import type { ThemePref } from '../lib/prefs.ts';
import { sortedMembers, useTeam } from './team.tsx';
import { buildDecisions } from './decisions.ts';

interface Command { id: string; group: string; label: string; icon: ReactNode; keys?: string; run: () => void; }

export default function CommandPalette({ open, onClose, theme, setTheme }: {
  open: boolean; onClose: () => void; theme: ThemePref; setTheme: (t: ThemePref) => void;
}) {
  const { base, summary, tasks, risks, suggestions, syncNow, openLog, openIdentity, openAsk, team } = useTeam();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(''); setActive(0);
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => prev?.focus?.();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => navigate(path);
    const open = buildDecisions(risks, suggestions).length;
    const list: Command[] = [];
    if (open) list.push({ id: 'review', group: 'Suggested', label: `Review ${open} decision${open === 1 ? '' : 's'}`, icon: <CircleDot size={16} />, run: go(base) });
    list.push(
      { id: 'ask', group: 'Actions', label: 'Ask Maestro', icon: <LogoMark size={16} />, run: () => openAsk() },
      { id: 'log', group: 'Actions', label: 'Log work', icon: <Plus size={16} />, keys: 'L', run: () => openLog() },
      ...(team && !team.is_demo ? [{ id: 'sync', group: 'Actions', label: 'Sync with GitHub', icon: <RefreshCw size={16} />, keys: 'S', run: () => { void syncNow(); } }] : []),
      { id: 'me', group: 'Actions', label: 'Change who I am on this device', icon: <User size={16} />, run: openIdentity },
      { id: 'theme', group: 'Actions', label: theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', icon: theme === 'light' ? <Moon size={16} /> : <Sun size={16} />, run: () => setTheme(theme === 'light' ? 'dark' : 'light') },
      { id: 'g-today', group: 'Go to', label: 'Today', icon: <Sun size={16} />, keys: 'G T', run: go(base) },
      { id: 'g-plan', group: 'Go to', label: 'Plan', icon: <ListChecks size={16} />, keys: 'G P', run: go(`${base}/plan`) },
      { id: 'g-people', group: 'Go to', label: 'People', icon: <Users size={16} />, keys: 'G E', run: go(`${base}/people`) },
      { id: 'g-report', group: 'Go to', label: 'Report', icon: <FileText size={16} />, keys: 'G R', run: go(`${base}/report`) },
      { id: 'g-maestro', group: 'Go to', label: 'Maestro', icon: <LogoMark size={16} />, keys: 'G M', run: go(`${base}/maestro`) },
      { id: 'g-settings', group: 'Go to', label: 'Settings', icon: <Settings2 size={16} />, keys: 'G S', run: go(`${base}/settings`) },
    );
    for (const m of sortedMembers(summary?.members)) {
      list.push({ id: `p-${m.memberId}`, group: 'People', label: m.displayName, icon: <Users size={16} />, run: go(`${base}/people/${m.memberId}`) });
    }
    for (const t of tasks ?? []) {
      if (t.github_issue_number == null) continue;
      list.push({ id: `t-${t.id}`, group: 'Tasks', label: `#${t.github_issue_number} ${t.title}`, icon: <CircleDot size={16} />, run: go(`${base}/plan/${t.github_issue_number}`) });
    }
    return list;
  }, [base, summary, tasks, risks, suggestions, navigate, openLog, openIdentity, openAsk, syncNow, theme, setTheme, team]);

  const q = query.trim().toLowerCase();
  const matches = q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands.filter(c => c.group !== 'Tasks');
  // Anything typed can be asked. Questions go first; plain searches keep their matches first.
  const askCmd: Command | null = q ? { id: 'ask-q', group: 'Ask Maestro', label: `Ask: “${query.trim()}”`, icon: <LogoMark size={16} />, run: () => openAsk(query.trim()) } : null;
  const looksLikeQuestion = /\?$/.test(q) || /^(who|what|why|how|when|where|which|is|are|did|does|can|should)\b/.test(q) || q.split(/\s+/).length >= 4;
  const results = askCmd ? (looksLikeQuestion || !matches.length ? [askCmd, ...matches.filter(c => c.id !== 'ask')] : [...matches, askCmd]) : matches;
  const shown = results.slice(0, 40);

  function run(c: Command | undefined) {
    if (!c) return;
    onClose();
    c.run();
  }

  if (!open) return null;
  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-black/30" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Search and commands"
        className="absolute top-[14vh] left-1/2 w-[640px] max-w-[92vw] -translate-x-1/2 animate-pop-in overflow-hidden rounded-[14px] border border-white/[0.06] bg-surface-1/85 shadow-[var(--shadow-glass)] backdrop-blur-xl backdrop-saturate-150"
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(shown[active]); }
          else if (e.key === 'Tab') e.preventDefault();
        }}>
        <div className="flex h-12 items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-fg-muted" aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(0); }}
            placeholder="Search, run a command, or ask Maestro" aria-label="Search, run a command, or ask Maestro"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[active] ? `cmd-${shown[active].id}` : undefined}
            className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-subtle" />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          
          {shown.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="none">
                {header && <div className="px-3 pt-2 pb-1 text-caption text-fg-subtle">{header}</div>}
                <div id={`cmd-${c.id}`} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)} onClick={() => run(c)}
                  className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-fg-muted aria-selected:bg-surface-3 aria-selected:text-fg">
                  <span className="grid w-4 place-items-center" aria-hidden="true">{c.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.keys && <span className="flex gap-1">{c.keys.split(' ').map(k => <Kbd key={k}>{k}</Kbd>)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
