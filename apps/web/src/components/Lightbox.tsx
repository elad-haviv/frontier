import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useShortcut } from "../keys.ts";
import { IconButton } from "./ui/IconButton.tsx";

interface Shot {
  /** The address the page shows (scaled). */
  src: string;
  /** The address of the original file. */
  full: string;
  alt: string;
}

const Open = createContext<(src: string) => void>(() => undefined);

/** Opens the lightbox on the image with this address. */
export const useLightbox = () => useContext(Open);

const original = (src: string) => src.replace(/&w=\d+$/, "");

/**
 * Shows an entry's images large, over the page. The images are the ones inside `scope` at the
 * moment one is opened, in reading order.
 */
export function LightboxProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const opener = useRef<Element | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const open = useCallback(
    (src: string) => {
      const found = [...document.querySelectorAll<HTMLImageElement>(`${scope} img`)]
        .filter((img) => img.naturalWidth > 0)
        .map((img) => ({
          src: img.currentSrc || img.src,
          full: original(img.currentSrc || img.src),
          alt: img.alt,
        }));
      const index = found.findIndex((s) => s.src.endsWith(src) || s.src === src);
      if (found.length === 0 || index === -1) return;
      opener.current = document.activeElement;
      setShots(found);
      setZoomed(false);
      setAt(index);
    },
    [scope],
  );

  const close = useCallback(() => {
    setAt(null);
    if (opener.current instanceof HTMLElement) opener.current.focus();
  }, []);

  const step = useCallback(
    (by: number) => {
      setZoomed(false);
      setAt((i) => (i === null ? i : (i + by + shots.length) % shots.length));
    },
    [shots.length],
  );

  const showing = at !== null;
  useShortcut("lightbox.close", close, showing);
  useShortcut("lightbox.next", () => step(1), showing);
  useShortcut("lightbox.previous", () => step(-1), showing);

  useEffect(() => {
    if (!showing) return;
    // The page behind must not scroll while the image is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [showing]);

  const shot = at === null ? null : shots[at];
  const many = shots.length > 1;

  return (
    <Open.Provider value={open}>
      {children}
      {shot && (
        <div
          className={`lightbox${zoomed ? " is-zoomed" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={shot.alt ? `Image: ${shot.alt}` : "Image"}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onTouchStart={(e) => {
            const t = e.touches[0];
            touch.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            const t = e.changedTouches[0];
            touch.current = null;
            if (!start || !t || zoomed) return;
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            // A sideways swipe moves between images; a swipe down closes.
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && many)
              step(dx < 0 ? 1 : -1);
            else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
          }}
        >
          <div className="lightbox-bar">
            <span className="lightbox-caption">
              {shot.alt}
              {many && (
                <span className="lightbox-count">
                  {" "}
                  {at! + 1} / {shots.length}
                </span>
              )}
            </span>
            <a href={shot.full} target="_blank" rel="noopener noreferrer" className="lightbox-link">
              Original
            </a>
            <IconButton
              ref={closeButton}
              className="lightbox-button"
              label="Close"
              icon={X}
              shortcut="lightbox.close"
              tipSide="bottom"
              onClick={close}
            />
          </div>

          <div
            className="lightbox-stage"
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <img
              key={shot.src}
              src={zoomed ? shot.full : shot.src}
              alt={shot.alt}
              onClick={() => setZoomed(!zoomed)}
              title={zoomed ? "Tap to fit the screen" : "Tap to see it full size"}
            />
          </div>

          {many && !zoomed && (
            <>
              <IconButton
                className="lightbox-button lightbox-prev"
                label="Previous image"
                icon={ChevronLeft}
                size="lg"
                shortcut="lightbox.previous"
                onClick={() => step(-1)}
              />
              <IconButton
                className="lightbox-button lightbox-next"
                label="Next image"
                icon={ChevronRight}
                size="lg"
                shortcut="lightbox.next"
                onClick={() => step(1)}
              />
            </>
          )}
        </div>
      )}
    </Open.Provider>
  );
}
