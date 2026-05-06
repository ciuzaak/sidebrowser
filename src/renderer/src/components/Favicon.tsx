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
 * track an `errored` flag and switch to the Globe icon on any of those
 * conditions, plus the trivial null-src case.
 */
export function Favicon({ src, size = 16 }: Props): ReactElement {
  const [errored, setErrored] = useState(false);
  if (src === null || errored) {
    return <Globe size={size} className="shrink-0 text-[var(--chrome-muted)]" />;
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      onError={() => setErrored(true)}
    />
  );
}
