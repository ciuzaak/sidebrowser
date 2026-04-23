import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { TabDrawer } from './components/TabDrawer';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTabBridge } from './hooks/useTabBridge';
import { useWindowStateBridge } from './hooks/useWindowStateBridge';

export function App(): ReactElement {
  useTabBridge();
  useWindowStateBridge();
  useSettingsBridge();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const chromeRef = useRef<HTMLDivElement | null>(null);

  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;

    const report = (): void => {
      window.sidebrowser.setChromeHeight(el.getBoundingClientRect().height);
    };

    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={chromeRef} className="shrink-0">
        <TopBar drawerOpen={drawerOpen} onToggleDrawer={toggleDrawer} />
        <TabDrawer open={drawerOpen} onSelect={closeDrawer} />
      </div>
      {/* WebContentsView is overlaid by main below the chrome area. */}
      <div className="flex-1" />
    </div>
  );
}
