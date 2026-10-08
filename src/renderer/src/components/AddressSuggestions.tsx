import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { Suggestion } from '@shared/types';
import { splitMatch } from '../lib/split-match';
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
  /** M17: highlighted suggestion URL (null when none) — drives the Spotlight Enter hint. */
  onHighlightChange?: (url: string | null) => void;
}

/**
 * Address-bar suggestion list. Shows up to 8 history suggestions. Highlight
 * state is internal; the parent (SearchSpotlight) drives navigation via ref
 * methods because the input owns the keyboard event channel. M17: renders
 * in-flow inside the Spotlight card (no floating dropdown) and emphasizes
 * the query match in titles and URLs.
 */
export const AddressSuggestions = forwardRef<AddressSuggestionsHandle, Props>(
  function AddressSuggestions({ query, open, onPick, onHighlightChange }, ref): ReactElement | null {
    const [items, setItems] = useState<Suggestion[]>([]);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    // Latest items kept in a ref so the imperative handle's currentUrl()
    // returns a fresh value without re-creating the handle on every list update.
    // Synced in a layout effect (not during render) — the handle is only
    // called from event handlers, which run after commit.
    const itemsRef = useRef<Suggestion[]>(items);
    const highlightRef = useRef<number>(-1);
    useLayoutEffect(() => {
      itemsRef.current = items;
      highlightRef.current = highlightIdx;
    }, [items, highlightIdx]);

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

    useEffect(() => {
      onHighlightChange?.(highlightIdx >= 0 ? (items[highlightIdx]?.url ?? null) : null);
    }, [highlightIdx, items, onHighlightChange]);

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
        className="max-h-80 overflow-y-auto border-t border-[var(--border-subtle)] p-1"
        data-testid="address-suggestions"
      >
        {items.map((s, i) => (
          <li
            key={s.url}
            className={
              'flex items-center gap-2 cursor-pointer rounded-[var(--radius-md)] px-2 py-1.5 ' +
              (i === highlightIdx
                ? 'bg-[var(--accent-tint)] text-[var(--accent-text)] '
                : 'hover:bg-[var(--accent-tint)] ')
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
              <div className="text-sm truncate">
                <Emph text={s.title || s.url} query={query} />
              </div>
              <div className="text-xs text-[var(--fg-muted)] truncate">
                <Emph text={s.url} query={query} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  },
);

function Emph({ text, query }: { text: string; query: string }): ReactElement {
  const parts = splitMatch(text, query);
  if (parts === null) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <mark className="bg-transparent font-semibold text-inherit">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}
