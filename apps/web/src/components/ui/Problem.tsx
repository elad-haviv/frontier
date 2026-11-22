import { CircleAlert } from "lucide-react";
import { Icon } from "./Icon.tsx";
import "./Problem.css";

/** Why something could not be done, in words, with Retry when trying again can help. */
export function Problem({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <div className="ui-problem" role="alert">
      <Icon icon={CircleAlert} size="sm" />
      <p>{reason}</p>
      {onRetry && (
        <button type="button" className="quiet" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
