import { api } from "../../api.ts";
import { makeEntry, newEntryText, titleOfPath } from "../../map/featureEntry.ts";
import { useAsync } from "../../useAsync.ts";
import { NewEntry } from "../NewEntry.tsx";

/**
 * The New entry dialog for a feature's entry: its name as typed or proposed, the folder that
 * entries like it are in, and the type that folder gives. The entry is made, then linked.
 */
export function FeatureEntryDialog({
  name,
  body,
  folder,
  onMade,
  onClose,
}: {
  name: string;
  /** What the new entry says under its title, such as a proposed description. */
  body: string;
  folder: string;
  onMade: (path: string, title: string) => void;
  onClose: () => void;
}) {
  const tree = useAsync(() => api.tree(), "map-entry-tree");
  return (
    <NewEntry
      tree={tree}
      folder={folder}
      name={name}
      action="Make and link the entry"
      onRetry={tree.retry}
      onClose={onClose}
      onMake={(path, type) => {
        void makeEntry(path, newEntryText(path, body, type)).then(() =>
          onMade(path, titleOfPath(path)),
        );
      }}
    />
  );
}
