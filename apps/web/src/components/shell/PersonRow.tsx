import { Link } from "react-router-dom";
import { useMe } from "../../me.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Tip } from "../ui/Tip.tsx";
import { AppMenu } from "./AppMenu.tsx";

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
  const shown = me ? me.name || me.email || "You" : null;
  const mark = me && <Avatar name={me.name} email={me.email} />;
  return (
    <>
      {me?.needsProfile && !rail && (
        <Link to="/settings/profile" className="left-nudge">
          Add your name and email
        </Link>
      )}
      <div className="left-person">
        {me &&
          (rail ? (
            <Tip label={shown} side="right">
              <Link
                to="/settings/profile"
                className={`left-person-link${me.needsProfile ? " needs-profile" : ""}`}
                aria-label={`${shown}, your profile`}
              >
                {mark}
              </Link>
            </Tip>
          ) : (
            <Link
              to="/settings/profile"
              className="left-person-link"
              aria-label={`${shown}, your profile`}
            >
              {mark}
              <span className="left-person-name">{shown}</span>
            </Link>
          ))}
        {!rail && <span className="left-status-gap" />}
        <AppMenu onKeys={onKeys} onLogout={onLogout} />
      </div>
    </>
  );
}
