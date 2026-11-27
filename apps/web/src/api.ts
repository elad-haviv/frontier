import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { AI_KEYS_HEADER, type AiProviderKind, CLIENT_API } from "@frontier/schema";
import { keysHeaderValue, recordCheck } from "./aiKeys.ts";
import { currentSlug } from "./project.ts";
import { connection } from "./sync/connection.ts";
import { randomId } from "./sync/db.ts";
import type {
  AfterPublishResponse,
  AttentionResponse,
  CreateRenameResponse,
  DraftKind,
  DraftVersionsResponse,
  EntryResponse,
  ErrorBody,
  FromHereResponse,
  GraphResponse,
  ModelsResponse,
  AiLogResponse,
  AiTaskName,
  PinsResponse,
  QueueResponse,
  QuestionResponse,
  RandomQuery,
  RandomResponse,
  KeyCheckResponse,
  SettingsResponse,
  SessionResponse,
  MeResponse,
  InboxResponse,
  KeepGoingSettings,
  KeepGoingSettingsRequest,
  CreateProjectRequest,
  CreateInviteResponse,
  InvitesResponse,
  JoinedResponse,
  JoinInfo,
  MembersResponse,
  ProjectResponse,
  ProjectRole,
  ProjectsResponse,
  SlugFreeResponse,
  UpdateProjectRequest,
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
  /** Where in the app the problem is put right, such as "/settings/device/ai-keys". */
  href?: string;
  /** With `ai_key_missing`: the provider whose key this device lacks. */
  provider?: AiProviderKind;
  /** With a dead invite link: the name of the person who made it, to ask for a new one. */
  inviter?: string;
  /** With `already_member`: the address of the project the person is already in. */
  project?: string;
}

/**
 * The one place a project's address is made (stage 27b): `/api/p/<slug>` and then the path the
 * server's route has inside a project (`/entries?path=…`). Everything that belongs to a library
 * goes through here, with the open project's address or the one a queued save belongs to. The
 * server's old unprefixed addresses are for builds from before projects and are never made here
 * (`api.projects.test.ts` checks).
 */
export function projectUrl(path: string, slug: string = requireSlug()): string {
  return `/api/p/${encodeURIComponent(slug)}${path}`;
}

/** The open project's address; a call made with no project open is a mistake in the code. */
export function requireSlug(): string {
  const slug = currentSlug();
  if (slug === null) throw new ApiFailure(0, "no_project", "No project is open.");
  return slug;
}

/** An address of a project's call with its `/api/p/<slug>` taken off: `/api/entries?path=…`. */
export function bareUrl(url: string): string {
  return url.replace(/^\/api\/p\/[^/?]+/, "/api");
}

/** This device, as the save queue knows it; sent with every request once known. */
let device: { id: string; name: string } | null = null;

export function setDevice(known: { id: string; name: string } | null): void {
  device = known;
}

/** Routes that answer without a session, whose answers say nothing about the connection's state. */
const OPEN = /^\/api\/(session|login|passkeys\/login\/|join\/)/;

/**
 * The requests that can lead to an AI call (stage 27f). Only these carry this device's AI keys,
 * in a header: the server uses them for that one request and never saves them. Anything that
 * needs no key, which is nearly everything, sends none.
 */
const AI_REQUEST =
  /^\/api\/(lore|write|characters|keep-going\/(?:whats-missing|question)|ai\/models|settings\/ai\/test|proposals\/(fields|job)|maps\/[^/?]+\/(discover|generate|discoveries\/[^/?]+\/art)|comments\/[^/?]+\/work)(?:[/?]|$)/;

export const needsAiKeys = (url: string): boolean => AI_REQUEST.test(bareUrl(url));

/**
 * Every request's headers: the shape of writes this build sends, and, once known, the device and
 * its name URI-encoded, since a header holds only ASCII. A request that can lead to an AI call
 * also carries this device's keys, unless it names the keys itself (a test of one key).
 */
function headers(init: RequestInit | undefined, url: string): Record<string, string> {
  const given = init?.headers as Record<string, string> | undefined;
  const keys = given?.[AI_KEYS_HEADER] === undefined && needsAiKeys(url) ? keysHeaderValue() : null;
  return {
    ...given,
    "frontier-api": String(CLIENT_API),
    ...(device
      ? { "frontier-device": device.id, "frontier-device-name": encodeURIComponent(device.name) }
      : {}),
    ...(keys ? { [AI_KEYS_HEADER]: keys } : {}),
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

/** Which feature a request is for, in the words of "<Feature> runs on your own AI key". */
export function featureOf(address: string): string {
  const url = bareUrl(address);
  if (/^\/api\/keep-going\/question/.test(url)) return "The question of the day";
  if (/^\/api\/keep-going\/whats-missing/.test(url)) return "What's missing here";
  if (/^\/api\/lore\/draft/.test(url)) return "Drafting an entry";
  if (/^\/api\/lore\/[^/]+\/turns/.test(url)) return "Adding to an entry";
  if (/^\/api\/lore/.test(url)) return "Ask";
  if (/^\/api\/write/.test(url)) return "Writing help";
  if (/^\/api\/characters/.test(url)) return "Talking with a character";
  if (/\/art$/.test(url)) return "Concept art";
  if (/^\/api\/maps\//.test(url)) return "Exploring the map";
  if (/^\/api\/comments\//.test(url)) return "Work on it";
  if (/^\/api\/proposals/.test(url)) return "Proposing fields";
  if (/^\/api\/settings\/ai\/test/.test(url)) return "Trying a model";
  return "AI help";
}

/** What the app shows when a request needs a key this device lacks, or one the provider refused. */
export interface KeyAsk {
  feature: string;
  /** The provider the request needs, to have it chosen already. */
  provider: AiProviderKind | null;
  /** The key this device holds for that provider was turned away: it needs a new one. */
  rejected?: boolean;
}

let askForKey: ((ask: KeyAsk) => Promise<boolean>) | null = null;

/**
 * Registers what shows the explanation and the field for a key (`AiKeyPrompt`). It resolves true
 * once the key the request needs was kept (for the provider it names, when it names one), and the
 * request is then sent again, as if nothing happened.
 */
export function setKeyPrompt(prompt: ((ask: KeyAsk) => Promise<boolean>) | null): void {
  askForKey = prompt;
}

/**
 * Notes that a provider turned a key away, so the AI keys section and the rail stop saying it
 * works. A key that is not on this device any more is left alone.
 */
function noteRejected(err: unknown): void {
  if (!(err instanceof ApiFailure) || err.code !== "ai_key_rejected" || !err.provider) return;
  recordCheck(err.provider, { at: new Date().toISOString(), ok: false, message: err.message });
}

/** Whether a key was added after `err` said there was none or a bad one, so the request may go again. */
async function keyWasAdded(err: unknown, url: string): Promise<boolean> {
  if (!(err instanceof ApiFailure) || !askForKey) return false;
  if (err.code !== "ai_key_missing" && err.code !== "ai_key_rejected") return false;
  return askForKey({
    feature: featureOf(url),
    provider: err.provider ?? null,
    ...(err.code === "ai_key_rejected" ? { rejected: true } : {}),
  });
}

async function baseCall<T>(url: string, init?: RequestInit, quiet = false): Promise<T> {
  try {
    return await callOnce<T>(url, init);
  } catch (err) {
    noteRejected(err);
    if (!quiet && (await keyWasAdded(err, url))) {
      // Once: a second refusal is the person's to read.
      return callOnce<T>(url, init).catch((again: unknown) => {
        noteRejected(again);
        throw again;
      });
    }
    throw err;
  }
}

async function callOnce<T>(url: string, init?: RequestInit): Promise<T> {
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
    res = await fetch(url, { credentials: "same-origin", ...init, headers: headers(init, url) });
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
  if (body?.error.provider) failure.provider = body.error.provider as AiProviderKind;
  if (body?.error.inviter) failure.inviter = body.error.inviter;
  // A refusal for want of a role or a project: what the person may do here may have changed.
  if (res.status === 403 && (failure.code === "role_too_low" || failure.code === "no_project")) {
    connection.accessMayHaveChanged();
  }
  if (body?.error.project) failure.project = body.error.project;
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
async function baseStreamed<T>(
  url: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await streamedOnce<T>(url, body, onEvent, signal);
  } catch (err) {
    noteRejected(err);
    // A refusal for want of a key, or a key the provider turned away, comes before any event, so
    // asking again repeats nothing.
    if (await keyWasAdded(err, url)) {
      return streamedOnce<T>(url, body, onEvent, signal).catch((again: unknown) => {
        noteRejected(again);
        throw again;
      });
    }
    throw err;
  }
}

async function streamedOnce<T>(
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
      headers: headers({ headers: { "content-type": "application/json" } }, url),
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
    const refused = new ApiFailure(
      res.status,
      error?.code ?? "unknown",
      error?.message ?? `The server answered with status ${res.status}.`,
    );
    if (error?.href) refused.href = error.href;
    if (error?.provider) refused.provider = error.provider as AiProviderKind;
    throw refused;
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
          const said = data as {
            code?: string;
            message?: string;
            provider?: string;
            href?: string;
          };
          const failure = new ApiFailure(
            200,
            said.code ?? "unknown",
            said.message ?? "The answer could not be made.",
          );
          if (said.href) failure.href = said.href;
          if (said.provider) failure.provider = said.provider as AiProviderKind;
          throw failure;
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

const baseSend = <T>(method: string, url: string, body?: unknown) =>
  baseCall<T>(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

const basePost = <T>(url: string, body?: unknown, signal?: AbortSignal) =>
  baseCall<T>(url, {
    method: "POST",
    ...(signal ? { signal } : {}),
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

const serverApi = {
  session: () => baseCall<SessionResponse>("/api/session"),
  /** The person logged in, with the ways their account signs in. */
  me: () => baseCall<MeResponse>("/api/me"),
  saveProfile: (profile: { name: string; email: string }) =>
    baseSend<MeResponse>("PUT", "/api/me", profile),
  /** `current` is needed when the account already has a password. */
  setPassword: (password: string, current?: string) =>
    baseSend<{ ok: true }>("PUT", "/api/me/password", {
      password,
      ...(current ? { current } : {}),
    }),
  /** Registers a passkey on this device, under a name the author gives it. */
  addPasskey: async (name: string) => {
    const optionsJSON = await basePost<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
      "/api/passkeys/register/options",
    );
    const response = await startRegistration({ optionsJSON });
    return basePost<{ ok: true }>("/api/passkeys/register/verify", { name, response });
  },
  loginWithPasskey: async () => {
    const optionsJSON = await basePost<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
      "/api/passkeys/login/options",
    );
    const response = await startAuthentication({ optionsJSON });
    return basePost<{ ok: true }>("/api/passkeys/login/verify", { response });
  },
  /** Takes the linked Google account off the account (the last way in cannot go). */
  unlinkGoogle: () => baseSend<{ ok: true }>("DELETE", "/api/me/google"),
  // ---- Joining a project by an invite link (stage 27c): public, no project is open -----------

  /** What an invite link is for, or why it no longer works (the error carries `inviter`). */
  joinInfo: (code: string) => baseCall<JoinInfo>(`/api/join/${encodeURIComponent(code)}`),
  /** A new person joins with an email and a password, and is logged in. */
  joinWithPassword: (code: string, who: { name: string; email: string; password: string }) =>
    basePost<JoinedResponse>(`/api/join/${encodeURIComponent(code)}`, who),
  /** A new person joins with a passkey made on this device, and is logged in. */
  joinWithPasskey: async (code: string, who: { name: string; email: string }) => {
    const base = `/api/join/${encodeURIComponent(code)}/passkey`;
    const optionsJSON = await basePost<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
      `${base}/options`,
      who,
    );
    const response = await startRegistration({ optionsJSON });
    return basePost<JoinedResponse>(`${base}/verify`, { response, passkeyName: "This device" });
  },
  /** A person who is logged in takes the invitation into their own account. */
  acceptInvite: (code: string) =>
    basePost<JoinedResponse>(`/api/join/${encodeURIComponent(code)}/accept`),
  removePasskey: (id: string) =>
    baseSend<{ ok: true }>("DELETE", `/api/passkeys/${encodeURIComponent(id)}`),
  passwordOff: (off: boolean) =>
    baseSend<{ ok: true }>("PUT", "/api/settings/password-off", { off }),
  login: (email: string, password: string) =>
    basePost<{ ok: true }>("/api/login", { email, password }),
  logout: () => basePost<{ ok: true }>("/api/logout"),
  settings: () => baseCall<SettingsResponse>("/api/settings"),
  saveAi: (body: {
    models?: { extraction?: string | null; conversation?: string | null; art?: string | null };
    artStyle?: string;
    proposeOnPublish?: boolean;
  }) => baseSend<{ ok: true }>("PUT", "/api/settings/ai", body),
  testAi: (body: { task?: AiTaskName; model?: string } = {}) =>
    basePost<{ ok: boolean; costUsd: number; message: string; image?: string }>(
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
    return baseCall<ModelsResponse>(`/api/ai/models${qs ? `?${qs}` : ""}`);
  },
  aiLog: (month?: string) =>
    baseCall<AiLogResponse>(`/api/ai/log${month ? `?month=${encodeURIComponent(month)}` : ""}`),
  /**
   * A real check of a key through the server: the key travels in this one request, which lists the
   * provider's models with it. Nothing is kept on the server.
   */
  checkKey: (kind: AiProviderKind, key: string) =>
    // Never `call`: a check that finds no key must not open the key dialog, which is where it is
    // asked from.
    callOnce<KeyCheckResponse>(`/api/ai/keys/${kind}/check`, {
      method: "POST",
      headers: { [AI_KEYS_HEADER]: keysHeaderValue({ [kind]: key }) ?? "" },
    }),
  /** Says the notice about keys deleted from the server was seen. */
  keysNoticeSeen: () => baseSend<{ ok: true }>("DELETE", "/api/notices/keys-removed"),
  // ---- Projects (stage 27b): the server's own, not a project's --------------------------

  /** The projects the person is in, and whether they may make one. */
  projects: () => baseCall<ProjectsResponse>("/api/projects"),
  createProject: (body: CreateProjectRequest) => basePost<ProjectResponse>("/api/projects", body),
  /** Whether an address can be taken; the reason in words when it cannot. */
  slugFree: (slug: string, signal?: AbortSignal) =>
    baseCall<SlugFreeResponse>(`/api/projects/slug-free?slug=${encodeURIComponent(slug)}`, {
      ...(signal ? { signal } : {}),
    }),
  /** Remembers the project the person opened, so the next login opens it. */
  setLastProject: (slug: string) => baseSend<{ ok: true }>("PUT", "/api/projects/last", { slug }),
  /** The author's prices per million tokens; null removes one. */
  savePrices: (prices: Record<string, { promptPrice: number; completionPrice: number } | null>) =>
    baseSend<{ ok: true }>("PUT", "/api/settings/ai/prices", { prices }),
  /** Which needs-love rules are on; the rules left out stay as they are. */
  setKeepGoingSettings: (change: KeepGoingSettingsRequest) =>
    baseSend<KeepGoingSettings>("PUT", "/api/settings/keep-going", change),
};

/**
 * Where "Continue with Google" goes: the server sends the browser to Google and, after, back to a
 * page of the app. With an invite code the trip is for joining; `link` adds Google to the account
 * that is logged in (Settings → Signing in). `returnTo` is a path in the app.
 */
export function googleStartUrl(
  options: { invite?: string; link?: boolean; returnTo?: string } = {},
): string {
  const params = new URLSearchParams();
  if (options.invite) params.set("invite", options.invite);
  if (options.link) params.set("link", "1");
  if (options.returnTo) params.set("returnTo", options.returnTo);
  const qs = params.toString();
  return `/api/auth/google/start${qs ? `?${qs}` : ""}`;
}

/** The calls that belong to one project: each goes to `/api/p/<slug>/...` (`projectUrl`). */
function projectCalls(slugOf: () => string) {
  const url = (path: string) => projectUrl(path, slugOf());
  const call = async <T>(path: string, init?: RequestInit, quiet = false) =>
    baseCall<T>(url(path), init, quiet);
  const send = async <T>(method: string, path: string, body?: unknown) =>
    baseSend<T>(method, url(path), body);
  const post = async <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    basePost<T>(url(path), body, signal);
  const streamed = async <T>(
    path: string,
    body: unknown,
    onEvent: (event: string, data: unknown) => void,
    signal?: AbortSignal,
  ) => baseStreamed<T>(url(path), body, onEvent, signal);
  return {
    /** The project's own record; `movedFrom` says the address used was an old one. */
    project: () => call<ProjectResponse>("/project"),
    updateProject: (change: UpdateProjectRequest) =>
      send<ProjectResponse>("PUT", "/project", change),
    /** The name is typed again, so a stray press cannot delete a project. */
    deleteProject: (name: string) => send<{ ok: true }>("DELETE", "/project", { name }),
    // ---- People (stage 27c) ----------------------------------------------------------------
    members: () => call<MembersResponse>("/members"),
    changeRole: (id: string, role: ProjectRole) =>
      send<{ ok: true }>("PUT", `/members/${encodeURIComponent(id)}`, { role }),
    removeMember: (id: string) =>
      send<{ ok: true }>("DELETE", `/members/${encodeURIComponent(id)}`),
    leaveProject: () => post<{ ok: true }>("/members/leave"),
    invites: () => call<InvitesResponse>("/invites"),
    createInvite: (role: ProjectRole) => post<CreateInviteResponse>("/invites", { role }),
    cancelInvite: (id: string) =>
      send<{ ok: true }>("DELETE", `/invites/${encodeURIComponent(id)}`),
    tree: () => call<TreeResponse>("/tree"),
    /** Every entry and every link between two entries, with the top-level folders' colours. */
    graph: () => call<GraphResponse>("/graph"),
    entry: (path: string) => call<EntryResponse>(`/entries?path=${encodeURIComponent(path)}`),
    status: () => call<StatusSnapshot>("/status"),
    attention: () => call<AttentionResponse>("/attention"),
    schema: () => call<SchemaResponse>("/schema"),
    names: (query = "") =>
      call<{
        results: {
          path: string;
          title: string;
          alias?: string;
          shared?: boolean;
          words?: number;
        }[];
      }>(`/switcher${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    search: (query: string) =>
      call<{ results: { path: string; title: string; snippet: string; words?: number }[] }>(
        `/search?q=${encodeURIComponent(query)}`,
      ),
    preview: (path: string) =>
      call<{ path: string; text: string }>(`/preview?path=${encodeURIComponent(path)}`),
    /** The image an embed in the note `from` points at, or null when there is none. */
    findImage: (name: string, from: string) =>
      call<{ path: string | null }>(
        `/images/find?name=${encodeURIComponent(name)}&from=${encodeURIComponent(from)}`,
      ),
    upload: async (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return call<{ path: string; embed: string }>("/images", { method: "POST", body: form });
    },
    /** Has the server take an image from a web address; it is kept as an upload. */
    imageFromUrl: (url: string) =>
      post<{ path: string; embed: string }>("/images/from-url", { url }),
    rename: (from: string, to: string) => post<CreateRenameResponse>("/renames", { from, to }),

    /** Pages save through the queue (`sync/queue.ts`), which calls this. */
    saveDraft: (draft: {
      id: string;
      path: string;
      kind: DraftKind;
      text: string;
      revision: number;
      baseBlob?: string;
      op?: string;
    }) => send<{ id: string; revision: number }>("PUT", "/drafts", draft),
    discardDraft: (id: string) => send<{ ok: true }>("DELETE", `/drafts/${id}`),
    versions: (id: string) => call<DraftVersionsResponse>(`/drafts/${id}/versions`),
    /** Dismisses the other side of an item clash kept beside a draft (stage 15c). */
    dismissKept: (id: string) => send<{ ok: true }>("DELETE", `/drafts/${id}/versions/server`),
    mergeVersions: (id: string, text: string) =>
      post<{ id: string; revision: number }>(`/drafts/${id}/merge-versions`, { text }),
    resolve: (id: string, text: string) =>
      post<{ id: string; revision: number }>(`/drafts/${id}/resolve`, { text }),
    unpublished: () => call<UnpublishedResponse>("/unpublished"),
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
      }>("/maps"),
    map: (id: string) => call<LoadedMap>(`/maps/${id}`),
    createMap: (title: string, kind: "sphere" | "flat" | "stars" | "system", image?: string) =>
      post<{ id: string }>("/maps", { title, kind, ...(image ? { image } : {}) }),
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
      }>("PUT", `/maps/${id}`, { map, revision, link, ...sent }),
    resolveMap: (id: string, keep: "mine" | "theirs") =>
      post<{ ok: true }>(`/maps/${id}/resolve`, { keep }),
    deleteMap: (id: string) => send<{ ok: true }>("DELETE", `/maps/${id}`),
    markerSets: () =>
      call<{ sets: { name: string; icons: { name: string; path: string }[] }[] }>("/marker-sets"),
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
      }>("/chronicles"),
    chronicle: (id: string) =>
      call<{
        chronicle: ChronicleFile;
        revision: number;
        state: string;
        blob: string;
        entries: Record<string, { path: string; title: string }>;
        /** Which spans something on a map follows (stage 17); absent from an older server. */
        onMaps?: Record<string, { map: string; title: string; features: number }[]>;
      }>(`/chronicles/${id}`),
    createChronicle: (title: string) => post<{ id: string }>("/chronicles", { title }),
    copyChronicle: (copyOf: string) => post<{ id: string }>("/chronicles", { copyOf }),
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
      }>("PUT", `/chronicles/${id}`, { chronicle, revision, link, ...sent }),
    makeMainChronicle: (id: string) => post<{ ok: true }>(`/chronicles/${id}/main`, {}),
    resolveChronicle: (id: string, keep: "mine" | "theirs") =>
      post<{ ok: true }>(`/chronicles/${id}/resolve`, { keep }),
    deleteChronicle: (id: string) => send<{ ok: true }>("DELETE", `/chronicles/${id}`),
    gallery: () =>
      call<{
        images: GalleryImage[];
      }>("/gallery"),
    history: (path?: string) =>
      call<{ versions: Version[] }>(`/history${path ? `?path=${encodeURIComponent(path)}` : ""}`),
    versionText: (path: string, commit: string) =>
      call<{ text: string; before: string | null }>(
        `/history/version?path=${encodeURIComponent(path)}&commit=${commit}`,
      ),
    importFiles: async (files: File[], folder: string, existing: "ask" | "replace" | "both") => {
      const form = new FormData();
      // Fields first: the server reads the folder before the first file.
      form.append("folder", folder);
      form.append("existing", existing);
      for (const file of files) form.append("files", file, file.name);
      return call<ImportResult>("/import", { method: "POST", body: form });
    },
    importVault: async (zip: File, message: string) => {
      const form = new FormData();
      form.append("message", message);
      form.append("files", zip, zip.name);
      return call<{ files: number; commit: string }>("/import/vault", {
        method: "POST",
        body: form,
      });
    },
    inbox: () => call<InboxResponse>("/inbox"),
    /** `quiet`: for proposals made by themselves, which never open the key dialog. */
    proposeFields: (path: string, quiet = false) =>
      call<{ made: number }>(
        "/proposals/fields",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path }),
        },
        quiet,
      ),
    decideOperation: (
      id: string,
      op: string,
      body: {
        decision: "accept" | "reject" | "dismiss";
        what?: string;
        when?: string;
        type?: string;
      },
    ) => post<{ draftId?: string }>(`/proposals/${id}/operations/${op}`, body),
    conversations: () =>
      call<{
        conversations: { id: string; title: string; at: string; turns: number }[];
        ready: boolean;
      }>("/lore"),
    conversation: (id: string) =>
      call<{ conversation: LoreConversation; gone: string[] }>(`/lore/${id}`),
    ask: (question: string, conversation?: string) =>
      post<{ conversation: LoreConversation; gone: string[] }>("/lore", {
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
        "/lore/stream",
        { question, ...(conversation ? { conversation } : {}) },
        (type, data) => onEvent({ ...(data as object), type } as LoreEvent),
        signal,
      ),
    stopAsking: (run: string) => post<{ ok: true }>(`/lore/runs/${run}/stop`),
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
    ) => post<{ text: string }>("/write/rewrite", body, signal),
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
    ) => post<ConsultReview>("/write/review", body, signal),
    /** The saved consultations of an entry, newest first. */
    consultReviews: (path: string) =>
      call<{ reviews: ConsultReview[] }>(`/write/reviews?path=${encodeURIComponent(path)}`),
    /** Keeps what the author did with a finding. */
    consultChange: (id: string, finding: string, change: ConsultChange) =>
      send<{ review: ConsultReview }>("PATCH", `/write/reviews/${id}/findings/${finding}`, change),
    consultDelete: (id: string) => send<{ ok: true }>("DELETE", `/write/reviews/${id}`),
    consultClear: (path: string) =>
      send<{ ok: true }>("DELETE", `/write/reviews?path=${encodeURIComponent(path)}`),
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
        "/write/review/ask",
        body,
        signal,
      ),
    /** A new entry drafted from what the author said; nothing is saved. `signal` stops it. */
    draftEntry: (said: string, signal?: AbortSignal) =>
      post<{ draft: EntryProposal }>("/lore/draft", { said }, signal),
    /** One changed paragraph of a draft entry, checked against the lore again. */
    checkEntryDraft: (
      body: { title: string; paragraphs: string[]; changed: number },
      signal?: AbortSignal,
    ) => post<EntryDraftCheck>("/lore/draft/check", body, signal),
    /** Keeps a draft entry as an unsaved change: a new entry that waits to be published. */
    keepEntryDraft: (body: {
      title: string;
      folder: string;
      paragraphs: string[];
      againstLore: { paragraph: number; path: string }[];
    }) => post<{ draft: string; path: string }>("/lore/draft/keep", body),
    comments: (path: string) =>
      call<{ comments: PassageComment[] }>(`/comments?path=${encodeURIComponent(path)}`),
    commentCount: (path: string) =>
      call<{ open: number }>(`/comments/count?path=${encodeURIComponent(path)}`),
    addComment: (body: Omit<PassageComment, "id" | "at">) =>
      post<{ comment: PassageComment }>("/comments", body),
    changeComment: (id: string, change: { text?: string; for?: "me" | "ai" }) =>
      send<{ comment: PassageComment }>("PATCH", `/comments/${id}`, change),
    removeComment: (id: string) => send<{ ok: true }>("DELETE", `/comments/${id}`),
    workOnComment: (
      id: string,
      around: { before: string; after: string; previous?: string[] },
      signal?: AbortSignal,
    ) => post<{ text: string }>(`/comments/${id}/work`, around, signal),
    characterProfile: (path: string) =>
      call<{ profile: CharacterProfile | null }>(
        `/characters/profile?path=${encodeURIComponent(path)}`,
      ),
    proposeProfile: (path: string) =>
      post<{ name: string; traits: (Trait & { supported: boolean })[] }>("/characters/propose", {
        path,
      }),
    approveProfile: (
      path: string,
      traits: Trait[],
      moment: { words: string; year: number | null },
    ) =>
      post<{ profile: CharacterProfile; draft: string }>("/characters/approve", {
        path,
        traits,
        moment,
      }),
    say: (
      path: string,
      message: string,
      history: { who: "author" | "character"; text: string }[],
    ) => post<{ lines: CharacterLine[] }>("/characters/say", { path, message, history }),
    keepLine: (path: string, text: string) =>
      post<{ draft: string | null }>("/characters/line", { path, text }),
    discoveries: (map: string) =>
      call<{ discoveries: Discovery[]; ready: boolean; art: boolean; folders: string[] }>(
        `/maps/${map}/discoveries`,
      ),
    /** Asks what is found at up to six places, in one AI call. */
    discover: (map: string, spots: SpotAsk[], chronicle: string | null, year: number | null) =>
      post<{ discoveries: Discovery[] }>(`/maps/${map}/discover`, { spots, chronicle, year }),
    /** What asking about places would cost; nothing is sent to the AI. */
    estimateDiscovery: (
      map: string,
      spots: SpotAsk[],
      chronicle: string | null,
      year: number | null,
    ) =>
      post<{ calls: number; usd: number | null }>(`/maps/${map}/discover/estimate`, {
        spots,
        chronicle,
        year,
      }),
    generateFeatures: (map: string, ask: GenerateAsk) =>
      post<{ items: GeneratedFeature[] }>(`/maps/${map}/generate`, ask),
    discoveryArt: (map: string, id: string) =>
      post<{ discovery: Discovery }>(`/maps/${map}/discoveries/${id}/art`, {}),
    keepDiscovery: (map: string, id: string, folder: string) =>
      post<{ path: string }>(`/maps/${map}/discoveries/${id}/keep`, { folder }),
    dropDiscovery: (map: string, id: string) =>
      send<{ ok: true }>("DELETE", `/maps/${map}/discoveries/${id}`),
    exportFolders: () => call<{ folders: string[] }>("/export/folders"),
    exportPreview: (pick: ExportPick) =>
      post<{ entries: { path: string; title: string }[]; unsaved: string[]; skipped: string[] }>(
        "/export/preview",
        pick,
      ),
    deleteConversation: (id: string) => send<{ ok: true }>("DELETE", `/lore/${id}`),
    draftAddition: (id: string, turn: number, again = false) =>
      post<{ addition: LoreAddition; conversation: LoreConversation }>(
        `/lore/${id}/turns/${turn}/addition`,
        { again },
      ),
    previewAddition: (id: string, turn: number, path: string) =>
      post<{ path: string; isNew: boolean; before: string; after: string; base: string }>(
        `/lore/${id}/turns/${turn}/addition/preview`,
        { path },
      ),
    keepAddition: (id: string, turn: number, path: string, base: string) =>
      post<{ draft: string | null; conversation: LoreConversation }>(
        `/lore/${id}/turns/${turn}/addition/keep`,
        { path, base },
      ),
    /** The entries a run over a folder would read, and what it would cost; nothing is read yet. */
    listJob: (folder: string) =>
      post<{ paths: string[]; entries: number; estimateUsd: number | null }>("/proposals/job", {
        folder,
      }),
    branchFile: (branch: string, path: string) =>
      call<{ before: string | null; after: string | null }>(
        `/inbox/branch-file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`,
      ),
    decideFile: (branch: string, path: string, blob: string, decision: "accept" | "reject") =>
      post<{ draftId?: string; branchRemoved: boolean }>("/inbox/branch-file", {
        branch,
        path,
        blob,
        decision,
      }),
    decideBranch: (branch: string, tip: string, decision: "reject" | "remove") =>
      post<{ branchRemoved: boolean }>("/inbox/branch", { branch, tip, decision }),
    plan: (draftIds: string[], renameIds: string[], decisionIds: string[] = []) =>
      post<PublishPlan>("/publish/plan", { draftIds, renameIds, decisionIds }),
    decideQuarantine: (path: string, commit: string, decision: "accept" | "revert") =>
      post<{ id: string; draftId?: string }>("/quarantine", { path, commit, decision }),
    withdrawDecision: (id: string) => send<{ ok: true }>("DELETE", `/quarantine/${id}`),
    confirm: (planId: string, confirmedMergeIds: string[], message: string) =>
      post<{ commit: string; published: string[] }>("/publish/confirm", {
        planId,
        confirmedMergeIds,
        message,
      }),
    cancelRename: (id: string) => send<{ ok: true }>("DELETE", `/renames/${id}`),
    /** A library item file, such as the folder file, as the author sees it. */
    libraryFile: (name: LibraryFileName) =>
      call<{ file: unknown; revision: number; blob: string }>(`/library-files/${name}`),
    /** Pages save through the queue (`sync/queue.ts`), which calls this. */
    saveLibraryFile: (
      name: LibraryFileName,
      file: unknown,
      revision: number,
      sent: { baseBlob?: string; op?: string; clashes?: string[] } = {},
    ) =>
      send<{ file: unknown; revision: number; kept?: string }>("PUT", `/library-files/${name}`, {
        file,
        revision,
        ...sent,
      }),
    resolveLibraryFile: (name: LibraryFileName, keep: "mine" | "theirs") =>
      post<{ ok: true }>(`/library-files/${name}/resolve`, { keep }),
    /** Marks a folder and everything under it for deletion; with `dryRun`, only checks and counts. */
    deleteFolder: (path: string, dryRun = false) =>
      post<{ entries: number; folders: number }>("/folders/delete", { path, dryRun }),
    applyType: (path: string) => post<{ made: number }>("/folders/apply-type", { path }),

    // ---- Keep going (stage 25) -------------------------------------------------------------

    /** Home's work queue: needs love, wanted, orphans, dead ends and folder stub counts. */
    keepGoingQueue: () => call<QueueResponse>("/keep-going/queue"),
    /** This week's numbers and "on this day"; `tz` is minutes east of UTC. */
    keepGoingWeek: (tz = -new Date().getTimezoneOffset()) =>
      call<WeekResponse>(`/keep-going/week?tz=${tz}`),
    /** The "From here" strip at the foot of an entry. */
    fromHere: (path: string) =>
      call<FromHereResponse>(`/keep-going/from-here?path=${encodeURIComponent(path)}`),
    /** Links the first unlinked mention in `path` to `target`, as an unpublished draft of `path`. */
    linkIt: (path: string, target: string) =>
      post<LinkItResponse>("/keep-going/link-it", { path, target }),
    /** Takes a Link it back, with the `undo` its answer carried. */
    undoLinkIt: (undo: LinkItUndo) => post<{ ok: true }>("/keep-going/link-it/undo", undo),
    /** A random entry of a kind; `entry` is null when none fits. */
    randomEntry: (query: RandomQuery = {}) => {
      const q = new URLSearchParams();
      if (query.kind) q.set("kind", query.kind);
      if (query.folder) q.set("folder", query.folder);
      if (query.not) q.set("not", query.not);
      const text = q.toString();
      return call<RandomResponse>(`/keep-going/random${text ? `?${text}` : ""}`);
    },
    /** Up to three next steps after publishing the entries at `paths`. */
    afterPublish: (paths: string[]) =>
      post<AfterPublishResponse>("/keep-going/after-publish", { paths }),
    /** The entries an entry implies and the questions it leaves open (AI; nothing is saved). */
    whatsMissing: (path: string, signal?: AbortSignal) =>
      post<WhatsMissingResponse>("/keep-going/whats-missing", { path }, signal),
    /** Today's question if one was made; never makes one (AI). */
    todaysQuestion: (tz = -new Date().getTimezoneOffset()) =>
      call<QuestionResponse>(`/keep-going/question?tz=${tz}`),
    /** Makes today's question, or with `another` a different one in its place (AI). */
    makeQuestion: (another = false, signal?: AbortSignal) =>
      post<QuestionResponse>(
        "/keep-going/question",
        { another, tz: -new Date().getTimezoneOffset() },
        signal,
      ),
    /** The pinned entries that still exist, in order; kept on the device for reading offline. */
    pins: () => call<PinsResponse>("/pins"),
    pin: (path: string) => post<PinsResponse>("/pins", { path }),
    unpin: (path: string) => send<PinsResponse>("DELETE", `/pins?path=${encodeURIComponent(path)}`),
    reorderPins: (paths: string[]) => send<PinsResponse>("PUT", "/pins", { paths }),
  };
}

/** Everything the app asks of the server: the server's own calls, and the open project's. */
export const api = { ...serverApi, ...projectCalls(requireSlug) };

/** The project calls for one project, whichever is open: for work that belongs to it (a queued save). */
export const apiFor = (slug: string) => projectCalls(() => slug);

/**
 * Brings a vault zip into a project, telling how much has gone up (`fetch` cannot tell). The
 * project is named, not the open one: a new project is filled before the app moves into it.
 */
export function uploadVault(
  slug: string,
  zip: File,
  message: string,
  onProgress: (sent: number, total: number) => void,
): Promise<{ files: number; commit: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("message", message);
    form.append("files", zip, zip.name);
    const request = new XMLHttpRequest();
    const address = projectUrl("/import/vault", slug);
    request.open("POST", address);
    request.withCredentials = true;
    for (const [name, value] of Object.entries(headers(undefined, address))) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    request.onerror = () => {
      connection.unreachable();
      reject(unreachable());
    };
    request.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        /* not JSON: a gateway's page */
      }
      if (request.status >= 200 && request.status < 300 && body) {
        resolve(body as { files: number; commit: string });
      } else if (GATEWAY.has(request.status) && !isErrorBody(body)) {
        reject(unreachable());
      } else {
        const error = isErrorBody(body) ? body.error : null;
        reject(
          new ApiFailure(
            request.status,
            error?.code ?? "unknown",
            error?.message ?? `The server answered with status ${request.status}.`,
          ),
        );
      }
    };
    request.send(form);
  });
}

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
export function imageUrl(path: string, width?: 320 | 640 | 1280, slug?: string): string {
  return projectUrl(`/images?path=${encodeURIComponent(path)}${width ? `&w=${width}` : ""}`, slug);
}

/** The address of a new image on an agent's branch, for the inbox. */
export function branchImageUrl(branch: string, path: string): string {
  return projectUrl(
    `/images?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&w=640`,
  );
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
export function mapImageUrl(path: string, size: 2560 | 4096, slug?: string): string {
  return projectUrl(`/images?path=${encodeURIComponent(path)}&w=${size}`, slug);
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
  projectUrl(`/maps/${map}/discoveries/${id}/art`);

/** The whole library as a zip of the vault. */
export const libraryZipUrl = (): string => projectUrl("/export/library.zip");

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
  const address = projectUrl(`/export/${kind}`);
  try {
    res = await fetch(address, {
      method: "POST",
      credentials: "same-origin",
      headers: headers({ headers: { "content-type": "application/json" } }, address),
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
