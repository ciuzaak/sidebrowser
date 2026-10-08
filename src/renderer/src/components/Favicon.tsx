import { useState, type ReactElement } from 'react';
import { Globe } from 'lucide-react';

interface Props {
  src: string | null;
  size?: number;
}

/**
 * Small favicon image with a Globe icon fallback.
 *
 * Rendering an `<img>` for an external favicon URL can fail — the host may be
 * down, the URL may have rotated, or the response may not be an image. We
 * track the specific `src` URL that produced an error so the fallback is
 * automatically dismissed whenever `src` changes — even when the component
 * instance is reused across a list (e.g., NewTab keyed by URL where the
 * favicon updates after a page-favicon-updated event lands).
 *
 * M17: drawn on a `--favicon-tile` square so dark favicons stay visible in
 * the dark theme. The Globe fallback gets the same box (no tile) so rows align.
 */
export function Favicon({ src, size = 16 }: Props): ReactElement {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const box = { width: size + 4, height: size + 4 };
  if (src === null || src === erroredSrc) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center" style={box}>
        <Globe size={size} className="text-[var(--fg-muted)]" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] bg-[var(--favicon-tile)]"
      style={box}
    >
      <img src={src} alt="" width={size} height={size} onError={() => setErroredSrc(src)} />
    </span>
  );
}
