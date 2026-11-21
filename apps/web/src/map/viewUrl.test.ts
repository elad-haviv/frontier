import { describe, expect, it } from "vitest";
import { readView, writeView } from "./viewUrl.ts";

describe("a view in the address", () => {
  it("keeps a projected view: its projection, turn, scale and place", () => {
    const state = {
      kind: "projected" as const,
      projection: "winkel3" as const,
      rotate: [-30.12345, 20, 5] as [number, number, number],
      k: 512.345,
      x: 10.04,
      y: -3,
    };
    expect(writeView(state)).toBe("x,winkel3,-30.123,20,5,512.35,10,-3");
    expect(readView(writeView(state), true)).toEqual({
      ...state,
      rotate: [-30.123, 20, 5],
      k: 512.35,
      x: 10,
    });
  });

  it("refuses a projected view on a flat map, or with missing numbers", () => {
    expect(readView("x,robinson,0,0,0,100,0,0", false)).toBeNull();
    expect(readView("x,robinson,0,0,0,100", true)).toBeNull();
    expect(readView("x,robinson,0,0,0,-1,0,0", true)).toBeNull();
  });

  it("shows a projection it does not know in the plain flat view at the same place", () => {
    expect(readView("x,someday,-40,-10,0,180,0,0", true)).toEqual({
      kind: "plate",
      lon: 40,
      lat: 10,
      k: Math.PI,
    });
  });

  it("brings the angles back into range", () => {
    expect(readView("x,mollweide,200,100,-190,100,0,0", true)).toMatchObject({
      rotate: [-160, 90, 170],
    });
  });

  it("still reads the views it read before", () => {
    expect(readView("g,10,20,300", true)).toEqual({ kind: "globe", lon: 10, lat: 20, k: 300 });
    expect(readView("p,10,20,3", true)).toEqual({ kind: "plate", lon: 10, lat: 20, k: 3 });
    expect(readView("f,1,2,3", false)).toEqual({ kind: "flat", x: 1, y: 2, k: 3 });
  });
});
