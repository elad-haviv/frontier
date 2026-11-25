/** The library path of the entry (or its editor) at an address of the app; "" on any other page. */
export function currentEntryPath(pathname: string): string {
  const prefix = pathname.startsWith("/e/")
    ? "/e/"
    : pathname.startsWith("/edit/")
      ? "/edit/"
      : null;
  if (prefix === null) return "";
  return pathname
    .slice(prefix.length)
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}
