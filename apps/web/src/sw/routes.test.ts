import { describe, expect, it } from "vitest";
import { imagePath, routeOf } from "./routes.ts";

const at = (path: string, method = "GET", mode = "cors") =>
  routeOf({ url: new URL(path, "https://frontier.example.com"), method, mode });
const page = (path: string) => at(path, "GET", "navigate");

describe("what the service worker answers", () => {
  it("answers every page address with the app", () => {
    for (const path of ["/", "/e/02%20People/Mira.md", "/map/x", "/login", "/settings?x=1"]) {
      expect(page(path), path).toBe("shell");
    }
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
    expect(at("/api/images?path=99%20Appendices%2Fa.png&w=640", "GET", "no-cors")).toBe("image");
    expect(at("/api/images?path=a.png")).toBe("image");
    expect(at("/api/images?path=a.png&w=640&branch=frontier%2Fx")).toBe("none");
    expect(at("/api/images?branch=frontier%2Fx")).toBe("none");
    expect(at("/api/images/find?name=a.png&from=b.md")).toBe("none");
    expect(page("/api/images?path=a.png&w=640")).toBe("none");
  });

  it("never answers data, writes, the session, the status or its own files", () => {
    for (const path of [
      "/api/session",
      "/api/login",
      "/api/passkeys/login/options",
      "/api/settings",
      "/api/status",
      "/api/status/events",
      "/api/entries?path=a.md",
      "/api/tree",
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
      expect(at("/api/images?path=a.png", method)).toBe("none");
    }
  });

  it("reads the image an address shows", () => {
    const base = "https://frontier.example.com";
    expect(imagePath(new URL("/api/images?path=a%2Fb.png&w=320", base))).toBe("a/b.png");
    expect(imagePath(new URL("/api/tree?path=a", base))).toBeNull();
  });
});
