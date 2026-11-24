/**
 * The page's side of the Find areas worker. One worker for the session, started the first time
 * the tool is used, so the pictures it has looked at are kept while the app is open.
 */
import type { AreaRings, FoundAreas, Opened, Outlined, Reply, Request } from "./protocol.ts";

let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const call = waiting.get(e.data.id);
    if (!call) return;
    waiting.delete(e.data.id);
    if (e.data.ok) call.resolve(e.data.value);
    else call.reject(new Error(e.data.error));
  };
  worker.onerror = () => {
    for (const call of waiting.values())
      call.reject(new Error("The picture could not be looked at."));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function ask<T>(req: Request): Promise<T> {
  const w = start();
  const id = next++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, ...req });
  });
}

export const openPicture = (req: Extract<Request, { type: "open" }>) => ask<Opened>(req);
export const findAreasIn = (req: Extract<Request, { type: "areas" }>) => ask<FoundAreas>(req);
export const areaOutline = (req: Extract<Request, { type: "area" }>) => ask<AreaRings>(req);
export const outlineAreas = (req: Extract<Request, { type: "outline" }>) => ask<Outlined>(req);
