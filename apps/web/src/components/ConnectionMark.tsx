import { CircleAlert, Cloud, CloudOff, LogIn, RotateCw } from "lucide-react";
import { useConnection } from "../sync/connection.ts";
import { askToLogIn } from "./LoginDialog.tsx";
import { Icon } from "./ui/Icon.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import "./ConnectionMark.css";

/**
 * The one place that says whether Frontier can be reached: a quiet mark while it can, the words
 * "Not connected" with Retry while it cannot, and "Signed out" with Log in when the session ended.
 */
export function ConnectionMark() {
  const { state, retry } = useConnection();
  if (state === "online") {
    return (
      <span className="connection is-online" role="status" title="Connected to Frontier">
        <Icon icon={Cloud} size="sm" />
        <span className="sr-only">Connected</span>
      </span>
    );
  }
  if (state === "offline") {
    return (
      <span className="connection is-offline" role="status">
        <Icon icon={CloudOff} size="sm" />
        <span className="connection-words">Not connected</span>
        <IconButton label="Retry" icon={RotateCw} size="sm" tipSide="bottom" onClick={retry} />
      </span>
    );
  }
  return (
    <span className="connection is-signed-out" role="status">
      <Icon icon={CircleAlert} size="sm" />
      <span className="connection-words">Signed out</span>
      <IconButton label="Log in" icon={LogIn} size="sm" tipSide="bottom" onClick={askToLogIn} />
    </span>
  );
}
