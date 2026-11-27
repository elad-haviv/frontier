import type { FastifyRequest } from "fastify";

/**
 * The requests a person has open in a project, so that removing them (or changing their role)
 * cuts them off. The guard checks membership when a request starts; a stream that stays open for
 * hours, such as the status events, would otherwise go on being served to someone who was
 * removed after it began.
 */
export class LiveRequests {
  private readonly open = new Map<string, Set<FastifyRequest>>();

  private key = (projectId: string, personId: string) => `${projectId}:${personId}`;

  /** Remembers a request until it ends. */
  track(request: FastifyRequest, projectId: string, personId: string): void {
    const key = this.key(projectId, personId);
    let set = this.open.get(key);
    if (!set) this.open.set(key, (set = new Set()));
    set.add(request);
    request.raw.once("close", () => {
      set.delete(request);
      if (set.size === 0 && this.open.get(key) === set) this.open.delete(key);
    });
  }

  /** Ends every request the person has open in the project, by closing its connection. */
  cut(projectId: string, personId: string): number {
    const set = this.open.get(this.key(projectId, personId));
    if (!set) return 0;
    const requests = [...set];
    for (const r of requests) r.raw.destroy();
    return requests.length;
  }
}
