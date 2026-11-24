import type { FastifyInstance } from "fastify";
import { VaultPath } from "@frontier/schema";
import { z } from "zod";
import { choose } from "../export/entries.js";
import { docx, json, markdown, pdf, site, slides } from "../export/formats.js";
import type { Services } from "../app.js";

const Pick = z
  .object({
    title: z.string().trim().min(1).max(120).default("Avalymia"),
    folder: z.string().max(400).optional(),
    paths: z.array(VaultPath).max(2000).optional(),
  })
  .refine(
    (p) => p.folder !== undefined || (p.paths?.length ?? 0) > 0,
    "Choose a folder or entries.",
  );

/** A file name for the download, from the export's title. */
const fileName = (title: string, ending: string) =>
  `${title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "export"}.${ending}`;

export function exportRoutes(app: FastifyInstance, s: Services): void {
  const mayRead = (path: string) => s.quarantine.aiMayRead(path) === null;
  const deps = { index: s.index, git: s.git };

  /** The folders an export can be made of: those holding entries, appendices aside. */
  app.get("/api/export/folders", async () => {
    const folders = new Set<string>();
    for (const n of s.index.allNotes()) {
      const parts = n.path.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    return {
      folders: [...folders]
        .filter((f) => !f.startsWith("99 Appendices") && !f.startsWith("."))
        .sort((a, b) => a.localeCompare(b)),
    };
  });

  app.post("/api/export/preview", async (request) => {
    const pick = Pick.parse(request.body);
    const choice = choose(s.index, s.drafts, mayRead, pick);
    return {
      entries: choice.entries.map(({ path, title }) => ({ path, title })),
      unsaved: choice.unsaved,
      skipped: choice.skipped,
    };
  });

  const send = (kind: string, type: string, ending: string, make: typeof site) =>
    app.post(`/api/export/${kind}`, async (request, reply) => {
      const pick = Pick.parse(request.body);
      const bytes = await make(deps, pick.title, choose(s.index, s.drafts, mayRead, pick));
      const name = fileName(pick.title, ending);
      return reply
        .type(type)
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
        .send(bytes);
    });

  send("site", "application/zip", "zip", site);
  send(
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
    docx,
  );
  send("pdf", "application/pdf", "pdf", pdf);
  send("markdown", "application/zip", "zip", markdown);
  send("json", "application/json", "json", json);
  send(
    "slides",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx",
    slides,
  );
}
