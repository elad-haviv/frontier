import { describe, expect, it } from "vitest";
import { imagePath, routeOf } from "./routes.ts";

const at = (path: string, method = "GET", mode = "cors") =>
  routeOf({ url: new URL(path, "https://frontier.example.com"), method, mode });
const page = (path: string) => at(path, "GET", "navigate");

describe("what the service worker answers", () => {
  it("answers every page address with the app", () => {
    for (const path of [
      "/",
      "/p/avalymia/e/02%20People/Mira.md",
      "/p/avalymia/map/x",
      "/projects",
      "/login",
      "/settings?x=1",
    ]) {
      expect(page(path), path).toBe("shell");
    }
  });

  it("answers an invite link's page with the app, like the login page, and never the server's own redirects", () => {
    // The join page is an app route (stage 27c): with no connection it opens, and says it needs one.
    expect(page("/join/abcdefghijklmnopqrstuvwx")).toBe("shell");
    expect(page("/join/abcdefghijklmnopqrstuvwx?problem=google_denied")).toBe("shell");
    // The Google trip, the join calls and the callback are the server's: never answered stale, and
    // a navigation to them (the browser being sent to Google, or back from it) is not the app.
    for (const path of [
      "/api/auth/google/start?invite=abc",
      "/api/auth/google/start?link=1&returnTo=%2Fsettings%2Faccount",
      "/api/auth/google/callback?code=x&state=y",
      "/api/join/abcdefghijklmnopqrstuvwx",
    ]) {
      expect(page(path), path).toBe("none");
      expect(at(path), path).toBe("none");
    }
    expect(at("/api/join/abcdefghijklmnopqrstuvwx/accept", "POST")).toBe("none");
  });

  it("answers the built files from the precache", () => {
    expect(at("/assets/a-1.js", "GET", "no-cors")).toBe("precache");
    expect(at("/assets/index-x7ZW9OJt.css")).toBe("precache");
    expect(at("/icons/icon-192.png", "GET", "no-cors")).toBe("precache");
    expect(at("/manifest.webmanifest")).toBe("precache");
    expect(at("/index.html")).toBe("precache");
    expect(at("/favicon.ico", "GET", "no-cors")).toBe("none");
  });

  it("answers images of the library, and only those", () => {
    const images = "/api/p/avalymia/images";
    expect(at(`${images}?path=99%20Appendices%2Fa.png&w=640`, "GET", "no-cors")).toBe("image");
    expect(at(`${images}?path=a.png`)).toBe("image");
    expect(at(`${images}?path=a.png&w=640&branch=frontier%2Fx`)).toBe("none");
    expect(at(`${images}?branch=frontier%2Fx`)).toBe("none");
    expect(at("/api/p/avalymia/images/find?name=a.png&from=b.md")).toBe("none");
    expect(page(`${images}?path=a.png&w=640`)).toBe("none");
    // The old address of the images, from before projects, is not answered.
    expect(at("/api/images?path=a.png")).toBe("none");
  });

  it("never answers data, writes, the session, the status or its own files", () => {
    for (const path of [
      "/api/session",
      "/api/login",
      "/api/passkeys/login/options",
      "/api/settings",
      "/api/p/avalymia/status",
      "/api/p/avalymia/status/events",
      "/api/p/avalymia/entries?path=a.md",
      "/api/p/avalymia/tree",
      "/api/projects",
      "/health",
      "/sw.js",
      "/build.json",
    ]) {
      expect(at(path), path).toBe("none");
      expect(page(path), path).toBe("none");
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      expect(at("/api/drafts", method)).toBe("none");
      expect(at("/assets/a-1.js", method)).toBe("none");
      expect(at("/", method, "navigate")).toBe("none");
      expect(at("/api/p/avalymia/images?path=a.png", method)).toBe("none");
    }
  });

  it("reads the image an address shows", () => {
    const base = "https://frontier.example.com";
    const one = imagePath(new URL("/api/p/avalymia/images?path=a%2Fb.png&w=320", base));
    expect(one).toBe(imagePath(new URL("/api/p/avalymia/images?path=a%2Fb.png&w=1280", base)));
    // The same path in another project is another image.
    expect(one).not.toBe(imagePath(new URL("/api/p/other/images?path=a%2Fb.png&w=320", base)));
    expect(imagePath(new URL("/api/p/avalymia/tree?path=a", base))).toBeNull();
  });
});
