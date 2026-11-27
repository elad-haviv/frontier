// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { setKeysOwner } from "../aiKeys.ts";
import { rememberedRole, rememberRole, resolveRole, roleInfo } from "./projectRole.ts";

afterEach(() => {
  setKeysOwner(null);
  localStorage.clear();
});

describe("what the person may do in a project", () => {
  it("is not a reader before it is known", () => {
    const unknown = roleInfo(null);
    expect(unknown).toEqual({ role: null, known: false, canWrite: false, isOwner: false });
    expect(roleInfo("reader")).toMatchObject({ known: true, canWrite: false, isOwner: false });
    expect(roleInfo("writer")).toMatchObject({ known: true, canWrite: true, isOwner: false });
    expect(roleInfo("owner")).toMatchObject({ known: true, canWrite: true, isOwner: true });
  });

  it("comes from the record, else the list, else what the device remembered, else nothing", () => {
    setKeysOwner("person1");
    expect(resolveRole("projecta01", {})).toBeNull();
    // A writer whose record has not arrived yet is not shown as a reader once the device knows.
    rememberRole("projecta01", "writer");
    expect(resolveRole("projecta01", {})).toBe("writer");
    expect(resolveRole("projecta01", { summary: "owner" })).toBe("owner");
    expect(resolveRole("projecta01", { record: "reader", summary: "owner" })).toBe("reader");
  });

  it("is remembered for each person and project apart", () => {
    setKeysOwner("person1");
    rememberRole("projecta01", "owner");
    expect(rememberedRole("projectb01")).toBeNull();
    setKeysOwner("person2");
    expect(rememberedRole("projecta01")).toBeNull();
    setKeysOwner("person1");
    expect(rememberedRole("projecta01")).toBe("owner");
  });
});
