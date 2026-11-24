/** What the sections of Settings share: the sections, the settings read once, and saving. */
import {
  AI_PROVIDER_KINDS,
  type AiProviderKind,
  type AiTaskName,
  type SettingsResponse,
} from "@frontier/schema";
import { Check } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ApiFailure } from "../../api.ts";
import { Icon } from "../../components/ui/Icon.tsx";

export interface Section {
  path: string;
  title: string;
  group: "AI" | "Library" | "This device" | "Account";
  /** Whether it shows with no connection. */
  offline: boolean;
}

/** Most used first; the device and the account last, as in most apps. */
export const SECTIONS: Section[] = [
  { path: "ai/providers", title: "Providers", group: "AI", offline: false },
  { path: "ai/models", title: "Models", group: "AI", offline: false },
  { path: "ai/spending", title: "Spending", group: "AI", offline: false },
  { path: "ai/folder-run", title: "Propose for a folder", group: "AI", offline: false },
  { path: "library/types", title: "Types and dates", group: "Library", offline: false },
  { path: "library/backups", title: "Backups and export", group: "Library", offline: false },
  { path: "device", title: "Offline copy", group: "This device", offline: true },
  { path: "account", title: "Signing in", group: "Account", offline: false },
];

export const TASKS: { task: AiTaskName; title: string; about: string }[] = [
  {
    task: "extraction",
    title: "Proposing fields",
    about: "Reads an entry and suggests dates and types for the inbox.",
  },
  {
    task: "conversation",
    title: "Lore conversations",
    about: "Ask, writing help, talking to characters, exploring a map, and comments.",
  },
  { task: "art", title: "Concept art", about: "Pictures for discoveries, made when you ask." },
];

export const taskTitle = (task: string) => TASKS.find((t) => t.task === task)?.title ?? task;

export interface SettingsData {
  settings: SettingsResponse | null;
  /** Why the settings could not be read, or null. */
  error: ApiFailure | null;
  reload: () => Promise<void>;
}

const Data = createContext<SettingsData>({
  settings: null,
  error: null,
  reload: async () => undefined,
});
export const SettingsDataProvider = Data.Provider;
export const useSettingsData = () => useContext(Data);

export const message = (err: unknown) =>
  err instanceof ApiFailure ? err.message : "Something went wrong.";

/** Dollars, with small amounts said as such. */
export const usd = (n: number) => (n > 0 && n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);

/** A price per million tokens: "$3", "$0.15", "free". */
export function perMillion(n: number | null): string {
  if (n === null) return "?";
  if (n === 0) return "free";
  return `$${n >= 10 ? n.toFixed(0) : n >= 1 ? String(Math.round(n * 100) / 100) : String(n)}`;
}

/** "1M", "200K" tokens. */
export function tokens(n: number | null): string | null {
  if (n === null) return null;
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`.replace(".0M", "M");
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** Two letters and a colour for each kind of provider: no logos are fetched from anywhere. */
const MARKS: Record<AiProviderKind, string> = {
  openrouter: "OR",
  anthropic: "An",
  openai: "OA",
  google: "Go",
  xai: "xA",
  mistral: "Mi",
  deepseek: "DS",
  groq: "Gq",
  custom: "··",
};

export function ProviderMark({ kind, size = "md" }: { kind: AiProviderKind; size?: "sm" | "md" }) {
  return (
    <span className={`provider-mark provider-${kind} provider-mark-${size}`} aria-hidden="true">
      {MARKS[kind]}
    </span>
  );
}

export const kindLabel = (kind: AiProviderKind) => AI_PROVIDER_KINDS[kind].label;

/** Whether the window is wide enough for the settings rail (the app's own wide breakpoint). */
const WIDE = "(min-width: 48rem)";
export function useWide(): boolean {
  return useSyncExternalStore(
    (l) => {
      const q = window.matchMedia(WIDE);
      q.addEventListener("change", l);
      return () => q.removeEventListener("change", l);
    },
    () => window.matchMedia(WIDE).matches,
  );
}

/** "✓ Saved" beside a control, for two seconds after a save. */
export function Saved({ at }: { at: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 2000);
    return () => window.clearTimeout(timer);
  }, [at]);
  return (
    <span className="saved-mark" role="status">
      {shown && (
        <>
          <Icon icon={Check} size="sm" /> Saved
        </>
      )}
    </span>
  );
}

/**
 * Saving one control as it changes: `run` sends it; on success the mark shows, on failure the
 * error is kept for the control to show under itself and the caller puts the stored value back.
 */
export function useAutoSave() {
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (live.current) setSavedAt(Date.now());
      return true;
    } catch (err) {
      if (live.current) setError(message(err));
      return false;
    } finally {
      if (live.current) setBusy(false);
    }
  }, []);
  return { run, savedAt, error, setError, busy };
}

/** The card a section shows when it needs the server and there is no connection. */
export function NeedsConnection({ children }: { children?: ReactNode }) {
  return (
    <div className="settings-offline-card">
      <p>
        <strong>Needs a connection.</strong>{" "}
        {children ?? "These settings live on your server. They open when you're connected."}
      </p>
    </div>
  );
}

/** "2 minutes ago", "yesterday", or a date. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
