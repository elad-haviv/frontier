import { CircleAlert, Cloud, CloudOff, LogIn, RotateCw } from "lucide-react";
import { useConnection } from "../sync/connection.ts";
import { useUnsent } from "../sync/queue.ts";
import { askToLogIn } from "./LoginDialog.tsx";
import { Icon } from "./ui/Icon.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import "./ConnectionMark.css";

/**
 * The one place that says whether Frontier can be reached: a quiet mark while it can, the words
 * "Not connected" with Retry while it cannot, and "Signed out" with Log in when the session ended.
 */
export function ConnectionMark({
  compact = false,
  words = false,
  tipSide = "bottom",
}: {
  /** Says "Connected" in words too, where there is room, as in the side bar's foot. */
  words?: boolean;
  /** Only the icon, as in the side bar's rail: the words are read out and shown on hover. */
  compact?: boolean;
  tipSide?: "top" | "bottom" | "left" | "right";
}) {
  const { state, retry } = useConnection();
  const waiting = useUnsent().length;
  if (state === "online") {
    return (
      <span className="connection is-online" role="status" title="Connected to Frontier">
        <Icon icon={Cloud} size="sm" />
        <span className={words ? "connection-words" : "sr-only"}>Connected</span>
      </span>
    );
  }
  if (compact) {
    const offline = state === "offline";
    return (
      <span className={`connection ${offline ? "is-offline" : "is-signed-out"}`} role="status">
        <IconButton
          label={offline ? "Not connected: retry" : "Signed out: log in"}
          icon={offline ? CloudOff : CircleAlert}
          tipSide={tipSide}
          onClick={offline ? retry : askToLogIn}
        />
        <span className="sr-only">{offline ? "Not connected" : "Signed out"}</span>
      </span>
    );
  }
  if (state === "offline") {
    return (
      <span className="connection is-offline" role="status">
        <Icon icon={CloudOff} size="sm" />
        <span className="connection-words">
          Not connected
          {waiting > 0 && ` · ${waiting} ${waiting === 1 ? "change" : "changes"} waiting`}
        </span>
        <IconButton label="Retry" icon={RotateCw} size="sm" tipSide={tipSide} onClick={retry} />
      </span>
    );
  }
  return (
    <span className="connection is-signed-out" role="status">
      <Icon icon={CircleAlert} size="sm" />
      <span className="connection-words">Signed out</span>
      <IconButton label="Log in" icon={LogIn} size="sm" tipSide={tipSide} onClick={askToLogIn} />
    </span>
  );
}
