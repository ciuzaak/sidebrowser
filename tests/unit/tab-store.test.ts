import { describe, it, expect, beforeEach } from 'vitest';
import { useTabsStore } from '../../src/renderer/src/store/tab-store';
import type { Tab, TabsSnapshot } from '../../src/shared/types';
import { makeEmptyTab } from '../../src/shared/types';

function freshStore(): void {
  useTabsStore.setState({ tabs: {}, tabOrder: [], activeId: null });
}

describe('useTabsStore', () => {
  beforeEach(freshStore);

  describe('setSnapshot', () => {
    it('replaces the entire state with the new snapshot', () => {
      const a = makeEmptyTab('a', 'https://a.com');
      const b = makeEmptyTab('b', 'https://b.com');
      const snapshot: TabsSnapshot = { tabs: [a, b], activeId: 'b' };

      useTabsStore.getState().setSnapshot(snapshot);

      const state = useTabsStore.getState();
      expect(state.tabs).toEqual({ a, b });
      expect(state.tabOrder).toEqual(['a', 'b']);
      expect(state.activeId).toBe('b');
    });

    it('preserves snapshot order in tabOrder', () => {
      const c = makeEmptyTab('c', 'https://c.com');
      const a = makeEmptyTab('a', 'https://a.com');
      const b = makeEmptyTab('b', 'https://b.com');
      useTabsStore.getState().setSnapshot({ tabs: [c, a, b], activeId: 'a' });
      expect(useTabsStore.getState().tabOrder).toEqual(['c', 'a', 'b']);
    });

    it('zeros out the store when snapshot has no tabs', () => {
      useTabsStore.setState({
        tabs: { x: makeEmptyTab('x', 'https://x.com') },
        tabOrder: ['x'],
        activeId: 'x',
      });

      useTabsStore.getState().setSnapshot({ tabs: [], activeId: null });

      const state = useTabsStore.getState();
      expect(state.tabs).toEqual({});
      expect(state.tabOrder).toEqual([]);
      expect(state.activeId).toBeNull();
    });
  });

  describe('upsertTab', () => {
    it('overwrites an existing tab by id', () => {
      const a: Tab = { ...makeEmptyTab('a', 'https://a.com'), title: 'Old' };
      useTabsStore.getState().setSnapshot({ tabs: [a], activeId: 'a' });

      const updated: Tab = { ...a, title: 'New', isLoading: true };
      useTabsStore.getState().upsertTab(updated);

      expect(useTabsStore.getState().tabs['a']).toEqual(updated);
    });

    it('does NOT update tabOrder, even for an unknown id (orphan tab)', () => {
      useTabsStore.getState().setSnapshot({
        tabs: [makeEmptyTab('a', 'https://a.com')],
        activeId: 'a',
      });

      const orphan = makeEmptyTab('ghost', 'https://ghost.com');
      useTabsStore.getState().upsertTab(orphan);

      const state = useTabsStore.getState();
      expect(state.tabs['ghost']).toEqual(orphan);
      // tabOrder is unchanged — the orphan tab is invisible to ordered iteration.
      expect(state.tabOrder).toEqual(['a']);
    });
  });
});
