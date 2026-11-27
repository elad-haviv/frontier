/**
 * A name for this browser tab, made once when the page loads (stage 27d). The status stream
 * (`?client=`) and the "who is reading" announcements both carry it, so the server knows which
 * announcement a closing stream took with it, and two tabs of one person are told apart. It is
 * letters and digits only, as the server accepts, and says nothing about the person.
 */
function make(): string {
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `t${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`.slice(0, 40);
}

export const TAB_CLIENT: string = make();
