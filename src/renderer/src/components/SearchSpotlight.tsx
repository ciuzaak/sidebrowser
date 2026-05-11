import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { useActiveTab } from '../store/tab-store';
import { useSettingsStore } from '../store/settings-store';
import { normalizeUrlInput } from '@shared/url';
import { AddressSuggestions, type AddressSuggestionsHandle } from './AddressSuggestions';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Ref to the SearchPill trigger. Outside-click ignores mousedown on the
   *  pill so clicking it again while open doesn't close-then-reopen. */
  pillRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Spotlight — centered modal that owns the address-bar input + suggestions.
 *
 * Chrome's old inline address bar was unusable on a 380 px side-panel window
 * (titleBarOverlay reservation + 6 IconButtons left ~50 px for the input).
 * The Spotlight defers all typing/searching to a wider floating panel that
 * pops up when the user clicks the SearchPill in TopBar (or presses Cmd+L).
 *
 * Behavior:
 *  - On open: input mounts, auto-focuses + selects current URL.
 *  - On Esc / outside-click / submit: onClose fires.
 *  - Arrow keys drive the suggestions handle, Enter navigates (picked URL or
 *    search-engine template), mirroring the prior TopBar form.
 *  - When closed, returns null — no input is in the DOM, so view suppression
 *    handled by the parent (App.tsx) is the only thing keeping the page area
 *    visible.
 *
 * `data-testid="address-bar"` is preserved on the input so existing E2E tests
 * keep their selectors; helpers open the spotlight before driving it.
 */
export function SearchSpotlight({ open, onClose, pillRef }: Props): ReactElement | null {
  const tab = useActiveTab();
  const settings = useSettingsStore((s) => s.settings);
  const [draft, setDraft] = useState<string>(() => {
    const url = tab?.url ?? '';
    return url === 'about:blank' ? '' : url;
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<AddressSuggestionsHandle | null>(null);
  // Suggestions are open whenever the spotlight is open AND the input is
  // focused — same lifecycle here since the spotlight only renders when open.
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  // No mid-render URL re-sync: the spotlight returns null when closed, so the
  // useState initializer above runs on every (re)open and seeds the draft
  // from the live tab.url. Unmount-on-close is the reset mechanism.

  // Focus + select on open. useLayoutEffect to avoid a flash where the user
  // could see the input unfocused before the autofocus tick runs.
  useLayoutEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    setSuggestionsOpen(true);
  }, [open]);

  // Esc + outside-click dismissal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (pillRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose, pillRef]);

  if (!open) return null;

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!tab) return;
    const picked = suggestionsRef.current?.currentUrl() ?? null;
    let url: string;
    if (picked !== null) {
      url = picked;
    } else {
      const search = settings?.search;
      const tpl =
        search?.engines.find((eng) => eng.id === search.activeId)?.urlTemplate ??
        'https://www.google.com/search?q={query}';
      url = normalizeUrlInput(draft, tpl);
    }
    void window.sidebrowser.navigate(tab.id, url);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionsRef.current?.moveDown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionsRef.current?.moveUp();
    }
    // Esc is captured by the document listener above (works even if the
    // suggestions list has stolen focus).
  };

  const handlePick = (url: string): void => {
    if (!tab) return;
    void window.sidebrowser.navigate(tab.id, url);
    onClose();
  };

  return (
    <div
      data-testid="search-spotlight"
      className="absolute inset-0 z-20 flex items-start justify-center bg-black/30"
    >
      <div
        ref={panelRef}
        className="mt-12 flex w-[88%] max-w-[420px] flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-elevated)] shadow-[var(--shadow-elevated)]"
      >
        <form onSubmit={submit} className="relative p-1.5">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setSuggestionsOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search or enter URL"
            spellCheck={false}
            data-testid="address-bar"
            className={
              'h-9 w-full rounded-[var(--radius-md)] px-3 text-sm ' +
              'bg-transparent text-[var(--fg)] placeholder-[var(--fg-muted)] ' +
              'outline-none'
            }
          />
          <AddressSuggestions
            ref={suggestionsRef}
            query={draft}
            open={suggestionsOpen}
            onPick={handlePick}
          />
        </form>
      </div>
    </div>
  );
}
