import { ChevronDown, PanelRightClose } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useRef } from "react";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { type PanelSpec, useShellStore } from "./panels.tsx";
import { useFocusTrap } from "./useFocusTrap.ts";
import "./RightBar.css";

/** The tabs of the screen's panels; arrows move between them, as in any tab list. */
function Tabs({ panels, open }: { panels: PanelSpec[]; open: string }) {
  const store = useShellStore();
  const list = useRef<HTMLDivElement>(null);
  function onKey(e: KeyboardEvent) {
    const at = panels.findIndex((p) => p.id === open);
    const step =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -at : 0;
    const to = e.key === "End" ? panels.length - 1 : at + step;
    if (to === at || to < 0 || to >= panels.length) return;
    e.preventDefault();
    store.show(panels[to]!.id);
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>(`[data-panel="${panels[to]!.id}"]`)?.focus(),
    );
  }
  return (
    <div className="right-tabs" role="tablist" aria-label="Panels" ref={list} onKeyDown={onKey}>
      {panels.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          id={`panel-tab-${p.id}`}
          data-panel={p.id}
          aria-selected={p.id === open}
          aria-controls={`panel-${p.id}`}
          tabIndex={p.id === open ? 0 : -1}
          className="right-tab"
          onClick={() => store.show(p.id)}
        >
          <Icon icon={p.icon} size="sm" />
          <span>{p.title}</span>
          {p.badge ? <span className="badge">{p.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

function Body({ spec }: { spec: PanelSpec }) {
  return (
    <div
      className="right-body"
      role="tabpanel"
      id={`panel-${spec.id}`}
      aria-labelledby={`panel-tab-${spec.id}`}
    >
      {spec.render()}
    </div>
  );
}

/**
 * The right side bar: the screen's panels as tabs, beside the page. Its width is set by the
 * splitter around it (see Shell).
 */
export function RightBar() {
  const store = useShellStore();
  const panels = store.panels();
  const spec = panels.find((p) => p.id === store.open);
  if (!spec) return null;
  return (
    <aside className="right-bar" aria-label="Side panels">
      <header className="right-head">
        <Tabs panels={panels} open={spec.id} />
        <IconButton
          label="Hide the panels"
          icon={PanelRightClose}
          tipSide="left"
          onClick={() => store.hide()}
        />
      </header>
      <Body key={spec.id} spec={spec} />
    </aside>
  );
}

/**
 * On a phone the same panels open as a sheet from the bottom of the screen, above any bar the
 * page keeps at its foot. It does not cover the rest of the page, so a map stays in reach while
 * a feature is edited; Tab stays inside it, Escape closes it, and the focus goes back.
 */
export function BottomSheet() {
  const store = useShellStore();
  const sheet = useRef<HTMLElement>(null);
  const panels = store.panels();
  const spec = panels.find((p) => p.id === store.open);
  useFocusTrap(sheet, spec !== undefined, () => store.hide());
  if (!spec) return null;
  return (
    <section
      ref={sheet}
      className="bottom-sheet"
      role="region"
      aria-label={`${spec.title}, in a sheet`}
      style={{ bottom: store.floor(), "--floor": `${store.floor()}px` } as CSSProperties}
    >
      <header className="right-head">
        <Tabs panels={panels} open={spec.id} />
        <IconButton label="Hide the panel" icon={ChevronDown} onClick={() => store.hide()} />
      </header>
      <Body key={spec.id} spec={spec} />
    </section>
  );
}
