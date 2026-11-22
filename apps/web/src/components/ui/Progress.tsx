import "./Progress.css";

/**
 * The thin moving line at the top of something being loaded again. What was shown before stays
 * in place under it, so the page never goes blank while it waits.
 */
export function Progress({ label = "Loading" }: { label?: string }) {
  return <div className="ui-progress" role="progressbar" aria-label={label} />;
}
