import { X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { IconButton } from "./IconButton.tsx";
import "./Toast.css";

export interface ToastOptions {
  message: string;
  /** One action offered with the message, such as Undo. */
  action?: { label: string; run: () => void };
  /** How long it stays, in milliseconds. A toast with an action stays longer by default. */
  duration?: number;
}

const Context = createContext<(options: ToastOptions) => void>(() => undefined);

/** Shows a short message at the bottom of the screen, read out by screen readers. */
export const useToast = () => useContext(Context);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      window.clearTimeout(timer.current);
      setToast({ ...options, id: ++counter.current });
      timer.current = window.setTimeout(close, options.duration ?? (options.action ? 8000 : 4000));
    },
    [close],
  );

  return (
    <Context.Provider value={show}>
      {children}
      {/* Always in the page, so screen readers hear each new message in it. */}
      <div className="ui-toasts" role="status" aria-live="polite">
        {toast && (
          <div className="ui-toast" key={toast.id}>
            <span className="ui-toast-message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="plain ui-toast-action"
                onClick={() => {
                  toast.action!.run();
                  close();
                }}
              >
                {toast.action.label}
              </button>
            )}
            <IconButton
              label="Dismiss"
              icon={X}
              size="sm"
              className="ui-toast-close"
              onClick={close}
            />
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
