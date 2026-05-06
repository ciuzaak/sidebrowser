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
 */
export function Favicon({ src, size = 16 }: Props): ReactElement {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  if (src === null || src === erroredSrc) {
    return <Globe size={size} className="shrink-0 text-[var(--chrome-muted)]" />;
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      onError={() => setErroredSrc(src)}
    />
  );
}
