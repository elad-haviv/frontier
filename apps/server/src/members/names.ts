import type { Person } from "@frontier/schema";
import type { Server } from "../server.js";

/**
 * A person as lists show them: the name. With no name, the email only when `showEmail` (an owner
 * of the project is asking, who may see emails); anyone else, and every public page, gets "Someone".
 */
export const displayName = (p: Person | null | undefined, showEmail = false): string =>
  p ? p.name.trim() || (showEmail ? p.email.trim() : "") || "Someone" : "Someone";

export async function nameOf(server: Server, id: string, showEmail = false): Promise<string> {
  return displayName(await server.people.get(id), showEmail);
}
