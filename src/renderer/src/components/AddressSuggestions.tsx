import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { Suggestion } from '@shared/types';
import { Favicon } from './Favicon';

const SUGGEST_DROPDOWN_MAX = 8;

export interface AddressSuggestionsHandle {
  /** Move highlight down by 1; wraps at the bottom. No-op if list empty. */
  moveDown(): void;
  /** Move highlight up by 1; wraps at the top. No-op if list empty. */
  moveUp(): void;
  /** URL of the currently highlighted item, or null if none. */
  currentUrl(): string | null;
}

interface Props {
  query: string;
  open: boolean;
  onPick: (url: string) => void;
}

/**
 * Address-bar dropdown. Shows up to 8 history suggestions. Highlight state
 * is internal; parent (TopBar) drives navigation via ref methods because the
 * input owns the keyboard event channel.
 */
export const AddressSuggestions = forwardRef<AddressSuggestionsHandle, Props>(
  function AddressSuggestions({ query, open, onPick }, ref): ReactElement | null {
    const [items, setItems] = useState<Suggestion[]>([]);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    // Latest items kept in a ref so the imperative handle's currentUrl()
    // returns a fresh value without re-creating the handle on every list update.
    const itemsRef = useRef<Suggestion[]>(items);
    itemsRef.current = items;
    const highlightRef = useRef<number>(-1);
    highlightRef.current = highlightIdx;

    // Fetch suggestions whenever query changes (or dropdown re-opens).
    useEffect(() => {
      if (!open) return;
      let cancelled = false;
      void window.sidebrowser
        .historySuggest(query)
        .then((next) => {
          if (cancelled) return;
          setItems(next.slice(0, SUGGEST_DROPDOWN_MAX));
          setHighlightIdx(-1);
        })
        .catch((err: unknown) => {
          console.error('[sidebrowser] AddressSuggestions historySuggest failed', err);
        });
      return () => {
        cancelled = true;
      };
    }, [open, query]);

    // Refresh on history mutation (e.g. a deleted-from-NewTab entry vanishes
    // here too if the dropdown happens to be open at the time).
    useEffect(() => {
      if (!open) return;
      const off = window.sidebrowser.onHistoryChanged(() => {
        void window.sidebrowser
          .historySuggest(query)
          .then((next) => {
            setItems(next.slice(0, SUGGEST_DROPDOWN_MAX));
          })
          .catch((err: unknown) => {
            console.error('[sidebrowser] AddressSuggestions historySuggest failed', err);
          });
      });
      return off;
    }, [open, query]);

    useImperativeHandle(
      ref,
      () => ({
        moveDown(): void {
          const len = itemsRef.current.length;
          if (len === 0) return;
          setHighlightIdx((cur) => (cur + 1 + len) % len);
        },
        moveUp(): void {
          const len = itemsRef.current.length;
          if (len === 0) return;
          setHighlightIdx((cur) => (cur === -1 ? len - 1 : (cur - 1 + len) % len));
        },
        currentUrl(): string | null {
          const i = highlightRef.current;
          if (i < 0 || i >= itemsRef.current.length) return null;
          return itemsRef.current[i]!.url;
        },
      }),
      [],
    );

    if (!open || items.length === 0) return null;

    return (
      <ul
        className="absolute left-0 right-0 top-full mt-1 z-10 max-h-96 overflow-y-auto rounded border border-[var(--chrome-border)] bg-[var(--chrome-bg)] shadow-lg"
        data-testid="address-suggestions"
      >
        {items.map((s, i) => (
          <li
            key={s.url}
            className={
              'flex items-center gap-2 px-2 py-1 cursor-pointer ' +
              (i === highlightIdx ? 'bg-[var(--chrome-hover)]' : 'hover:bg-[var(--chrome-hover)]')
            }
            onMouseDown={(ev) => {
              ev.preventDefault();
              onPick(s.url);
            }}
            onMouseEnter={() => setHighlightIdx(i)}
            data-testid="address-suggestions-item"
          >
            <Favicon src={s.favicon} />
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{s.title || s.url}</div>
              <div className="text-xs text-[var(--chrome-muted)] truncate">{s.url}</div>
            </div>
          </li>
        ))}
      </ul>
    );
  },
);
