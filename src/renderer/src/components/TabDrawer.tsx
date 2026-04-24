import { X, Plus, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTabsStore } from '../store/tab-store';

interface TabDrawerProps {
  open: boolean;
  onSelect: () => void;
}

export function TabDrawer({ open, onSelect }: TabDrawerProps): ReactElement | null {
  const tabs = useTabsStore((s) => s.tabs);
  const order = useTabsStore((s) => s.tabOrder);
  const activeId = useTabsStore((s) => s.activeId);

  if (!open) return null;

  const createTab = async (): Promise<void> => {
    await window.sidebrowser.createTab();
    onSelect();
  };

  const activate = async (id: string): Promise<void> => {
    if (id !== activeId) await window.sidebrowser.activateTab(id);
    onSelect();
  };

  const close = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation();
    await window.sidebrowser.closeTab(id);
    // If the last tab was closed, main auto-creates a blank; snapshot will update.
  };

  return (
    <div
      data-testid="tab-drawer"
      className="flex max-h-[60vh] w-full flex-col overflow-y-auto border-b border-[var(--chrome-border)] bg-[var(--chrome-bg)]"
    >
      <DrawerButton
        icon={Plus}
        label="New tab"
        testId="tab-drawer-new"
        onClick={createTab}
      />
      {order.map((id) => {
        const tab = tabs[id];
        if (!tab) return null;
        const label = tab.title.trim() || tab.url || 'Loading…';
        const isActive = id === activeId;
        return (
          <button
            key={id}
            type="button"
            data-testid="tab-drawer-item"
            data-tab-id={id}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => void activate(id)}
            className={
              'flex w-full items-center gap-2 border-b border-[var(--chrome-border)] px-3 py-2 text-left text-sm hover:bg-[var(--chrome-hover)] ' +
              (isActive ? 'bg-[var(--chrome-hover)] text-sky-400' : 'text-[var(--chrome-fg)]')
            }
          >
            {tab.favicon ? (
              <img
                src={tab.favicon}
                alt=""
                width={14}
                height={14}
                className="shrink-0 rounded-sm"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
            ) : (
              <span className="inline-block h-[14px] w-[14px] shrink-0" aria-hidden />
            )}
            <span className="flex-1 truncate">{label}</span>
            <span
              role="button"
              aria-label="Close tab"
              data-testid="tab-drawer-close"
              onClick={(e) => void close(e, id)}
              className="rounded p-1 text-[var(--chrome-muted)] hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-fg)]"
            >
              <X size={14} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DrawerButton({
  icon: Icon,
  label,
  testId,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  testId: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center gap-2 border-b border-[var(--chrome-border)] px-3 py-2 text-left text-sm text-[var(--chrome-fg)] hover:bg-[var(--chrome-hover)]"
    >
      <Icon size={14} />
      <span>{label}</span>
    </button>
  );
}
