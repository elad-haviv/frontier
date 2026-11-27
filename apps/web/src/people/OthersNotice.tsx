import type { OtherUnsaved } from "@frontier/schema";
import { Avatar } from "../components/ui/Avatar.tsx";
import { othersNotice, SAVE_SECOND_COMPARES } from "./model.ts";
import "./People.css";

/**
 * "Wren has unsaved changes to this entry": a quiet line for writers and owners (stage 31d). It
 * names people and says since when; it never shows what they wrote. In the editor it also says
 * what happens when both save: whoever saves second compares the two texts.
 */
export function OthersNotice({
  people,
  editing = false,
}: {
  people: readonly OtherUnsaved[];
  editing?: boolean;
}) {
  const notice = othersNotice(people);
  if (!notice) return null;
  return (
    <p className="people-notice" role="status" data-testid="others-notice">
      <span className="people-notice-faces" aria-hidden="true">
        {people.slice(0, 3).map((p) => (
          <Avatar key={p.id} name={p.name} size="sm" />
        ))}
      </span>
      <span>
        <strong>{notice.headline}</strong>
        {notice.tail}
        {editing && <> {SAVE_SECOND_COMPARES}</>}
      </span>
    </p>
  );
}
