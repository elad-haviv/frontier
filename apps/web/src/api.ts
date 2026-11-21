import type {
  AttentionResponse,
  DraftKind,
  EntryResponse,
  ErrorBody,
  InboxResponse,
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
  session: () => call<{ loggedIn: boolean }>("/api/session"),
  login: (password: string) => post<{ ok: true }>("/api/login", { password }),
  logout: () => post<{ ok: true }>("/api/logout"),
  tree: () => call<TreeResponse>("/api/tree"),
  entry: (path: string) => call<EntryResponse>(`/api/entries?path=${encodeURIComponent(path)}`),
  status: () => call<StatusSnapshot>("/api/status"),
  attention: () => call<AttentionResponse>("/api/attention"),
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
  inbox: () => call<InboxResponse>("/api/inbox"),
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
  plan: (draftIds: string[], renameIds: string[]) =>
    post<PublishPlan>("/api/publish/plan", { draftIds, renameIds }),
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
