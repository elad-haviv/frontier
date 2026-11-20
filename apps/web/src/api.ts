import type {
  AttentionResponse,
  EntryResponse,
  ErrorBody,
  StatusSnapshot,
  TreeResponse,
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
  throw new ApiFailure(
    res.status,
    body?.error.code ?? "unknown",
    body?.error.message ?? `The server answered with status ${res.status}.`,
  );
}

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
};

/** The address of an entry's page. */
export function entryUrl(path: string, heading?: string | null): string {
  const base = "/e/" + path.split("/").map(encodeURIComponent).join("/");
  return heading ? `${base}#${encodeURIComponent(heading)}` : base;
}

/** The address of a vault image, scaled to a width the server offers. */
export function imageUrl(path: string, width?: 320 | 640 | 1280): string {
  return `/api/images?path=${encodeURIComponent(path)}${width ? `&w=${width}` : ""}`;
}
