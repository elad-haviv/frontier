import { Link } from "../../nav.tsx";
import { missing, useMe } from "../../me.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Tip } from "../ui/Tip.tsx";
import { AppMenu } from "./AppMenu.tsx";
import { ROLE_NAMES, useProject } from "../projectContext.ts";

/**
 * You, at the foot of the left bar: your avatar and name (a way to your profile), and the "⋯" app
 * menu. In the narrow rail only the avatar shows, with its name on hover. While the account has no
 * name or email, a line says so, since logging in and saved versions both use them.
 */
export function PersonRow({
  rail = false,
  onKeys,
  onLogout,
}: {
  rail?: boolean;
  onKeys: () => void;
  onLogout: () => void;
}) {
  const me = useMe();
  const project = useProject();
  const shown = me ? me.name || me.email || "You" : null;
  const mark = me && <Avatar name={me.name} email={me.email} />;
  // The warning dot on the avatar is said in words too: the rail has no room for the line.
  const lacks = me?.needsProfile ? `Add your ${missing(me.name, me.email)}` : null;
  const label = `${shown}, your profile${lacks ? `. ${lacks}` : ""}`;
  return (
    <>
      {me?.needsProfile && !rail && (
        <Link to="/settings/profile" className="left-nudge">
          {lacks}
        </Link>
      )}
      <div className="left-person">
        {me &&
          (rail ? (
            <Tip label={lacks ? `${shown}. ${lacks}` : shown} side="right">
              <Link
                to="/settings/profile"
                className={`left-person-link${me.needsProfile ? " needs-profile" : ""}`}
                aria-label={label}
              >
                {mark}
              </Link>
            </Tip>
          ) : (
            <Link
              to="/settings/profile"
              className="left-person-link"
              aria-label={label}
              aria-describedby="left-person-role"
            >
              {mark}
              <span className="left-person-text">
                <span className="left-person-name">{shown}</span>
                {/* What you may do in this project, in words. */}
                <span id="left-person-role" className="left-person-role">
                  {ROLE_NAMES[project.role]} here
                </span>
              </span>
            </Link>
          ))}
        {!rail && <span className="left-status-gap" />}
        <AppMenu onKeys={onKeys} onLogout={onLogout} />
      </div>
    </>
  );
}
