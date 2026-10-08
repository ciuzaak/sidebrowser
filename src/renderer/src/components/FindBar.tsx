import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { FindResult } from '@shared/types';

interface Props {
  onClose: () => void;
  /** Bumped by App on every Ctrl+F so a second press re-focuses the input. */
  focusSignal: number;
}

/**
 * M16 find-in-page bar. Lives in the top overlay stack (page area), so the
 * page is offset below it, never covered. Typing starts a new search; Enter /
 * Shift+Enter (or the arrows) step through matches; Esc / × closes and clears
 * the highlight.
 */
export function FindBar({ onClose, focusSignal }: Props): ReactElement {
  const [text, setText] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  useEffect(() => window.sidebrowser.onFindResult(setResult), []);

  // Clear the page highlight when the bar goes away.
  useEffect(() => () => window.sidebrowser.findStop(), []);

  const search = (value: string): void => {
    setText(value);
    if (value === '') {
      setResult(null);
      window.sidebrowser.findStop();
      return;
    }
    void window.sidebrowser.findStart(value, true, true);
  };

  const step = (forward: boolean): void => {
    if (text !== '') void window.sidebrowser.findStart(text, forward, false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(!e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const count =
    text === '' || result === null
      ? ''
      : result.matches === 0
        ? 'No results'
        : `${result.activeMatchOrdinal}/${result.matches}`;

  const iconBtn =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] ' +
    'hover:bg-[var(--accent-tint)] hover:text-[var(--fg)] disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div
      data-testid="find-bar"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--surface-elevated)] px-2 shadow-[var(--shadow-elevated)]"
    >
      <input
        ref={inputRef}
        data-testid="find-input"
        value={text}
        onChange={(e) => search(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in page"
        spellCheck={false}
        className="h-[26px] min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] px-2 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)]"
      />
      <span
        data-testid="find-count"
        className={`min-w-[52px] shrink-0 text-right text-[11px] tabular-nums ${result?.matches === 0 ? 'text-[var(--danger)]' : 'text-[var(--fg-muted)]'}`}
      >
        {count}
      </span>
      <button type="button" aria-label="Previous match" data-testid="find-prev" disabled={!result?.matches} onClick={() => step(false)} className={iconBtn}>
        <ChevronUp size={14} />
      </button>
      <button type="button" aria-label="Next match" data-testid="find-next" disabled={!result?.matches} onClick={() => step(true)} className={iconBtn}>
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label="Close find bar" data-testid="find-close" onClick={onClose} className={iconBtn}>
        <X size={14} />
      </button>
    </div>
  );
}
