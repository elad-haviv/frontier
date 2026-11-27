import type { ComponentPropsWithRef, MouseEvent } from "react";
import { useNeedsConnection } from "../../sync/connection.ts";
import { Tip } from "./Tip.tsx";

/**
 * A button for an action that goes straight to the server. While the server cannot be reached it
 * stays focusable but does nothing, and its tooltip says "Needs a connection", so the author
 * knows why rather than meeting an error.
 */
export function ActionButton({
  onClick,
  disabled,
  type = "button",
  ...rest
}: ComponentPropsWithRef<"button">) {
  const reason = useNeedsConnection();
  if (!reason) return <button {...rest} type={type} disabled={disabled} onClick={onClick} />;
  const refuse = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();
  return (
    <Tip label={reason}>
      <button {...rest} type={type} aria-disabled="true" data-offline="" onClick={refuse} />
    </Tip>
  );
}
