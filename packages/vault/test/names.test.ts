import { describe, expect, it } from "vitest";
import { checkEntryName } from "../src/index.js";

describe("checkEntryName", () => {
  it("keeps a plain name as typed, without spaces at its ends", () => {
    expect(checkEntryName("  Greywater Harbor ")).toEqual({ ok: true, name: "Greywater Harbor" });
  });

  it("leaves out path and link signs, and a .md typed by habit", () => {
    expect(checkEntryName('Harbor/Old: "Quay"?')).toEqual({ ok: true, name: "HarborOld Quay" });
    expect(checkEntryName("[[Lantern]]#^x|y")).toEqual({ ok: true, name: "Lanternxy" });
    expect(checkEntryName("Tides.MD")).toEqual({ ok: true, name: "Tides" });
  });

  it("refuses a name that is empty once cleaned", () => {
    expect(checkEntryName("")).toEqual({ ok: false, problem: "Give the entry a name." });
    expect(checkEntryName(" /:* ")).toEqual({ ok: false, problem: "Give the entry a name." });
    expect(checkEntryName(".md")).toEqual({ ok: false, problem: "Give the entry a name." });
  });

  it("refuses a name that would hide the file", () => {
    expect(checkEntryName(".secret")).toEqual({
      ok: false,
      problem: "A name cannot start with a dot.",
    });
  });
});
