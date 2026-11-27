import { loadMe, useMeFailed } from "../../me.ts";
import { Problem } from "../../components/ui/Problem.tsx";

/** What Profile and Signing in show until the account is known: a wait, or a way to try again. */
export function NoMe() {
  const failed = useMeFailed();
  if (!failed) return <p className="muted">Loading…</p>;
  return (
    <Problem reason="Your account could not be read just now." onRetry={() => void loadMe()} />
  );
}
