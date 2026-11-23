/**
 * What pages tell the shell: the panels of the right side bar, the title and main action of the
 * phone's top line, and where a bottom sheet must stop so it never covers a page's own bottom
 * bar. One small store holds it all; the shell reads it, pages write it through the hooks here.
 */
import type { LucideIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

export interface PanelSpec {
  /** Unique on its screen, and kept in the device's settings as the open tab. */
  id: string;
  /** The tab's name. */
  title: string;
  icon: LucideIcon;
  /** A number shown beside the name, such as the open comments. */
  badge?: number;
  /**
   * Draws the panel. It is called by the shell, so it returns elements and calls no hooks of its
   * own; put the panel's state in a component it returns.
   */
  render: () => ReactNode;
}

/** The kinds of screen; the side bars are remembered per kind. */
export type ScreenKind = "editor" | "map" | "chronicle" | "graph" | "page";

export function kindOf(pathname: string): ScreenKind {
  if (pathname.startsWith("/edit/")) return "editor";
  if (pathname.startsWith("/map/")) return "map";
  if (pathname.startsWith("/chronicle/")) return "chronicle";
  if (pathname === "/graph") return "graph";
  return "page";
}

/** What the device remembers of a kind of screen. */
export interface ScreenPrefs {
  /** Width of the right side bar in pixels. */
  width: number;
  /** The tab last chosen. */
  tab: string | null;
  /** Whether the right side bar was left open (on a desktop). */
  open: boolean;
  /** Whether the left side bar is folded to its rail. */
  rail: boolean;
}

const PREFS = "frontier.shell.";

export function readPrefs(kind: ScreenKind): ScreenPrefs {
  // Maps, chronicles and the graph need the width more than the folder list: they start with the rail.
  const fallback: ScreenPrefs = {
    width: 340,
    tab: null,
    open: false,
    rail: kind === "map" || kind === "chronicle" || kind === "graph",
  };
  try {
    const raw = localStorage.getItem(PREFS + kind);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<ScreenPrefs>;
    return {
      width: typeof saved.width === "number" && saved.width > 0 ? saved.width : fallback.width,
      tab: typeof saved.tab === "string" ? saved.tab : null,
      open: saved.open === true,
      rail: typeof saved.rail === "boolean" ? saved.rail : fallback.rail,
    };
  } catch {
    return fallback;
  }
}

export function writePrefs(kind: ScreenKind, change: Partial<ScreenPrefs>): void {
  try {
    localStorage.setItem(PREFS + kind, JSON.stringify({ ...readPrefs(kind), ...change }));
  } catch {
    /* the choice lasts for this visit only */
  }
}

export interface PageTitle {
  title: ReactNode;
  extra?: ReactNode;
}

/** The shell's store. Pages change it through the hooks below; the shell subscribes. */
export class ShellStore {
  private readonly specs = new Map<string, PanelSpec>();
  private readonly listeners = new Set<() => void>();
  private readonly drawers = new Set<() => void>();
  private version = 0;
  private drawn = 0;
  private floors = new Map<object, number>();
  /** The open tab of the right side bar, or null while it is closed. */
  open: string | null = null;
  /** A tab to open as soon as its panel arrives: the remembered one, or one that went a moment. */
  private pending: string | null = null;
  kind: ScreenKind = "page";
  phone = false;
  title: PageTitle | null = null;
  /** Where the phone line holds the page's main action. */
  actionSlot: HTMLElement | null = null;
  /**
   * A folder a page asked to see in the left bar's tree, until the tree has shown it. `n` rises
   * with each ask, so the same folder can be asked for again.
   */
  reveal: { path: string; n: number } | null = null;
  private asked = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): number => this.version;

  /**
   * Listens for what only the shell draws: the panels' content, the phone line's title, the
   * sheet's floor. Pages re-render on every render of theirs, so these must not wake the pages.
   */
  subscribeDrawing = (listener: () => void): (() => void) => {
    this.drawers.add(listener);
    return () => this.drawers.delete(listener);
  };

  drawing = (): number => this.drawn;

  /** Something a page can see changed: the open tab, the list of tabs, the phone's slot. */
  private changed(): void {
    this.version++;
    this.drawn++;
    for (const l of [...this.listeners]) l();
    for (const l of [...this.drawers]) l();
  }

  /** Something only the shell draws changed. */
  private redraw(): void {
    this.drawn++;
    for (const l of [...this.drawers]) l();
  }

  /** The panels of the screen, in the order the page declared them. */
  panels(): PanelSpec[] {
    return [...this.specs.values()];
  }

  setPanel(spec: PanelSpec): void {
    const before = this.specs.get(spec.id);
    this.specs.set(spec.id, spec);
    if (!before && this.open === null && this.pending === spec.id) {
      this.open = spec.id;
      this.pending = null;
    }
    const same =
      before &&
      before.title === spec.title &&
      before.icon === spec.icon &&
      before.badge === spec.badge;
    if (same) this.redraw();
    else this.changed();
  }

  removePanel(id: string): void {
    if (!this.specs.delete(id)) return;
    if (this.open === id) {
      // It may come straight back, as when the editor opens the next entry.
      this.open = null;
      this.pending = id;
    }
    this.changed();
  }

  /** A new kind of screen: its remembered tab opens when its panel arrives, on a desktop. */
  enter(kind: ScreenKind, phone: boolean): void {
    if (kind === this.kind && phone === this.phone) return;
    const prefs = readPrefs(kind);
    this.kind = kind;
    this.phone = phone;
    this.open = null;
    this.pending = !phone && prefs.open ? prefs.tab : null;
    if (this.pending && this.specs.has(this.pending)) {
      this.open = this.pending;
      this.pending = null;
    }
    this.changed();
  }

  show(id: string): void {
    this.pending = null;
    this.open = this.specs.has(id) ? id : null;
    if (this.open === null) this.pending = id;
    writePrefs(this.kind, this.phone ? { tab: id } : { tab: id, open: true });
    this.changed();
  }

  hide(): void {
    if (this.open === null && this.pending === null) return;
    this.open = null;
    this.pending = null;
    if (!this.phone) writePrefs(this.kind, { open: false });
    this.changed();
  }

  toggle(id: string): void {
    if (this.open === id) this.hide();
    else this.show(id);
  }

  /** Opens the left bar (the drawer on a phone) with its tree open at a folder. */
  revealInTree(path: string): void {
    this.reveal = { path, n: ++this.asked };
    this.changed();
  }

  /** The tree has shown the folder. Nothing anyone draws changes, so no one is told. */
  revealed(): void {
    this.reveal = null;
  }

  setTitle(title: PageTitle | null): void {
    if (title === null && this.title === null) return;
    this.title = title;
    this.redraw();
  }

  setActionSlot(slot: HTMLElement | null): void {
    if (slot === this.actionSlot) return;
    this.actionSlot = slot;
    this.changed();
  }

  setFloor(owner: object, px: number | null): void {
    if (px === null) {
      if (!this.floors.delete(owner)) return;
    } else if (this.floors.get(owner) === px) return;
    else this.floors.set(owner, px);
    this.redraw();
  }

  /** How far above the bottom of the screen a bottom sheet stops. */
  floor(): number {
    return Math.max(0, ...this.floors.values());
  }
}

const Store = createContext<ShellStore | null>(null);
export const ShellStoreProvider = Store.Provider;

function useStore(): ShellStore | null {
  return useContext(Store);
}

/** For the shell's own parts: re-renders on every change of the store, and gives it. */
export function useShellStore(): ShellStore {
  const store = useStore();
  if (!store) throw new Error("useShellStore needs the Shell above it.");
  useSyncExternalStore(store.subscribeDrawing, store.drawing);
  return store;
}

/**
 * Declares a panel of the right side bar while the component is mounted; null declares none.
 * The latest `render` is always the one drawn.
 */
export function usePanel(spec: PanelSpec | null): void {
  const store = useStore();
  const id = spec?.id ?? null;
  useLayoutEffect(() => {
    if (store && spec) store.setPanel(spec);
  });
  useLayoutEffect(() => {
    if (!store || id === null) return;
    return () => store.removePanel(id);
  }, [store, id]);
}

/** Opens and closes the right side bar (the bottom sheet on a phone) from a page. */
export function useRightBar(): {
  open: string | null;
  show: (id: string) => void;
  hide: () => void;
  toggle: (id: string) => void;
} {
  const store = useStore();
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.snapshot ?? noSnapshot);
  // The same functions on every render, so pages can name them in their effects.
  const actions = useMemo(
    () => ({
      show: (id: string) => store?.show(id),
      hide: () => store?.hide(),
      toggle: (id: string) => store?.toggle(id),
    }),
    [store],
  );
  return { open: store?.open ?? null, ...actions };
}

/**
 * Opens a panel of the right side bar (the bottom sheet on a phone) by its id, as a page's own
 * button for it does. A panel not declared yet opens as soon as it is.
 */
export function useOpenPanel(): (id: string) => void {
  const store = useStore();
  return useCallback((id: string) => store?.show(id), [store]);
}

/** Opens the left bar's tree at a folder, from a page: the folder named in its sticky line. */
export function useRevealInTree(): (path: string) => void {
  const store = useStore();
  return useCallback((path: string) => store?.revealInTree(path), [store]);
}

/** The folder a page asked the tree to show, for the tree. */
export function useRevealRequest(): { path: string; n: number } | null {
  const store = useStore();
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.snapshot ?? noSnapshot);
  return store?.reveal ?? null;
}

/** For the tree, once it has shown the folder asked for. */
export function useRevealDone(): () => void {
  const store = useStore();
  return useCallback(() => store?.revealed(), [store]);
}

const noSubscribe = () => () => undefined;
const noSnapshot = () => 0;

/**
 * Sets what the phone's top line shows while the page is mounted: its title, and an optional
 * small control beside it. Without it the line shows the page's usual name.
 */
export function usePageTitle(title: ReactNode, extra?: ReactNode): void {
  const store = useStore();
  useLayoutEffect(() => {
    store?.setTitle(extra === undefined ? { title } : { title, extra });
  });
  useLayoutEffect(() => {
    if (!store) return;
    return () => store.setTitle(null);
  }, [store]);
}

/**
 * The page's main action (Edit, Done). On a desktop it stays where the page puts it; on a phone
 * it moves into the top line, beside the title.
 */
export function PageAction({ children }: { children: ReactNode }) {
  const store = useStore();
  useSyncExternalStore(store?.subscribe ?? (() => () => undefined), store?.snapshot ?? (() => 0));
  if (store?.phone && store.actionSlot) return createPortal(children, store.actionSlot);
  return <>{children}</>;
}

/**
 * Keeps a bottom sheet above a bar at the foot of the page, such as the editor's toolbar or the
 * map's tools: the sheet stops at the given edge of the element.
 */
export function useSheetFloor(
  ref: RefObject<HTMLElement | null>,
  edge: "top" | "bottom" = "top",
  enabled = true,
): void {
  const store = useStore();
  const owner = useRef({});
  useEffect(() => {
    const el = ref.current;
    if (!store || !el || !enabled) return;
    const me = owner.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const at = edge === "top" ? rect.top : rect.bottom;
      store.setFloor(me, Math.max(0, Math.round(window.innerHeight - at)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      store.setFloor(me, null);
    };
  }, [store, ref, edge, enabled]);
}
