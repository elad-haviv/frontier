import { CircleAlert } from "lucide-react";
import { Link } from "../../nav.tsx";
import { Icon } from "./Icon.tsx";
import "./Problem.css";

/** Why something could not be done, in words, with Retry when trying again can help. */
export function Problem({
  reason,
  onRetry,
  href,
}: {
  reason: string;
  onRetry?: () => void;
  /** Where the problem is put right, such as a section of Settings. */
  href?: string | undefined;
}) {
  return (
    <div className="ui-problem" role="alert">
      <Icon icon={CircleAlert} size="sm" />
      <p>
        {reason}
        {href && (
          <>
            {" "}
            <Link to={href}>Open Settings</Link>
          </>
        )}
      </p>
      {onRetry && (
        <button type="button" className="quiet" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
