import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { CLIENT_API } from "@frontier/schema";
import { connection } from "./sync/connection.ts";
import { randomId } from "./sync/db.ts";
import type {
  AddRelationRequest,
  RelationsResponse,
  RemoveRelationRequest,
  AfterPublishResponse,
  AttentionResponse,
  CreateRenameResponse,
  DraftKind,
  DraftVersionsResponse,
  EntryResponse,
  ErrorBody,
  FieldJobState,
  FromHereResponse,
  GraphResponse,
  ModelsResponse,
  AiLogResponse,
  AiProviderKind,
  AiProviderView,
  AiTaskName,
  PictureShape,
  PictureTry,
  PicturesResponse,
  PinsResponse,
  ProviderCheckResponse,
  ProvidersResponse,
  QueueResponse,
  QuestionResponse,
  RandomQuery,
  RandomResponse,
  SettingsResponse,
  InboxResponse,
  KeepGoingSettings,
  KeepGoingSettingsRequest,
  LibraryFileName,
  LinkItResponse,
  LinkItUndo,
  MapFile,
  MapPreview,
  ChronicleFile,
  SchemaResponse,
  PublishPlan,
  StatusSnapshot,
  TreeResponse,
  UnpublishedResponse,
  WeekResponse,
  WhatsMissingResponse,
} from "@frontier/schema";

/** An image of the library, as the gallery and the image dialog show it. */
export interface GalleryImage {
  path: string;
  /** In the marker icons' folder. */
  icon: boolean;
  usedBy: { path: string; title: string }[];
  /** Uploaded, and not yet published. */
  unpublished?: boolean;
}

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
  /** Where in the app the problem is put right, such as "/settings/ai/providers". */
  href?: string;
}

/** This device, as the save queue knows it; sent with every request once known. */
let device: { id: string; name: string } | null = null;

export function setDevice(known: { id: string; name: string } | null): void {
  device = known;
}

/** Routes that answer without a session, whose answers say nothing about the connection's state. */
const OPEN = /^\/api\/(session|login|passkeys\/login\/)/;

/**
 * Every request's headers: the shape of writes this build sends, and, once known, the device and
 * its name URI-encoded, since a header holds only ASCII.
 */
function headers(init?: RequestInit): Record<string, string> {
  return {
    ...(init?.headers as Record<string, string> | undefined),
    "frontier-api": String(CLIENT_API),
    ...(device
      ? { "frontier-device": device.id, "frontier-device-name": encodeURIComponent(device.name) }
      : {}),
  };
}

const unreachable = () =>
  new ApiFailure(0, "offline", "Can't reach Frontier. Check your connection, then try again.");

/** What a proxy in front of a stopped server answers. Frontier's own 502 and 503 carry its error. */
const GATEWAY = new Set([502, 503, 504]);

const isErrorBody = (body: unknown): body is ErrorBody =>
  typeof (body as ErrorBody | null)?.error?.code === "string";

/**
 * Reads the device can answer when the server cannot (stage 15b, `offline/device.ts`). `read`
 * gives the answer for a GET of `url`, or null when the device has nothing to do with that address.
 * With `direct`, only the server answers, and the device keeps what it says.
 */
export interface ReadThrough {
  read(url: string, network: () => Promise<unknown>, direct: boolean): Promise<unknown> | null;
}

let readThrough: Promise<ReadThrough | null> | null = null;
let direct = false;

/** Puts the device layer in front of every GET; null takes it away, as in tests. */
export function setReadThrough(through: Promise<ReadThrough | null> | null): void {
  readThrough = through;
}

/**
 * Makes the reads started inside `read` go to the server only, as the save queue's and the device
 * keeper's must: a merge or a refresh built on a device answer would build on old text.
 */
export function fromServer<T>(read: () => Promise<T>): Promise<T> {
  direct = true;
  try {
    return read();
  } finally {
    direct = false;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  // Read before the first wait, while `fromServer` still holds.
  const only = direct;
  if (readThrough && (init?.method ?? "GET") === "GET") {
    const through = await readThrough;
    const answer = through?.read(url, () => request(url, init), only);
    if (answer) return answer as Promise<T>;
  }
  return request<T>(url, init);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const watched = !OPEN.test(url);
  try {
    res = await fetch(url, { credentials: "same-origin", ...init, headers: headers(init) });
  } catch {
    // Stopped on purpose, as by a Stop button: the server is not unreachable.
    if (init?.signal?.aborted) throw new ApiFailure(0, "stopped", "Stopped.");
    if (watched) connection.unreachable();
    throw unreachable();
  }
  const read = await res.json().then(
    (body: unknown) => ({ body }),
    () => null,
  );
  if (init?.signal?.aborted) throw new ApiFailure(0, "stopped", "Stopped.");
  // A gateway's page, or a captive portal's, is not the server: as if it could not be reached.
  if (res.ok ? read === null : GATEWAY.has(res.status) && !isErrorBody(read?.body)) {
    if (watched) connection.unreachable();
    throw unreachable();
  }
  if (watched) {
    if (res.status === 401) connection.unauthorised();
    else connection.reached();
  }
  if (res.ok) return read!.body as T;
  const body = isErrorBody(read?.body) ? read.body : null;
  const failure = new ApiFailure(
    res.status,
    body?.error.code ?? "unknown",
    body?.error.message ?? `The server answered with status ${res.status}.`,
  );
  if (body?.error.id) failure.draftId = body.error.id;
  if (body?.error.href) failure.href = body.error.href;
  throw failure;
}

/** Splits server-sent events into `{ event, data }`, keeping an unfinished one for the next text. */
export function eventsIn(text: string): {
  events: { event: string; data: string }[];
  rest: string;
} {
  const blocks = text.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: { event: string; data: string }[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    // A block of comments only (the keep-alives) has no data.
    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

/**
 * A POST whose answer comes as server-sent events: each is passed to `onEvent` as it arrives, and
 * the `done` event's data is returned. An `error` event, or a refusal before the stream starts, is
 * thrown as an ApiFailure. `signal` stops reading, not the work on the server.
 */
async function streamed<T>(
  url: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<T> {
  const lost = () =>
    new ApiFailure(0, "offline", "The connection was lost before the answer came.");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: headers({ headers: { "content-type": "application/json" } }),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    connection.unreachable();
    throw unreachable();
  }
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) {
    const read: unknown = await res.json().catch(() => null);
    if (GATEWAY.has(res.status) && !isErrorBody(read)) {
      connection.unreachable();
      throw unreachable();
    }
    if (res.status === 401) connection.unauthorised();
    else connection.reached();
    const error = isErrorBody(read) ? read.error : null;
    throw new ApiFailure(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? `The server answered with status ${res.status}.`,
    );
  }
  connection.reached();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { done: T } | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? "\n\n" : decoder.decode(value, { stream: true });
      const { events, rest } = eventsIn(buffer);
      buffer = rest;
      for (const e of events) {
        const data: unknown = JSON.parse(e.data);
        if (e.event === "done") result = { done: data as T };
        else if (e.event === "error") {
          const said = data as { code?: string; message?: string };
          throw new ApiFailure(
            200,
            said.code ?? "unknown",
            said.message ?? "The answer could not be made.",
          );
        } else onEvent(e.event, data);
      }
      if (done) break;
    }
  } catch (err) {
    if (err instanceof ApiFailure || signal?.aborted) throw err;
    throw lost();
  } finally {
    reader.releaseLock();
  }
  if (!result) throw lost();
  return result.done;
}

const send = <T>(method: string, url: string, body?: unknown) =>
  call<T>(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

const post = <T>(url: string, body?: unknown, signal?: AbortSignal) =>
  call<T>(url, {
    method: "POST",
    ...(signal ? { signal } : {}),
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
  /** Every entry and every link between two entries, with the top-level folders' colours. */
  graph: () => call<GraphResponse>("/api/graph"),
  /** Every entry's relations as facts, with the kinds of relation (stage 30). */
  relations: () => call<RelationsResponse>("/api/relations"),
  /** Writes one relation on one entry; `made` is the new entry's path when one was made. */
  addRelation: (body: AddRelationRequest) =>
    post<{ ok: true; draft: string | null; made: string | null }>("/api/relations", body),
  removeRelation: (body: RemoveRelationRequest) =>
    post<{ ok: true }>("/api/relations/remove", body),
  entry: (path: string) => call<EntryResponse>(`/api/entries?path=${encodeURIComponent(path)}`),
  status: () => call<StatusSnapshot>("/api/status"),
  attention: () => call<AttentionResponse>("/api/attention"),
  schema: () => call<SchemaResponse>("/api/schema"),
  names: (query = "") =>
    call<{
      results: { path: string; title: string; alias?: string; shared?: boolean; words?: number }[];
    }>(`/api/switcher${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  search: (query: string) =>
    call<{ results: { path: string; title: string; snippet: string; words?: number }[] }>(
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
  /** Has the server take an image from a web address; it is kept as an upload. */
  imageFromUrl: (url: string) =>
    post<{ path: string; embed: string }>("/api/images/from-url", { url }),
  /** Stage 29: whether pictures can be made for an entry, their cost, and the entry's tries. */
  pictures: (entry: string) =>
    call<PicturesResponse>(`/api/pictures?entry=${encodeURIComponent(entry)}`),
  /** Makes one picture; it is kept as a try until inserted or a week has passed. */
  makePicture: (input: { entry: string; prompt: string; style: string; shape: PictureShape }) =>
    post<{ try: PictureTry }>("/api/pictures", input),
  /** Keeps a try as an unpublished image, as an upload. */
  insertPicture: (id: string, name: string) =>
    post<{ path: string; embed: string }>(`/api/pictures/${id}/insert`, { name }),
  pictureUrl: (id: string, w?: number) => `/api/pictures/${id}${w ? `?w=${w}` : ""}`,
  rename: (from: string, to: string) => post<CreateRenameResponse>("/api/renames", { from, to }),

  /** Pages save through the queue (`sync/queue.ts`), which calls this. */
  saveDraft: (draft: {
    id: string;
    path: string;
    kind: DraftKind;
    text: string;
    revision: number;
    baseBlob?: string;
    op?: string;
  }) => send<{ id: string; revision: number }>("PUT", "/api/drafts", draft),
  discardDraft: (id: string) => send<{ ok: true }>("DELETE", `/api/drafts/${id}`),
  versions: (id: string) => call<DraftVersionsResponse>(`/api/drafts/${id}/versions`),
  /** Dismisses the other side of an item clash kept beside a draft (stage 15c). */
  dismissKept: (id: string) => send<{ ok: true }>("DELETE", `/api/drafts/${id}/versions/server`),
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
        /** When it last changed, and a small preview for its card (stage 23). */
        edited?: string | null;
        preview?: MapPreview | null;
        /** The version mark the device compares (stage 15b). */
        v?: string;
      }[];
      problems: { path: string; message: string }[];
    }>("/api/maps"),
  map: (id: string) => call<LoadedMap>(`/api/maps/${id}`),
  createMap: (title: string, kind: "sphere" | "flat" | "stars" | "system", image?: string) =>
    post<{ id: string }>("/api/maps", { title, kind, ...(image ? { image } : {}) }),
  /** Pages save through the queue (`sync/queue.ts`), which calls this. */
  saveMap: (
    id: string,
    map: MapFile,
    revision: number,
    link: { feature: string; path: string }[],
    sent: { baseBlob?: string; op?: string; clashes?: string[] } = {},
  ) =>
    send<{
      map: MapFile;
      revision: number;
      unlinked: { feature: string; reason: string }[];
      /** The draft the other side of a clash was kept beside (stage 15c). */
      kept?: string;
    }>("PUT", `/api/maps/${id}`, { map, revision, link, ...sent }),
  resolveMap: (id: string, keep: "mine" | "theirs") =>
    post<{ ok: true }>(`/api/maps/${id}/resolve`, { keep }),
  deleteMap: (id: string) => send<{ ok: true }>("DELETE", `/api/maps/${id}`),
  markerSets: () =>
    call<{ sets: { name: string; icons: { name: string; path: string }[] }[] }>("/api/marker-sets"),
  chronicles: () =>
    call<{
      chronicles: {
        id: string;
        title: string;
        main: boolean;
        spans: number;
        state: string;
        /** The version mark the device compares (stage 15b). */
        v?: string;
      }[];
      problems: { path: string; message: string }[];
    }>("/api/chronicles"),
  chronicle: (id: string) =>
    call<{
      chronicle: ChronicleFile;
      revision: number;
      state: string;
      blob: string;
      entries: Record<string, { path: string; title: string }>;
      /** Which spans something on a map follows (stage 17); absent from an older server. */
      onMaps?: Record<string, { map: string; title: string; features: number }[]>;
    }>(`/api/chronicles/${id}`),
  createChronicle: (title: string) => post<{ id: string }>("/api/chronicles", { title }),
  copyChronicle: (copyOf: string) => post<{ id: string }>("/api/chronicles", { copyOf }),
  /** Pages save through the queue (`sync/queue.ts`), which calls this. */
  saveChronicle: (
    id: string,
    chronicle: ChronicleFile,
    revision: number,
    link: { span: string; path: string }[] = [],
    sent: { baseBlob?: string; op?: string; clashes?: string[] } = {},
  ) =>
    send<{
      chronicle: ChronicleFile;
      revision: number;
      unlinked: { span: string; reason: string }[];
      kept?: string;
    }>("PUT", `/api/chronicles/${id}`, { chronicle, revision, link, ...sent }),
  makeMainChronicle: (id: string) => post<{ ok: true }>(`/api/chronicles/${id}/main`, {}),
  resolveChronicle: (id: string, keep: "mine" | "theirs") =>
    post<{ ok: true }>(`/api/chronicles/${id}/resolve`, { keep }),
  deleteChronicle: (id: string) => send<{ ok: true }>("DELETE", `/api/chronicles/${id}`),
  gallery: () =>
    call<{
      images: GalleryImage[];
    }>("/api/gallery"),
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
  /**
   * Asks as `ask` does, telling each step of the work as it happens. Stopping the reading does not
   * stop the work: `stopAsking` does.
   */
  askStreamed: (
    question: string,
    conversation: string | undefined,
    onEvent: (event: LoreEvent) => void,
    signal?: AbortSignal,
  ) =>
    streamed<{ conversation: LoreConversation; gone: string[] }>(
      "/api/lore/stream",
      { question, ...(conversation ? { conversation } : {}) },
      (type, data) => onEvent({ ...(data as object), type } as LoreEvent),
      signal,
    ),
  stopAsking: (run: string) => post<{ ok: true }>(`/api/lore/runs/${run}/stop`),
  /** A passage rewritten as asked; `signal` stops the request, and the server's call with it. */
  rewrite: (
    body: {
      path: string;
      passage: string;
      before: string;
      after: string;
      how: string;
      previous?: string[];
      refine?: { suggestion: string; how: string };
    },
    signal?: AbortSignal,
  ) => post<{ text: string }>("/api/write/rewrite", body, signal),
  /** An opinion of the entry in the editor (stage 24); nothing is saved or changed. */
  consult: (
    body: {
      path: string;
      text: string;
      focus: "edits" | "content";
      passage?: string;
      looks?: string[];
      how?: string;
    },
    signal?: AbortSignal,
  ) => post<ConsultReview>("/api/write/review", body, signal),
  /** The saved consultations of an entry, newest first. */
  consultReviews: (path: string) =>
    call<{ reviews: ConsultReview[] }>(`/api/write/reviews?path=${encodeURIComponent(path)}`),
  /** Keeps what the author did with a finding. */
  consultChange: (id: string, finding: string, change: ConsultChange) =>
    send<{ review: ConsultReview }>(
      "PATCH",
      `/api/write/reviews/${id}/findings/${finding}`,
      change,
    ),
  consultDelete: (id: string) => send<{ ok: true }>("DELETE", `/api/write/reviews/${id}`),
  consultClear: (path: string) =>
    send<{ ok: true }>("DELETE", `/api/write/reviews?path=${encodeURIComponent(path)}`),
  /** A follow-up about one finding of a consultation. */
  consultAsk: (
    body: {
      path: string;
      text: string;
      question: string;
      finding: { kind: string; anchor: string; comment: string };
    },
    signal?: AbortSignal,
  ) =>
    post<{ text: string; sources: { path: string; title: string; quote: string }[] }>(
      "/api/write/review/ask",
      body,
      signal,
    ),
  /** A new entry drafted from what the author said; nothing is saved. `signal` stops it. */
  draftEntry: (said: string, signal?: AbortSignal) =>
    post<{ draft: EntryProposal }>("/api/lore/draft", { said }, signal),
  /** One changed paragraph of a draft entry, checked against the lore again. */
  checkEntryDraft: (
    body: { title: string; paragraphs: string[]; changed: number },
    signal?: AbortSignal,
  ) => post<EntryDraftCheck>("/api/lore/draft/check", body, signal),
  /** Keeps a draft entry as an unsaved change: a new entry that waits to be published. */
  keepEntryDraft: (body: {
    title: string;
    folder: string;
    paragraphs: string[];
    againstLore: { paragraph: number; path: string }[];
  }) => post<{ draft: string; path: string }>("/api/lore/draft/keep", body),
  comments: (path: string) =>
    call<{ comments: PassageComment[] }>(`/api/comments?path=${encodeURIComponent(path)}`),
  commentCount: (path: string) =>
    call<{ open: number }>(`/api/comments/count?path=${encodeURIComponent(path)}`),
  addComment: (body: Omit<PassageComment, "id" | "at">) =>
    post<{ comment: PassageComment }>("/api/comments", body),
  changeComment: (id: string, change: { text?: string; for?: "me" | "ai" }) =>
    send<{ comment: PassageComment }>("PATCH", `/api/comments/${id}`, change),
  removeComment: (id: string) => send<{ ok: true }>("DELETE", `/api/comments/${id}`),
  workOnComment: (
    id: string,
    around: { before: string; after: string; previous?: string[] },
    signal?: AbortSignal,
  ) => post<{ text: string }>(`/api/comments/${id}/work`, around, signal),
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
  /** Says something to the character; the conversation is saved, and started when `talk` is null. */
  say: (path: string, message: string, talk: string | null) =>
    post<{ talk: CharacterTalk; lines: CharacterLine[] }>("/api/characters/say", {
      path,
      message,
      talk,
    }),
  keepLine: (path: string, text: string, talk: string | null, line: number) =>
    post<{ draft: string | null; talk: CharacterTalk | null }>("/api/characters/line", {
      path,
      text,
      talk,
      line,
    }),
  /** Which of the entries read for the profile a year of the main chronicle keeps from them. */
  characterMoment: (path: string, year: string) =>
    call<{ read: number; withheld: { path: string; title: string }[] }>(
      `/api/characters/moment?path=${encodeURIComponent(path)}&year=${encodeURIComponent(year)}`,
    ),
  talks: (path: string) =>
    call<{ talks: TalkSummary[] }>(`/api/characters/talks?path=${encodeURIComponent(path)}`),
  talk: (id: string) => call<{ talk: CharacterTalk }>(`/api/characters/talks/${id}`),
  deleteTalk: (id: string) =>
    call<{ ok: true }>(`/api/characters/talks/${id}`, { method: "DELETE" }),
  discoveries: (map: string) =>
    call<{ discoveries: Discovery[]; ready: boolean; art: boolean; folders: string[] }>(
      `/api/maps/${map}/discoveries`,
    ),
  /** Asks what is found at up to six places, in one AI call. */
  discover: (map: string, spots: SpotAsk[], chronicle: string | null, year: number | null) =>
    post<{ discoveries: Discovery[] }>(`/api/maps/${map}/discover`, { spots, chronicle, year }),
  /** What asking about places would cost; nothing is sent to the AI. */
  estimateDiscovery: (
    map: string,
    spots: SpotAsk[],
    chronicle: string | null,
    year: number | null,
  ) =>
    post<{ calls: number; usd: number | null; spentUsd: number; capUsd: number }>(
      `/api/maps/${map}/discover/estimate`,
      { spots, chronicle, year },
    ),
  generateFeatures: (map: string, ask: GenerateAsk) =>
    post<{ items: GeneratedFeature[] }>(`/api/maps/${map}/generate`, ask),
  discoveryArt: (map: string, id: string) =>
    post<{ discovery: Discovery }>(`/api/maps/${map}/discoveries/${id}/art`, {}),
  keepDiscovery: (map: string, id: string, folder: string) =>
    post<{ path: string }>(`/api/maps/${map}/discoveries/${id}/keep`, { folder }),
  dropDiscovery: (map: string, id: string) =>
    send<{ ok: true }>("DELETE", `/api/maps/${map}/discoveries/${id}`),
  exportFolders: () => call<{ folders: string[] }>("/api/export/folders"),
  exportPreview: (pick: ExportPick) =>
    post<{ entries: { path: string; title: string }[]; unsaved: string[]; skipped: string[] }>(
      "/api/export/preview",
      pick,
    ),
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
    models?: { extraction?: string | null; conversation?: string | null; art?: string | null };
    artStyle?: string;
    monthlyCapUsd?: number;
    proposeOnPublish?: boolean;
  }) => send<{ ok: true }>("PUT", "/api/settings/ai", body),
  testAi: (body: { task?: AiTaskName; model?: string } = {}) =>
    post<{ ok: boolean; costUsd: number; message: string; image?: string }>(
      "/api/settings/ai/test",
      body,
    ),
  /** Every connected provider's models; `refresh` fetches the lists again. */
  models: (query: { task?: AiTaskName; q?: string; refresh?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (query.task) params.set("task", query.task);
    if (query.q) params.set("q", query.q);
    if (query.refresh) params.set("refresh", "1");
    const qs = params.toString();
    return call<ModelsResponse>(`/api/ai/models${qs ? `?${qs}` : ""}`);
  },
  aiLog: (month?: string) =>
    call<AiLogResponse>(`/api/ai/log${month ? `?month=${encodeURIComponent(month)}` : ""}`),
  providers: () => call<ProvidersResponse>("/api/ai/providers"),
  /** Adds a provider; the server checks the key with it before storing anything. */
  addProvider: (body: {
    kind: AiProviderKind;
    key?: string;
    baseUrl?: string;
    name?: string;
    saveAnyway?: boolean;
  }) => post<ProviderCheckResponse>("/api/ai/providers", body),
  checkProvider: (id: string) =>
    post<ProviderCheckResponse>(`/api/ai/providers/${encodeURIComponent(id)}/check`),
  providerKey: (id: string, key: string | null, saveAnyway = false) =>
    send<ProviderCheckResponse>("PUT", `/api/ai/providers/${encodeURIComponent(id)}/key`, {
      key,
      ...(saveAnyway ? { saveAnyway } : {}),
    }),
  updateProvider: (
    id: string,
    body: { name?: string | null; enabled?: boolean; baseUrl?: string | null },
  ) =>
    send<{ provider: AiProviderView | null }>(
      "PATCH",
      `/api/ai/providers/${encodeURIComponent(id)}`,
      body,
    ),
  removeProvider: (id: string, force = false) =>
    send<{ ok: true; turnedOff: AiTaskName[] }>(
      "DELETE",
      `/api/ai/providers/${encodeURIComponent(id)}${force ? "?force=1" : ""}`,
    ),
  /** The author's prices per million tokens; null removes one. */
  savePrices: (prices: Record<string, { promptPrice: number; completionPrice: number } | null>) =>
    send<{ ok: true }>("PUT", "/api/settings/ai/prices", { prices }),
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
  /** A library item file, such as the folder file, as the author sees it. */
  libraryFile: (name: LibraryFileName) =>
    call<{ file: unknown; revision: number; blob: string }>(`/api/library-files/${name}`),
  /** Pages save through the queue (`sync/queue.ts`), which calls this. */
  saveLibraryFile: (
    name: LibraryFileName,
    file: unknown,
    revision: number,
    sent: { baseBlob?: string; op?: string; clashes?: string[] } = {},
  ) =>
    send<{ file: unknown; revision: number; kept?: string }>("PUT", `/api/library-files/${name}`, {
      file,
      revision,
      ...sent,
    }),
  resolveLibraryFile: (name: LibraryFileName, keep: "mine" | "theirs") =>
    post<{ ok: true }>(`/api/library-files/${name}/resolve`, { keep }),
  /** Marks a folder and everything under it for deletion; with `dryRun`, only checks and counts. */
  deleteFolder: (path: string, dryRun = false) =>
    post<{ entries: number; folders: number }>("/api/folders/delete", { path, dryRun }),
  applyType: (path: string) => post<{ made: number }>("/api/folders/apply-type", { path }),

  // ---- Keep going (stage 25) -------------------------------------------------------------

  /** Home's work queue: needs love, wanted, orphans, dead ends and folder stub counts. */
  keepGoingQueue: () => call<QueueResponse>("/api/keep-going/queue"),
  /** This week's numbers and "on this day"; `tz` is minutes east of UTC. */
  keepGoingWeek: (tz = -new Date().getTimezoneOffset()) =>
    call<WeekResponse>(`/api/keep-going/week?tz=${tz}`),
  /** The "From here" strip at the foot of an entry. */
  fromHere: (path: string) =>
    call<FromHereResponse>(`/api/keep-going/from-here?path=${encodeURIComponent(path)}`),
  /** Links the first unlinked mention in `path` to `target`, as an unpublished draft of `path`. */
  linkIt: (path: string, target: string) =>
    post<LinkItResponse>("/api/keep-going/link-it", { path, target }),
  /** Takes a Link it back, with the `undo` its answer carried. */
  undoLinkIt: (undo: LinkItUndo) => post<{ ok: true }>("/api/keep-going/link-it/undo", undo),
  /** A random entry of a kind; `entry` is null when none fits. */
  randomEntry: (query: RandomQuery = {}) => {
    const q = new URLSearchParams();
    if (query.kind) q.set("kind", query.kind);
    if (query.folder) q.set("folder", query.folder);
    if (query.not) q.set("not", query.not);
    const text = q.toString();
    return call<RandomResponse>(`/api/keep-going/random${text ? `?${text}` : ""}`);
  },
  /** Up to three next steps after publishing the entries at `paths`. */
  afterPublish: (paths: string[]) =>
    post<AfterPublishResponse>("/api/keep-going/after-publish", { paths }),
  /** The entries an entry implies and the questions it leaves open (AI; nothing is saved). */
  whatsMissing: (path: string, signal?: AbortSignal) =>
    post<WhatsMissingResponse>("/api/keep-going/whats-missing", { path }, signal),
  /** Today's question if one was made; never makes one (AI). */
  todaysQuestion: (tz = -new Date().getTimezoneOffset()) =>
    call<QuestionResponse>(`/api/keep-going/question?tz=${tz}`),
  /** Makes today's question, or with `another` a different one in its place (AI). */
  makeQuestion: (another = false, signal?: AbortSignal) =>
    post<QuestionResponse>(
      "/api/keep-going/question",
      { another, tz: -new Date().getTimezoneOffset() },
      signal,
    ),
  /** The pinned entries that still exist, in order; kept on the device for reading offline. */
  pins: () => call<PinsResponse>("/api/pins"),
  pin: (path: string) => post<PinsResponse>("/api/pins", { path }),
  unpin: (path: string) =>
    send<PinsResponse>("DELETE", `/api/pins?path=${encodeURIComponent(path)}`),
  reorderPins: (paths: string[]) => send<PinsResponse>("PUT", "/api/pins", { paths }),
  /** Which needs-love rules are on; the rules left out stay as they are. */
  setKeepGoingSettings: (change: KeepGoingSettingsRequest) =>
    send<KeepGoingSettings>("PUT", "/api/settings/keep-going", change),
};

/** A new draft id: 12 lower-case letters and digits, made in the browser. */
export const newDraftId = randomId;

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
  /** The blob of the map's file in the library, or "" when it is not there yet. */
  blob: string;
  entries: Record<string, { path: string; title: string }>;
  children: Record<string, string>;
}

/** The address of a map image at the size maps ask for: 4096, or 2560 on a small or modest device. */
export function mapImageUrl(path: string, size: 2560 | 4096): string {
  return `/api/images?path=${encodeURIComponent(path)}&w=${size}`;
}

export const chronicleUrl = (id: string): string => `/chronicle/${id}`;
export const treeUrl = (id: string): string => `/tree/${id}`;

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

/** A sentence of a draft entry that an entry of the lore contradicts, with that entry's own words. */
export interface EntryDraftConflict {
  /** The paragraph it is in, counting from 0. */
  paragraph: number;
  path: string;
  title: string;
  quote: string;
}
/** A new entry drafted from what the author said. */
export interface EntryProposal {
  title: string;
  /** Where it may go, the best place first. */
  folders: string[];
  paragraphs: string[];
  /** What an entry like this would need, that he did not say. */
  notSaid: string[];
  conflicts: EntryDraftConflict[];
  /** The entry that already has this title, if one does. */
  existing: string | null;
  given: string[];
  links: { title: string; exists: boolean }[];
  model: string;
}
export interface EntryDraftCheck {
  conflicts: EntryDraftConflict[];
  existing: string | null;
  links: { title: string; exists: boolean }[];
}

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
  /** What was done to answer; null on turns from before it was kept. */
  trace?: { steps: LoreStep[]; reasoning: string; ms: number } | null;
}
/** One thing done while a question was answered: "Searched the library for …". */
export interface LoreStep {
  kind: string;
  text: string;
  detail?: string;
  entries?: string[];
}
/** What the server tells while it answers a question, as `POST /api/lore/stream` sends it. */
export type LoreEvent =
  | { type: "run"; run: string; conversation: string }
  | { type: "step"; n: number; step: LoreStep; active: boolean }
  | { type: "reasoning"; text: string }
  | { type: "writing"; chars: number };
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
export type TalkLine =
  { who: "author"; text: string } | ({ who: "character"; kept: boolean } & CharacterLine);
/** A saved conversation with a character (stage 27). */
export interface CharacterTalk {
  id: string;
  entry: string;
  at: string;
  updatedAt: string;
  moment: { words: string; year: number | null };
  lines: TalkLine[];
}
export interface TalkSummary {
  id: string;
  at: string;
  updatedAt: string;
  moment: { words: string; year: number | null };
  title: string;
  lines: number;
  kept: number;
}
export const talkUrl = (path: string): string =>
  "/talk/" + path.split("/").map(encodeURIComponent).join("/");

/** What the map page asks names and descriptions for: a feature to fill in, or a few to place. */
export interface GenerateAsk {
  kind: "marker" | "path" | "zone" | "label";
  at: [number, number];
  count: number;
  prompt: string | null;
  exclude: string | null;
  /** The looks it may take: styles of its kind, or marker icons as "set/name". */
  choices: { id: string; name: string }[];
  chronicle: string | null;
  year: number | null;
}

export interface GeneratedFeature {
  name: string;
  description: string;
  choice: string | null;
  basis: { path: string; quote: string }[];
}

export interface Discovery {
  id: string;
  at: [number, number];
  kind: string;
  name: string;
  description: string;
  basis: { path: string; quote: string }[];
  conflicts: string[];
  art: boolean;
  model: string;
  /** What it is at its place: an inn, a ford. */
  role?: string;
  /** The point of interest it was found at. */
  spot?: { kind: string; title: string };
}
/** A place to explore, as it is sent: what Frontier read from the map about it. */
export interface SpotAsk {
  at: [number, number];
  kind: string;
  title: string;
  lines: string[];
  features: string[];
}
export const discoveryArtUrl = (map: string, id: string): string =>
  `/api/maps/${map}/discoveries/${id}/art`;

export interface PassageComment {
  id: string;
  path: string;
  quote: string;
  prefix: string;
  suffix: string;
  text: string;
  for: "me" | "ai";
  at: string;
}

export type ExportKind = "site" | "docx" | "pdf" | "markdown" | "json" | "slides";

export interface ExportPick {
  title: string;
  folder?: string;
  paths?: string[];
}

/** Makes an export and saves it as a file, under the name the server gives it. */
export async function downloadExport(kind: ExportKind, pick: ExportPick): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/export/${kind}`, {
      method: "POST",
      credentials: "same-origin",
      headers: headers({ headers: { "content-type": "application/json" } }),
      body: JSON.stringify(pick),
    });
  } catch {
    throw unreachable();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorBody | null;
    throw new ApiFailure(
      res.status,
      body?.error.code ?? "unknown",
      body?.error.message ?? `The server answered with status ${res.status}.`,
    );
  }
  const name =
    decodeURIComponent(
      /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "",
    ) || `export.${kind === "site" ? "zip" : kind}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One finding of a consultation, and what the author did with it (stage 24). */
export interface ConsultFinding {
  id: string;
  kind: "contradiction" | "rule" | "dependency" | "clarity" | "gap" | "voice" | "structure";
  severity: "note" | "concern" | "problem";
  /** Checked: a quote was found in another entry. Opinion: taste. Unverified: a claim without one. */
  certainty: "checked" | "opinion" | "unverified";
  anchor: string;
  comment: string;
  suggestion: string;
  sources: { path: string; title: string; quote: string }[];
  state: "open" | "applied" | "dismissed";
  /** Whether a comment was made from it. */
  commented: boolean;
  /** The words an applied suggestion replaced, and the words put in their place. */
  applied: { before: string; after: string } | null;
  asks: { question: string; reply: string; checked: boolean }[];
}

/** A consultation, as the server keeps it. */
export interface ConsultReview {
  id: string;
  path: string;
  at: string;
  /** What was read: the changes, the whole entry, or a selected passage. */
  scope: "edits" | "content" | "passage";
  focus: "edits" | "content";
  summary: string;
  overall: "no_issues" | "minor" | "needs_attention";
  edits: {
    hunk: string;
    verdict: "better" | "neutral" | "worse" | "risky";
    reason: string;
    after: string;
  }[];
  findings: ConsultFinding[];
  given: { path: string; title: string }[];
  changed: number;
  typos: number;
  partial: boolean;
  droppedFindings: number;
  droppedQuotes: number;
}

/** What the author did with a finding; any part may be given. */
export interface ConsultChange {
  state?: ConsultFinding["state"];
  commented?: boolean;
  applied?: { before: string; after: string } | null;
  ask?: { question: string; reply: string; checked: boolean };
}
