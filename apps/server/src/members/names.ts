import type { Person } from "@frontier/schema";
import type { Server } from "../server.js";

/** A person as lists show them: the name, or the email when there is no name. */
export const displayName = (p: Person | null | undefined): string =>
  p ? p.name.trim() || p.email.trim() || "Someone" : "Someone";

export async function nameOf(server: Server, id: string): Promise<string> {
  return displayName(await server.people.get(id));
}
