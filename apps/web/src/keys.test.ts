import { describe, expect, it } from "vitest";
import {
  CHORD_MS,
  createRegistry,
  displayKey,
  focusIsFree,
  isTyping,
  keys,
  matches,
  type KeyPress,
} from "./keys.ts";

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress & { prevented: boolean } => {
  const e = {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    prevented: false,
    ...more,
    preventDefault() {
      e.prevented = true;
    },
  };
  return e;
};

const input = { tagName: "INPUT", type: "text" };
const editable = { tagName: "DIV", isContentEditable: true };

function registry() {
  const r = createRegistry();
  r.register(
    { id: "app.find", keys: ["Mod-k"], scope: "app", label: "Find" },
    { id: "app.help", keys: ["?"], scope: "app", label: "Help" },
    { id: "app.close", keys: ["Escape"], scope: "app", label: "Close the panel" },
    { id: "map.stop", keys: ["Escape"], scope: "map", label: "Stop" },
    { id: "dialog.close", keys: ["Escape"], scope: "dialog", label: "Close" },
    { id: "chronicle.undo", keys: ["Mod-z"], scope: "chronicle", label: "Undo" },
    { id: "chronicle.redo", keys: ["Shift-Mod-z"], scope: "chronicle", label: "Redo" },
    {
      id: "menu.move",
      keys: ["ArrowDown"],
      scope: "dialog",
      label: "Move in a menu",
      handledBy: "menus",
    },
    {
      id: "turn.enter",
      keys: ["Enter"],
      scope: "map",
      label: "Turn",
      handledBy: "the Turn panel",
    },
  );
  return r;
}

const bind = (r: ReturnType<typeof registry>, id: string, log: string[]) =>
  r.bind(id, { current: () => void log.push(id) });

describe("matching keys", () => {
  it("takes Ctrl or Cmd for Mod, and needs Shift only when asked for", () => {
    expect(matches("Mod-k", press("k", { ctrlKey: true }))).toBe(true);
    expect(matches("Mod-k", press("K", { metaKey: true }))).toBe(true);
    expect(matches("Mod-k", press("k"))).toBe(false);
    expect(matches("Mod-z", press("Z", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches("Shift-Mod-z", press("Z", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("ignores the Shift a sign needs on some keyboards", () => {
    expect(matches("?", press("?", { shiftKey: true }))).toBe(true);
    expect(matches("?", press("?", { ctrlKey: true }))).toBe(false);
  });

  it("reads keys the way the platform writes them", () => {
    expect(displayKey("Shift-Mod-z", false)).toBe("Ctrl+Shift+Z");
    expect(displayKey("Shift-Mod-z", true)).toBe("⇧⌘Z");
    expect(displayKey("Escape Tab", false)).toBe("Esc then Tab");
    expect(displayKey("?", false)).toBe("?");
  });

  it("reads a bare minus, and Mod with minus", () => {
    expect(matches("-", press("-"))).toBe(true);
    expect(matches("-", press("-", { ctrlKey: true }))).toBe(false);
    expect(matches("Mod--", press("-", { ctrlKey: true }))).toBe(true);
    expect(matches("Mod--", press("-"))).toBe(false);
    expect(displayKey("-", false)).toBe("-");
    expect(displayKey("Mod--", false)).toBe("Ctrl+-");
  });

  it("knows a typing field", () => {
    expect(isTyping(input)).toBe(true);
    expect(isTyping({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTyping({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTyping(editable)).toBe(true);
    expect(isTyping({ tagName: "BUTTON" })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("the registry", () => {
  it("runs the shortcut of the innermost active scope", () => {
    const r = registry();
    const log: string[] = [];
    bind(r, "app.close", log);
    const offMap = bind(r, "map.stop", log);
    const offDialog = bind(r, "dialog.close", log);
    const e = press("Escape");
    expect(r.handle(e)).toBe(true);
    expect(e.prevented).toBe(true);
    offDialog();
    r.handle(press("Escape"));
    offMap();
    r.handle(press("Escape"));
    expect(log).toEqual(["dialog.close", "map.stop", "app.close"]);
  });

  it("runs the newest binding of one shortcut", () => {
    const r = registry();
    const log: string[] = [];
    r.bind("app.find", { current: () => void log.push("first") });
    const off = r.bind("app.find", { current: () => void log.push("second") });
    r.handle(press("k", { ctrlKey: true }));
    off();
    r.handle(press("k", { ctrlKey: true }));
    expect(log).toEqual(["second", "first"]);
  });

  it("passes the key on when an action declines it", () => {
    const r = registry();
    const log: string[] = [];
    bind(r, "app.close", log);
    r.bind("map.stop", { current: () => false });
    expect(r.handle(press("Escape"))).toBe(true);
    expect(log).toEqual(["app.close"]);
  });

  it("lets a typing field keep plain keys and take only app keys with a modifier", () => {
    const r = registry();
    const log: string[] = [];
    bind(r, "app.help", log);
    bind(r, "app.find", log);
    bind(r, "chronicle.undo", log);
    const typed = press("?", { shiftKey: true, target: input });
    expect(r.handle(typed)).toBe(false);
    expect(typed.prevented).toBe(false);
    expect(r.handle(press("z", { ctrlKey: true, target: editable }))).toBe(false);
    expect(r.handle(press("k", { ctrlKey: true, target: input }))).toBe(true);
    expect(r.handle(press("?", { shiftKey: true, target: { tagName: "BODY" } }))).toBe(true);
    expect(log).toEqual(["app.find", "app.help"]);
  });

  it("leaves alone a key something else has already used", () => {
    const r = registry();
    const log: string[] = [];
    bind(r, "app.close", log);
    expect(r.handle(press("Escape", { defaultPrevented: true }))).toBe(false);
    expect(log).toEqual([]);
  });

  it("tells undo from redo", () => {
    const r = registry();
    const log: string[] = [];
    bind(r, "chronicle.undo", log);
    bind(r, "chronicle.redo", log);
    r.handle(press("z", { ctrlKey: true }));
    r.handle(press("Z", { ctrlKey: true, shiftKey: true }));
    expect(log).toEqual(["chronicle.undo", "chronicle.redo"]);
  });

  it("never runs or binds a key that a control handles itself", () => {
    const r = registry();
    expect(() => r.bind("menu.move", { current: () => undefined })).toThrow(/handled by menus/);
    expect(r.handle(press("ArrowDown"))).toBe(false);
  });
});

describe("keys of two presses", () => {
  const chords = () => {
    const r = registry();
    r.register(
      { id: "app.home", keys: ["g h"], scope: "app", label: "Home" },
      { id: "app.random", keys: ["g r"], scope: "app", label: "Random" },
      { id: "map.place", keys: ["g"], scope: "map", label: "Place" },
    );
    return r;
  };

  it("run on the second key, and only that", () => {
    const r = chords();
    const log: string[] = [];
    bind(r, "app.home", log);
    bind(r, "app.random", log);
    const first = press("g");
    expect(r.handle(first, 1000)).toBe(false);
    expect(first.prevented).toBe(false);
    const second = press("r");
    expect(r.handle(second, 1200)).toBe(true);
    expect(second.prevented).toBe(true);
    expect(r.handle(press("r"), 1300)).toBe(false);
    r.handle(press("g"), 2000);
    r.handle(press("Shift"), 2100);
    expect(r.handle(press("h"), 2200)).toBe(true);
    expect(log).toEqual(["app.random", "app.home"]);
  });

  it("are forgotten after a pause or another key", () => {
    const r = chords();
    const log: string[] = [];
    bind(r, "app.home", log);
    r.handle(press("g"), 1000);
    expect(r.handle(press("h"), 1000 + CHORD_MS + 1)).toBe(false);
    r.handle(press("g"), 5000);
    r.handle(press("x"), 5100);
    expect(r.handle(press("h"), 5200)).toBe(false);
    expect(log).toEqual([]);
  });

  it("are left to a typing field and to Ctrl or Alt", () => {
    const r = chords();
    const log: string[] = [];
    bind(r, "app.home", log);
    r.handle(press("g", { target: input }), 1000);
    expect(r.handle(press("h", { target: input }), 1100)).toBe(false);
    r.handle(press("g", { altKey: true }), 2000);
    expect(r.handle(press("h"), 2100)).toBe(false);
    expect(log).toEqual([]);
  });

  it("never take from a page a key it uses on its own", () => {
    const r = chords();
    const log: string[] = [];
    bind(r, "app.home", log);
    bind(r, "map.place", log);
    expect(r.handle(press("g"), 1000)).toBe(true);
    expect(r.handle(press("h"), 1100)).toBe(false);
    expect(log).toEqual(["map.place"]);
  });

  it("read as words on the sheet", () => {
    expect(displayKey("g h", false)).toBe("G then H");
  });
});

describe("the graph's keys", () => {
  const graph = () => {
    const r = createRegistry();
    r.register(...keys.all().filter((s) => s.scope === "graph" || s.id === "app.keys"));
    return r;
  };

  it("are listed in the sheet only while the graph binds them", () => {
    const r = graph();
    expect(r.sheet().find((g) => g.scope === "graph")).toBeUndefined();
    const offs = ["graph.find", "graph.open", "graph.zoomOut"].map((id) =>
      r.bind(id, { current: () => undefined }),
    );
    const listed = r.sheet().find((g) => g.scope === "graph");
    expect(listed?.name).toBe("Graph");
    expect(listed?.items.map((s) => s.id)).toEqual([
      "graph.find",
      "graph.open",
      "graph.clear",
      "graph.fit",
      "graph.zoomIn",
      "graph.zoomOut",
    ]);
    for (const off of offs) off();
    expect(r.sheet().find((g) => g.scope === "graph")).toBeUndefined();
  });

  it('leave "/" and "-" to a typing field', () => {
    const r = graph();
    const log: string[] = [];
    bind(r, "graph.find", log);
    bind(r, "graph.zoomOut", log);
    expect(r.handle(press("/", { target: input }))).toBe(false);
    expect(r.handle(press("-", { target: input }))).toBe(false);
    expect(r.handle(press("-"))).toBe(true);
    expect(r.handle(press("/"))).toBe(true);
    expect(log).toEqual(["graph.zoomOut", "graph.find"]);
  });

  it("pass Enter on when the action declines it", () => {
    const r = graph();
    r.bind("graph.open", { current: () => false });
    const e = press("Enter");
    expect(r.handle(e)).toBe(false);
    expect(e.prevented).toBe(false);
  });
});

describe("the map's keys", () => {
  const map = () => {
    const r = createRegistry();
    r.register(...keys.all().filter((s) => s.scope === "map"));
    return r;
  };
  const frame = { tagName: "DIV" };
  const button = { tagName: "BUTTON" };
  const body = { tagName: "BODY" };

  it("use no Alt, so AltGr cannot press one, and none the browser keeps", () => {
    const mine = keys.all().filter((s) => s.scope === "map");
    expect(mine.length).toBeGreaterThan(15);
    for (const s of mine) {
      for (const k of s.keys) {
        expect(k.toLowerCase()).not.toMatch(/(^|-)alt-/);
        expect(["Mod-w", "Mod-t", "Mod-n", "Shift-Mod-w", "Mod-+", "Mod--", "Mod-="]).not.toContain(
          k,
        );
      }
    }
  });

  it("read the minus key and Shift with the arrows", () => {
    expect(matches("-", press("-"))).toBe(true);
    const far = keys.get("map.panFar")!;
    expect(far.keys.some((k) => matches(k, press("ArrowLeft", { shiftKey: true })))).toBe(true);
    expect(far.keys.some((k) => matches(k, press("ArrowLeft")))).toBe(false);
    const near = keys.get("map.pan")!;
    expect(near.keys.some((k) => matches(k, press("ArrowLeft", { shiftKey: true })))).toBe(false);
  });

  it("pass an arrow on when a control has the focus, and take it on the frame or nothing", () => {
    const r = map();
    const log: string[] = [];
    let active: unknown = button;
    r.bind("map.pan", {
      current: () => {
        if (!focusIsFree(active, frame)) return false;
        log.push("pan");
      },
    });
    const e = press("ArrowLeft", { target: button });
    expect(r.handle(e)).toBe(false);
    expect(e.prevented).toBe(false);
    for (const now of [frame, body, null]) {
      active = now;
      expect(r.handle(press("ArrowLeft"))).toBe(true);
    }
    expect(log).toEqual(["pan", "pan", "pan"]);
  });

  it("say which mode each acts in, when only one", () => {
    expect(keys.get("map.edit")?.when).toBe("viewing");
    expect(keys.get("map.marker")?.when).toBe("editing");
    expect(keys.get("map.zoomOut")?.when).toBeUndefined();
    expect(keys.get("map.stopFocus")).toBeUndefined();
  });
});

describe("the keys for reading an entry", () => {
  const reading = () => {
    const r = createRegistry();
    r.register(...keys.all().filter((s) => s.scope === "entry"));
    return r;
  };

  it("are the design's four, none of them in the editor", () => {
    expect(
      keys
        .all()
        .filter((s) => s.scope === "entry")
        .map((s) => [s.id, s.keys]),
    ).toEqual([
      ["entry.back", ["Alt-ArrowLeft"]],
      ["entry.previous", ["Alt-ArrowUp"]],
      ["entry.next", ["Alt-ArrowDown"]],
      ["entry.pin", ["p"]],
    ]);
  });

  it("run on the page and never inside a text being typed", () => {
    const r = reading();
    const log: string[] = [];
    for (const id of ["entry.back", "entry.next", "entry.pin"]) {
      r.bind(id, { current: () => void log.push(id) });
    }
    expect(r.handle(press("ArrowLeft", { altKey: true }))).toBe(true);
    expect(r.handle(press("ArrowDown", { altKey: true }))).toBe(true);
    expect(r.handle(press("p"))).toBe(true);
    expect(r.handle(press("P", { shiftKey: true }))).toBe(false);
    expect(log).toEqual(["entry.back", "entry.next", "entry.pin"]);
    // A cursor moved by word, and a letter typed, are the field's own.
    for (const target of [input, editable]) {
      expect(r.handle(press("ArrowLeft", { altKey: true, target }))).toBe(false);
      expect(r.handle(press("p", { target }))).toBe(false);
    }
    expect(log).toHaveLength(3);
  });

  it("leave the key to the browser when the action has nothing to do", () => {
    const r = reading();
    r.bind("entry.back", { current: () => false });
    const e = press("ArrowLeft", { altKey: true });
    expect(r.handle(e)).toBe(false);
    expect(e.prevented).toBe(false);
  });

  it("show in the sheet only while an entry is open", () => {
    const r = reading();
    expect(r.sheet().find((g) => g.scope === "entry")).toBeUndefined();
    const off = r.bind("entry.pin", { current: () => undefined });
    expect(r.sheet().find((g) => g.scope === "entry")?.name).toBe("Reading an entry");
    off();
  });

  it("take no key the chronicle or the map already binds in its own scope", () => {
    // They share Alt+Left only with the chronicle, whose scope is inner and so wins there.
    const r = createRegistry();
    r.register(...keys.all().filter((s) => s.scope === "entry" || s.scope === "chronicle"));
    const log: string[] = [];
    r.bind("entry.back", { current: () => void log.push("entry") });
    r.bind("chronicle.endEarlier", { current: () => void log.push("chronicle") });
    r.handle(press("ArrowLeft", { altKey: true }));
    expect(log).toEqual(["chronicle"]);
  });
});

describe("the sheet", () => {
  it("lists the app's keys and the keys menus and dialogs handle, wherever it opens", () => {
    const r = registry();
    const groups = r.sheet();
    expect(groups.map((g) => g.scope)).toEqual(["app", "dialog"]);
    expect(groups[1]!.items.map((s) => s.id)).toEqual(["menu.move"]);
  });

  it("adds the open screen's keys, label-only ones included", () => {
    const r = registry();
    const leave = r.enter("map");
    const map = r.sheet().find((g) => g.scope === "map");
    expect(map?.items.map((s) => s.id)).toEqual(["map.stop", "turn.enter"]);
    leave();
    expect(r.sheet().find((g) => g.scope === "map")).toBeUndefined();
  });

  it("covers every key the app binds, with a label for each", () => {
    for (const s of keys.all()) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.keys.length).toBeGreaterThan(0);
      // Each can be written out for the sheet, Space and the minus key among them.
      for (const k of s.keys) expect(displayKey(k, false)).not.toBe("");
    }
    const listed = new Set(keys.all().map((s) => s.id));
    for (const id of ["app.switcher", "app.keys", "editor.bold", "editor.done", "table.next"]) {
      expect(listed.has(id)).toBe(true);
    }
  });
});
