import type { ProjectRole } from "@frontier/schema";

/**
 * THE role table (stage 27b): the least role each route of a project needs. A key is the method and
 * the path after `/api` (so `GET /entries` is `GET /api/p/<project>/entries`, and the unprefixed
 * `GET /api/entries` that devices on the previous web build still use). The guard (`guard.ts`)
 * checks it before a route runs; a route registered without an entry here stops the server from
 * starting, and `test/projectRoles.test.ts` walks every route as each role.
 *
 *   reader   reads the library; asks and talks to characters (with their own key); their own
 *            pins and conversations; exports
 *   writer   anything that changes the library or the unsaved changes: drafts, saving versions,
 *            uploads, imports, maps, chronicles, folders, inbox, quarantine, AI writing help;
 *            comments for now (see below)
 *   owner    the project's settings, and deleting it; its members and invitation links (stage 27c).
 *            Backups are automatic and have no route yet.
 *
 * A reader's requests run in the saved view (`view.ts`): the draft store answers nothing, so a
 * reader gets the last saved version of everything and never anyone's unsaved changes. Writing
 * help that drafts into the library (an addition to an entry) and what AI has proposed but nobody
 * has kept (a map's discoveries) are writers', for the same reason.
 *
 * Comments are writer-only until stage 27e: until then they are one person's private notes ("for
 * me", "for the AI"), which a reader must not read or add to.
 */
export const ROUTE_ROLES: Record<string, ProjectRole> = {
  // The project itself
  "GET /project": "reader",
  "PUT /project": "owner",
  "DELETE /project": "owner",

  // People (stage 27c). Everyone in the project reads the list (emails only for owners, decided
  // in the route); any member may leave; the rest is the owners'.
  "GET /members": "reader",
  "PUT /members/:id": "owner",
  "DELETE /members/:id": "owner",
  "POST /members/leave": "reader",
  "GET /invites": "owner",
  "POST /invites": "owner",
  "DELETE /invites/:id": "owner",

  // Reading
  "GET /schema": "reader",
  "GET /tree": "reader",
  "GET /entries": "reader",
  "GET /images/find": "reader",
  "GET /graph": "reader",
  "GET /search": "reader",
  "GET /preview": "reader",
  "GET /switcher": "reader",
  "GET /gallery": "reader",
  // Reader for the library's images; with `?branch=` (an inbox branch, not yet published) the route
  // asks for writer itself, inside the handler.
  "GET /images": "reader",
  "GET /history": "reader",
  "GET /history/version": "reader",
  "GET /status": "reader",
  "GET /status/events": "reader",
  "GET /attention": "reader",
  "GET /library-files/:name": "reader",
  "GET /maps": "reader",
  "GET /maps/:id": "reader",
  "GET /marker-sets": "reader",
  "GET /maps/:id/discoveries": "writer",
  "GET /maps/:id/discoveries/:d/art": "writer",
  "GET /chronicles": "reader",
  "GET /chronicles/:id": "reader",

  // Export
  "GET /export/folders": "reader",
  "POST /export/preview": "reader",
  "POST /export/site": "reader",
  "POST /export/docx": "reader",
  "POST /export/pdf": "reader",
  "POST /export/markdown": "reader",
  "POST /export/json": "reader",
  "POST /export/slides": "reader",
  "GET /export/library.zip": "reader",

  // Asking, and talking to characters: a reader does these with their own AI key
  "GET /lore": "reader",
  "GET /lore/:id": "reader",
  "POST /lore": "reader",
  "POST /lore/stream": "reader",
  "POST /lore/runs/:run/stop": "reader",
  "DELETE /lore/:id": "reader",
  "POST /lore/:id/turns/:n/addition": "writer",
  "POST /lore/:id/turns/:n/addition/preview": "writer",
  "GET /characters/profile": "reader",
  "POST /characters/say": "reader",

  // Keep going: a person's own pins and question, and what is read from the library
  "GET /keep-going/queue": "reader",
  "GET /keep-going/week": "reader",
  "GET /keep-going/from-here": "reader",
  "GET /keep-going/random": "reader",
  "GET /keep-going/question": "reader",
  "POST /keep-going/question": "reader",
  "GET /pins": "reader",
  "POST /pins": "reader",
  "DELETE /pins": "reader",
  "PUT /pins": "reader",

  // Writing
  "PUT /drafts": "writer",
  "DELETE /drafts/:id": "writer",
  "GET /drafts/:id/versions": "writer",
  "DELETE /drafts/:id/versions/server": "writer",
  "POST /drafts/:id/merge-versions": "writer",
  "POST /drafts/:id/resolve": "writer",
  "GET /unpublished": "writer",
  "POST /publish/plan": "writer",
  "POST /publish/confirm": "writer",
  "POST /renames": "writer",
  "DELETE /renames/:id": "writer",
  "PUT /library-files/:name": "writer",
  "POST /library-files/:name/resolve": "writer",
  "POST /folders/delete": "writer",
  "POST /folders/apply-type": "writer",
  "POST /images": "writer",
  "POST /images/from-url": "writer",
  "POST /import": "writer",
  "POST /import/vault": "writer",
  "POST /maps": "writer",
  "PUT /maps/:id": "writer",
  "POST /maps/:id/resolve": "writer",
  "DELETE /maps/:id": "writer",
  "POST /chronicles": "writer",
  "PUT /chronicles/:id": "writer",
  "POST /chronicles/:id/main": "writer",
  "POST /chronicles/:id/resolve": "writer",
  "DELETE /chronicles/:id": "writer",

  // AI writing help
  "POST /write/rewrite": "writer",
  "POST /write/review": "writer",
  "GET /write/reviews": "writer",
  "PATCH /write/reviews/:id/findings/:finding": "writer",
  "DELETE /write/reviews/:id": "writer",
  "DELETE /write/reviews": "writer",
  "POST /write/review/ask": "writer",
  "POST /lore/draft": "writer",
  "POST /lore/draft/check": "writer",
  "POST /lore/draft/keep": "writer",
  "POST /lore/:id/turns/:n/addition/keep": "writer",
  "POST /characters/propose": "writer",
  "POST /characters/approve": "writer",
  "POST /characters/line": "writer",
  "POST /keep-going/link-it": "writer",
  "POST /keep-going/link-it/undo": "writer",
  "POST /keep-going/after-publish": "writer",
  "POST /keep-going/whats-missing": "writer",
  "POST /maps/:id/discover": "writer",
  "POST /maps/:id/discover/estimate": "writer",
  "POST /maps/:id/generate": "writer",
  "POST /maps/:id/discoveries/:d/art": "writer",
  "POST /maps/:id/discoveries/:d/keep": "writer",
  "DELETE /maps/:id/discoveries/:d": "writer",
  "POST /proposals/fields": "writer",
  "POST /proposals/job": "writer",
  "POST /proposals/:id/operations/:op": "writer",

  // What waits for the writers' attention
  "GET /inbox": "writer",
  "GET /inbox/branch-file": "writer",
  "POST /inbox/branch-file": "writer",
  "POST /inbox/branch": "writer",
  "POST /quarantine": "writer",
  "DELETE /quarantine/:id": "writer",

  // Comments (see above)
  "GET /comments": "writer",
  "GET /comments/count": "writer",
  "POST /comments": "writer",
  "PATCH /comments/:id": "writer",
  "DELETE /comments/:id": "writer",
  "POST /comments/:id/work": "writer",
};

/** The role a route needs, by method and the path after `/api`; HEAD needs what GET needs. */
export function roleFor(method: string, pattern: string): ProjectRole | undefined {
  return ROUTE_ROLES[`${method === "HEAD" ? "GET" : method} ${pattern}`];
}
