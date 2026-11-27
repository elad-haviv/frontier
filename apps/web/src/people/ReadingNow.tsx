import { Avatar } from "../components/ui/Avatar.tsx";
import { readingText } from "./model.ts";
import "./People.css";

const MOST = 4;

/**
 * Who else is reading this entry now: their initials, and their names in words (a title alone
 * would not show on a phone). For writers and owners; the caller passes nobody for anyone else.
 */
export function ReadingNow({ people }: { people: readonly { id: string; name: string }[] }) {
  if (people.length === 0) return null;
  return (
    <p className="people-reading" data-testid="reading-now">
      <span className="people-faces" aria-hidden="true">
        {people.slice(0, MOST).map((p) => (
          <span key={p.id} title={p.name}>
            <Avatar name={p.name} size="sm" />
          </span>
        ))}
        {people.length > MOST && <span className="people-more">+{people.length - MOST}</span>}
      </span>
      <span>{readingText(people)}</span>
    </p>
  );
}
