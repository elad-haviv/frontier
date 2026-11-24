import { api } from "../api.ts";
import { LibraryView } from "../components/images/LibraryView.tsx";
import { LightboxProvider } from "../components/Lightbox.tsx";
import { Problem } from "../components/ui/Problem.tsx";
import { Progress } from "../components/ui/Progress.tsx";
import { failureOf, useAsync } from "../useAsync.ts";

/** Every image of the library, by folder, each with the entries that use it. */
export function GalleryPage() {
  const gallery = useAsync(() => api.gallery(), "gallery");

  return (
    <article className="entry wide gallery">
      <header className="entry-head">
        <h1>Gallery</h1>
        <p className="muted lede">The images of the library, by folder.</p>
      </header>

      {gallery.state === "loading" && <p className="muted">Loading…</p>}
      {gallery.reloading && <Progress />}
      {failureOf(gallery) && (
        <Problem reason={failureOf(gallery)!.message} onRetry={gallery.retry} />
      )}
      {gallery.state === "ready" && (
        <LightboxProvider scope=".gallery">
          <LibraryView images={gallery.value.images} mode="browse" />
        </LightboxProvider>
      )}
    </article>
  );
}
