import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  AttentionResponse,
  DraftKind,
  EntryResponse,
  ErrorBody,
  FieldJobState,
  ModelsResponse,
  SettingsResponse,
  InboxResponse,
  MapFile,
  ChronicleFile,
  SchemaResponse,
  PublishPlan,
  StatusSnapshot,
  TreeResponse,
  UnpublishedResponse,
} from "@frontier/schema";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiFailure";
  }

  /** With `stale_revision`: the id of the draft the server holds for the file. */
  draftId?: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiFailure(0, "offline", "The server could not be reached. Check your connection.");
  }
  if (res.ok) return (await res.json()) as T;
  let body: ErrorBody | null = null;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    /* not JSON */
  }
  const failure = new ApiFailure(
    res.status,
    body?.error.code ?? "unknown",
    body?.error.message ?? `The server answered with status ${res.status}.`,
  );
  if (body?.error.id) failure.draftId = body.error.id;
  throw failure;
}

const send = <T>(method: string, url: string, body?: unknown) =>
  call<T>(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

const post = <T>(url: string, body?: unknown) =>
  call<T>(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

export const api = {
  session: () => call<{ loggedIn: boolean; passkeys: boolean; password: boolean }>("/api/session"),
  /** Registers a passkey on this device, under a name the author gives it. */
  addPasskey: async (name: string) => {
    const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
      "/api/passkeys/register/options",
    );
    const response = await startRegistration({ optionsJSON });
    return post<{ ok: true }>("/api/passkeys/register/verify", { name, response });
  },
  loginWithPasskey: async () => {
    const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
      "/api/passkeys/login/options",
    );
    const response = await startAuthentication({ optionsJSON });
    return post<{ ok: true }>("/api/passkeys/login/verify", { response });
  },
  removePasskey: (id: string) =>
    send<{ ok: true }>("DELETE", `/api/passkeys/${encodeURIComponent(id)}`),
  passwordOff: (off: boolean) => send<{ ok: true }>("PUT", "/api/settings/password-off", { off }),
  login: (password: string) => post<{ ok: true }>("/api/login", { password }),
  logout: () => post<{ ok: true }>("/api/logout"),
  tree: () => call<TreeResponse>("/api/tree"),
  entry: (path: string) => call<EntryResponse>(`/api/entries?path=${encodeURIComponent(path)}`),
  status: () => call<StatusSnapshot>("/api/status"),
  attention: () => call<AttentionResponse>("/api/attention"),
  schema: () => call<SchemaResponse>("/api/schema"),
  names: (query = "") =>
    call<{ results: { path: string; title: string; alias?: string; shared?: boolean }[] }>(
      `/api/switcher${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  search: (query: string) =>
    call<{ results: { path: string; title: string; snippet: string }[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    ),
  preview: (path: string) =>
    call<{ path: string; text: string }>(`/api/preview?path=${encodeURIComponent(path)}`),
  /** The image an embed in the note `from` points at, or null when there is none. */
  findImage: (name: string, from: string) =>
    call<{ path: string | null }>(
      `/api/images/find?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`,
    ),
  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    return call<{ path: string; embed: string }>("/api/images", { method: "POST", body: form });
  },
  rename: (from: string, to: string) =>
    post<{ id: string; affected: string[] }>("/api/renames", { from, to }),

  saveDraft: (draft: {
    id: string;
    path: string;
    kind: DraftKind;
    text: string;
    revision: number;
  }) => send<{ id: string; revision: number }>("PUT", "/api/drafts", draft),
  discardDraft: (id: string) => send<{ ok: true }>("DELETE", `/api/drafts/${id}`),
  versions: (id: string) =>
    call<{ current: { text: string; revision: number }; other: { text: string } }>(
      `/api/drafts/${id}/versions`,
    ),
  mergeVersions: (id: string, text: string) =>
    post<{ id: string; revision: number }>(`/api/drafts/${id}/merge-versions`, { text }),
  resolve: (id: string, text: string) =>
    post<{ id: string; revision: number }>(`/api/drafts/${id}/resolve`, { text }),
  unpublished: () => call<UnpublishedResponse>("/api/unpublished"),
  maps: () =>
    call<{
      maps: {
        id: string;
        title: string;
        space: MapFile["space"];
        under: string | null;
        features: number;
        state: string;
      }[];
      problems: { path: string; message: string }[];
    }>("/api/maps"),
  map: (id: string) => call<LoadedMap>(`/api/maps/${id}`),
  createMap: (title: string, kind: "sphere" | "flat", image: string) =>
    post<{ id: string }>("/api/maps", { title, kind, image }),
  saveMap: (
    id: string,
    map: MapFile,
    revision: number,
    link: { feature: string; path: string }[],
  ) =>
    send<{ map: MapFile; revision: number; unlinked: { feature: string; reason: string }[] }>(
      "PUT",
      `/api/maps/${id}`,
      { map, revision, link },
    ),
  resolveMap: (id: string, keep: "mine" | "theirs") =>
    post<{ ok: true }>(`/api/maps/${id}/resolve`, { keep }),
  deleteMap: (id: string) => send<{ ok: true }>("DELETE", `/api/maps/${id}`),
  markerSets: () =>
    call<{ sets: { name: string; icons: { name: string; path: string }[] }[] }>("/api/marker-sets"),
  chronicles: () =>
    call<{
      chronicles: { id: string; title: string; main: boolean; spans: number; state: string }[];
      problems: { path: string; message: string }[];
    }>("/api/chronicles"),
  chronicle: (id: string) =>
    call<{
      chronicle: ChronicleFile;
      revision: number;
      state: string;
      entries: Record<string, { path: string; title: string }>;
    }>(`/api/chronicles/${id}`),
  createChronicle: (title: string) => post<{ id: string }>("/api/chronicles", { title }),
  copyChronicle: (copyOf: string) => post<{ id: string }>("/api/chronicles", { copyOf }),
  saveChronicle: (
    id: string,
    chronicle: ChronicleFile,
    revision: number,
    link: { span: string; path: string }[] = [],
  ) =>
    send<{
      chronicle: ChronicleFile;
      revision: number;
      unlinked: { span: string; reason: string }[];
    }>("PUT", `/api/chronicles/${id}`, { chronicle, revision, link }),
  makeMainChronicle: (id: string) => post<{ ok: true }>(`/api/chronicles/${id}/main`, {}),
  resolveChronicle: (id: string, keep: "mine" | "theirs") =>
    post<{ ok: true }>(`/api/chronicles/${id}/resolve`, { keep }),
  deleteChronicle: (id: string) => send<{ ok: true }>("DELETE", `/api/chronicles/${id}`),
  gallery: () =>
    call<{
      images: { path: string; icon: boolean; usedBy: { path: string; title: string }[] }[];
    }>("/api/gallery"),
  mapImages: () => call<{ images: string[] }>("/api/map-images"),
  history: (path?: string) =>
    call<{ versions: Version[] }>(`/api/history${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  versionText: (path: string, commit: string) =>
    call<{ text: string; before: string | null }>(
      `/api/history/version?path=${encodeURIComponent(path)}&commit=${commit}`,
    ),
  importFiles: async (files: File[], folder: string, existing: "ask" | "replace" | "both") => {
    const form = new FormData();
    // Fields first: the server reads the folder before the first file.
    form.append("folder", folder);
    form.append("existing", existing);
    for (const file of files) form.append("files", file, file.name);
    return call<ImportResult>("/api/import", { method: "POST", body: form });
  },
  importVault: async (zip: File, message: string) => {
    const form = new FormData();
    form.append("message", message);
    form.append("files", zip, zip.name);
    return call<{ files: number; commit: string }>("/api/import/vault", {
      method: "POST",
      body: form,
    });
  },
  inbox: () => call<InboxResponse>("/api/inbox"),
  proposeFields: (path: string) => post<{ made: number }>("/api/proposals/fields", { path }),
  decideOperation: (
    id: string,
    op: string,
    body: {
      decision: "accept" | "reject" | "dismiss";
      what?: string;
      when?: string;
      type?: string;
    },
  ) => post<{ draftId?: string }>(`/api/proposals/${id}/operations/${op}`, body),
  settings: () => call<SettingsResponse>("/api/settings"),
  conversations: () =>
    call<{
      conversations: { id: string; title: string; at: string; turns: number }[];
      ready: boolean;
    }>("/api/lore"),
  conversation: (id: string) =>
    call<{ conversation: LoreConversation; gone: string[] }>(`/api/lore/${id}`),
  ask: (question: string, conversation?: string) =>
    post<{ conversation: LoreConversation; gone: string[] }>("/api/lore", {
      question,
      ...(conversation ? { conversation } : {}),
    }),
  rewrite: (body: { path: string; passage: string; before: string; after: string; how: string }) =>
    post<{ text: string }>("/api/write/rewrite", body),
  characterProfile: (path: string) =>
    call<{ profile: CharacterProfile | null }>(
      `/api/characters/profile?path=${encodeURIComponent(path)}`,
    ),
  proposeProfile: (path: string) =>
    post<{ name: string; traits: (Trait & { supported: boolean })[] }>("/api/characters/propose", {
      path,
    }),
  approveProfile: (path: string, traits: Trait[], moment: { words: string; year: number | null }) =>
    post<{ profile: CharacterProfile; draft: string }>("/api/characters/approve", {
      path,
      traits,
      moment,
    }),
  say: (path: string, message: string, history: { who: "author" | "character"; text: string }[]) =>
    post<{ lines: CharacterLine[] }>("/api/characters/say", { path, message, history }),
  keepLine: (path: string, text: string) =>
    post<{ draft: string | null }>("/api/characters/line", { path, text }),
  deleteConversation: (id: string) => send<{ ok: true }>("DELETE", `/api/lore/${id}`),
  draftAddition: (id: string, turn: number, again = false) =>
    post<{ addition: LoreAddition; conversation: LoreConversation }>(
      `/api/lore/${id}/turns/${turn}/addition`,
      { again },
    ),
  previewAddition: (id: string, turn: number, path: string) =>
    post<{ path: string; isNew: boolean; before: string; after: string; base: string }>(
      `/api/lore/${id}/turns/${turn}/addition/preview`,
      { path },
    ),
  keepAddition: (id: string, turn: number, path: string, base: string) =>
    post<{ draft: string | null; conversation: LoreConversation }>(
      `/api/lore/${id}/turns/${turn}/addition/keep`,
      { path, base },
    ),
  saveAi: (body: {
    key?: string | null;
    models?: { extraction?: string | null; conversation?: string | null };
    monthlyCapUsd?: number;
    proposeOnPublish?: boolean;
  }) => send<{ ok: true }>("PUT", "/api/settings/ai", body),
  testAi: () => post<{ ok: boolean; costUsd: number; message: string }>("/api/settings/ai/test"),
  models: () => call<ModelsResponse>("/api/ai/models"),
  aiLog: () =>
    call<{
      month: string;
      totalUsd: number;
      capUsd: number;
      calls: {
        at: string;
        task: string;
        model: string;
        costUsd: number;
        entry: string | null;
        ok: boolean;
        error?: string;
      }[];
    }>("/api/ai/log"),
  fieldJob: () => call<FieldJobState>("/api/proposals/job"),
  estimateJob: (folder: string) =>
    post<{ entries: number; estimateUsd: number | null }>("/api/proposals/job", { folder }),
  startJob: (folder: string) =>
    post<{ started: true }>("/api/proposals/job", { folder, confirm: true }),
  cancelJob: () => send<{ ok: true }>("DELETE", "/api/proposals/job"),
  branchFile: (branch: string, path: string) =>
    call<{ before: string | null; after: string | null }>(
      `/api/inbox/branch-file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
    ),
  decideFile: (branch: string, path: string, blob: string, decision: "accept" | "reject") =>
    post<{ draftId?: string; branchRemoved: boolean }>("/api/inbox/branch-file", {
      branch,
      path,
      blob,
      decision,
    }),
  decideBranch: (branch: string, tip: string, decision: "reject" | "remove") =>
    post<{ branchRemoved: boolean }>("/api/inbox/branch", { branch, tip, decision }),
  plan: (draftIds: string[], renameIds: string[], decisionIds: string[] = []) =>
    post<PublishPlan>("/api/publish/plan", { draftIds, renameIds, decisionIds }),
  decideQuarantine: (path: string, commit: string, decision: "accept" | "revert") =>
    post<{ id: string; draftId?: string }>("/api/quarantine", { path, commit, decision }),
  withdrawDecision: (id: string) => send<{ ok: true }>("DELETE", `/api/quarantine/${id}`),
  confirm: (planId: string, confirmedMergeIds: string[], message: string) =>
    post<{ commit: string }>("/api/publish/confirm", { planId, confirmedMergeIds, message }),
  cancelRename: (id: string) => send<{ ok: true }>("DELETE", `/api/renames/${id}`),
};

/** A new draft id: 12 lower-case letters and digits, made in the browser. */
export function newDraftId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 252 && out.length < 12) out += alphabet[byte % 36];
    }
  }
  return out;
}

export function editUrl(path: string): string {
  return "/edit/" + path.split("/").map(encodeURIComponent).join("/");
}

/** The address of an entry's page. */
export function entryUrl(path: string, heading?: string | null): string {
  const base = "/e/" + path.split("/").map(encodeURIComponent).join("/");
  return heading ? `${base}#${encodeURIComponent(heading)}` : base;
}

/** The address of a vault image, scaled to a width the server offers. */
export function imageUrl(path: string, width?: 320 | 640 | 1280): string {
  return `/api/images?path=${encodeURIComponent(path)}${width ? `&w=${width}` : ""}`;
}

/** The address of a new image on an agent's branch, for the inbox. */
export function branchImageUrl(branch: string, path: string): string {
  return `/api/images?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&w=640`;
}

/** A map as the server gives it: the map, its draft revision, and the names its features need. */
export interface LoadedMap {
  map: MapFile;
  revision: number;
  state: "published" | "unpublished" | "new";
  entries: Record<string, { path: string; title: string }>;
  children: Record<string, string>;
}

/** The address of a map image at the size maps ask for: 4096, or 2560 on a small or modest device. */
export function mapImageUrl(path: string, size: 2560 | 4096): string {
  return `/api/images?path=${encodeURIComponent(path)}&w=${size}`;
}

export const chronicleUrl = (id: string): string => `/chronicle/${id}`;

export const mapUrl = (id: string, feature?: string): string =>
  `/map/${id}${feature ? `?f=${encodeURIComponent(feature)}` : ""}`;

/** One saved version of the library, or of a file in it. */
export interface Version {
  commit: string;
  at: string;
  message: string;
  paths: string[];
}

export interface ImportResult {
  imported: { name: string; path: string; kind: "note" | "image" }[];
  clashes: { name: string; path: string }[];
  refused: { name: string; reason: string }[];
}

export const historyUrl = (path: string): string =>
  "/history/" + path.split("/").map(encodeURIComponent).join("/");

/** A lore conversation, as the server keeps it. */
export interface LoreAddition {
  text: string;
  newPath: string | null;
  model: string;
  at: string;
}
export interface LoreTurn {
  question: string;
  answer: {
    paragraphs: {
      text: string;
      sources: string[];
      quotes: { path: string; text: string }[];
      grounded: boolean;
    }[];
    related: { path: string; why: string }[];
    missing: string;
    droppedQuotes: number;
  };
  given: string[];
  model: string;
  costUsd: number;
  at: string;
  addition: LoreAddition | null;
  kept: { path: string; at: string } | null;
}
export interface LoreConversation {
  id: string;
  title: string;
  at: string;
  turns: LoreTurn[];
}

export const askUrl = (id?: string): string => (id ? `/ask/${id}` : "/ask");

export interface Trait {
  kind: "voice" | "knows" | "believes" | "unknown";
  text: string;
  sources: string[];
  quotes: { path: string; text: string }[];
}
export interface CharacterProfile {
  entry: string;
  name: string;
  traits: Trait[];
  moment: { words: string; year: number | null };
  approvedAt: string;
}
export interface CharacterLine {
  text: string;
  sources: string[];
  quotes: { path: string; text: string }[];
  improvised: boolean;
}
export const talkUrl = (path: string): string =>
  "/talk/" + path.split("/").map(encodeURIComponent).join("/");
