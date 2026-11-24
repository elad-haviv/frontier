import type { EditorView } from "@codemirror/view";
import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { dropHost, type Help, helpField, hostFor, watchHelp } from "./helpCard.ts";

// The card loads the first time help opens, so the editor opens as fast as before.
const HelpCard = lazy(() => import("./HelpCard.tsx").then((m) => ({ default: m.HelpCard })));

/**
 * Draws the writing help card into its place under the passage while help is open. The card is
 * kept here, in the page, so it keeps what it shows when the editor draws its place again.
 */
export function WritingHelp(p: {
  view: { current: EditorView | null };
  path: string;
  canWrite: boolean | null;
  onCommentDone?: (id: string) => void;
}) {
  const [help, setHelp] = useState<Help | null>(null);
  // Raised when the text changes while help is open, so the card sees the passage as it is.
  const [, setTick] = useState(0);
  // The editor is made in an effect of its own, after this renders: it is picked up here.
  const [view, setView] = useState<EditorView | null>(null);
  useEffect(() => {
    if (p.view.current !== view) setView(p.view.current);
  });

  useEffect(() => {
    if (!view) return;
    setHelp(view.state.field(helpField, false) ?? null);
    return watchHelp(view, (next) => {
      setHelp(next);
      setTick((n) => n + 1);
    });
  }, [view]);

  const id = help?.id;
  useEffect(() => {
    if (id === undefined) return;
    return () => dropHost(id);
  }, [id]);

  if (!help || !view) return null;
  return createPortal(
    <Suspense fallback={null}>
      <HelpCard
        key={help.id}
        view={view}
        help={help}
        path={p.path}
        canWrite={p.canWrite}
        {...(p.onCommentDone ? { onCommentDone: p.onCommentDone } : {})}
      />
    </Suspense>,
    hostFor(help.id),
  );
}
