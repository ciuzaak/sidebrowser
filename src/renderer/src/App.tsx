import { useEffect, useRef, type ReactElement } from 'react';
import { TopBar } from './components/TopBar';
import { useTabBridge } from './hooks/useTabBridge';

export function App(): ReactElement {
  useTabBridge();

  const chromeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;

    const report = (): void => {
      window.sidebrowser.setChromeHeight(el.getBoundingClientRect().height);
    };

    // Initial report + subsequent updates on size changes (e.g. window resize, DPI change).
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={chromeRef} className="shrink-0">
        <TopBar />
      </div>
      {/* The region below is where the WebContentsView is overlaid by main; we leave it empty. */}
      <div className="flex-1" />
    </div>
  );
}
