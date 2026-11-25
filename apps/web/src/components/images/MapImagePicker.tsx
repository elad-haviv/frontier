import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";

const ImagePicker = lazy(() =>
  import("./ImagePicker.tsx").then((m) => ({ default: m.ImagePicker })),
);

/**
 * The image dialog for a map's image, above the page: one image, and none of the marker icons.
 * Used by the new-map form and by "Add an image…" in the Layers tab.
 */
export function MapImagePicker({
  onPick,
  onClose,
  title,
}: {
  onPick: (path: string) => void;
  onClose: () => void;
  /** The dialog's title, such as "Choose a height map". */
  title?: string;
}) {
  return createPortal(
    <Suspense fallback={null}>
      <ImagePicker
        forMap
        {...(title ? { title } : {})}
        onClose={onClose}
        onPick={(paths) => {
          if (paths[0]) onPick(paths[0]);
        }}
      />
    </Suspense>,
    document.body,
  );
}
