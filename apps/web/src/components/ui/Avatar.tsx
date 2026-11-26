import { initialsOf } from "@frontier/schema";
import "./Avatar.css";

/** A person as a round mark with their initials. No picture is fetched from anywhere. */
export function Avatar({
  name,
  email = "",
  size = "md",
}: {
  name: string;
  email?: string;
  size?: "sm" | "md";
}) {
  return (
    <span className={`ui-avatar ui-avatar-${size}`} aria-hidden="true">
      {initialsOf(name, email)}
    </span>
  );
}
