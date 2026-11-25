import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { isFree } from "../keys.ts";

export interface ConfirmOptions {
  title: string;
  /** More words under the title. Line breaks are kept. */
  body?: string;
  /** The label of the button that goes ahead. */
  action?: string;
  /** Draws the button as a warning, for something that cannot be undone. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  body?: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  action?: string;
  inputMode?: "text" | "decimal";
}

type Open = { id: number } & (
  | { kind: "confirm"; options: ConfirmOptions; answer: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; answer: (value: string | null) => void }
);

interface Dialogs {
  /** Asks the author to confirm. Resolves true to go ahead and false to leave things as they are. */
  confirm(options: ConfirmOptions): Promise<boolean>;
  /** Asks for a line of text. Resolves null when the author cancels. */
  prompt(options: PromptOptions): Promise<string | null>;
}

const Context = createContext<Dialogs | null>(null);

/** Styled questions in place of the browser's own boxes. */
export function useDialogs(): Dialogs {
  const dialogs = useContext(Context);
  if (!dialogs) throw new Error("useDialogs needs a DialogProvider above it.");
  return dialogs;
}

/** What can take the focus inside a dialog, for keeping Tab inside it. */
const FOCUSABLE = 'input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The one dialog of the app: a box over a dimmed page that keeps the focus inside, closes on
 * Escape or a click beside it, and gives the focus back to where it was. The confirm and prompt
 * questions below use it, and so does any dialog that needs fields of its own.
 */
export function DialogFrame({
  title,
  body,
  onCancel,
  onSubmit,
  initialFocus,
  className,
  children,
}: {
  title: string;
  body?: string;
  onCancel: () => void;
  onSubmit: () => void;
  /** What gets the focus when the dialog opens; the first field or button when not given. */
  initialFocus?: { current: HTMLElement | null };
  className?: string;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  // Its own id: one dialog may open over another (the image dialog over Terrain).
  const titleId = useId();
  const before = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const first =
      initialFocus?.current ?? form.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    const earlier = before.current;
    return () => {
      if (earlier instanceof HTMLElement) earlier.focus();
    };
  }, []);

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => {
        // A list or menu inside the dialog closes itself first and marks the key as used; a
        // tooltip closes and lets the key through.
        if (e.key === "Escape" && isFree(e.nativeEvent)) {
          e.stopPropagation();
          onCancel();
        }
        // Tab stays inside the box.
        if (e.key === "Tab") {
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <form
        ref={form}
        className={`dialog${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {body && <p className="dialog-body">{body}</p>}
        {children}
      </form>
    </div>
  );
}

function Box({ open, close }: { open: Open; close: () => void }) {
  const { options } = open;
  const [value, setValue] = useState(open.kind === "prompt" ? (open.options.initial ?? "") : "");
  const field = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);

  function cancel() {
    if (open.kind === "prompt") open.answer(null);
    else open.answer(false);
    close();
  }

  function submit() {
    if (open.kind === "prompt") open.answer(value.trim());
    else open.answer(true);
    close();
  }

  return (
    <DialogFrame
      title={options.title}
      {...(options.body ? { body: options.body } : {})}
      onCancel={cancel}
      onSubmit={submit}
      initialFocus={open.kind === "prompt" ? field : action}
    >
      {open.kind === "prompt" && (
        <label className="dialog-field">
          {open.options.label && <span>{open.options.label}</span>}
          <input
            ref={field}
            type="text"
            inputMode={open.options.inputMode ?? "text"}
            value={value}
            placeholder={open.options.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      )}
      <p className="dialog-actions">
        <button type="button" className="quiet" onClick={cancel}>
          Cancel
        </button>
        <button
          ref={action}
          type="submit"
          className={
            open.kind === "confirm" && open.options.danger ? "primary danger-solid" : "primary"
          }
        >
          {options.action ?? (open.kind === "prompt" ? "OK" : "Yes")}
        </button>
      </p>
    </DialogFrame>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const counter = useRef(0);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setOpen({ id: ++counter.current, kind: "confirm", options, answer: resolve }),
      ),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) =>
        setOpen({ id: ++counter.current, kind: "prompt", options, answer: resolve }),
      ),
    [],
  );
  const [dialogs] = useState<Dialogs>(() => ({ confirm, prompt }));

  return (
    <Context.Provider value={dialogs}>
      {children}
      {open && <Box key={open.id} open={open} close={() => setOpen(null)} />}
    </Context.Provider>
  );
}
