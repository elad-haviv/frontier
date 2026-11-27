import type { FastifyReply, FastifyRequest } from "fastify";
import { isThisRequest } from "../ai/keyring.js";

/**
 * The requests a person has open in a project, so that removing them (or changing their role)
 * cuts them off. The guard checks membership when a request starts; a stream that stays open for
 * hours, such as the status events, would otherwise go on being served to someone who was
 * removed after it began.
 */
export class LiveRequests {
  private readonly open = new Map<string, Set<FastifyRequest>>();

  private key = (projectId: string, personId: string) => `${projectId}:${personId}`;

  /**
   * Remembers a request until its reply is over (or its connection drops). Not until the request
   * itself closes: that happens as soon as the body has been read, long before a POST that streams
   * its answer (the lore stream) is done.
   */
  track(request: FastifyRequest, reply: FastifyReply, projectId: string, personId: string): void {
    const key = this.key(projectId, personId);
    let set = this.open.get(key);
    if (!set) this.open.set(key, (set = new Set()));
    set.add(request);
    reply.raw.once("close", () => {
      set.delete(request);
      if (set.size === 0 && this.open.get(key) === set) this.open.delete(key);
    });
  }

  /**
   * Ends every request the person has open in the project, by closing its connection, except the
   * one that is making the change (leaving, being removed by oneself, deleting the project): that
   * one is about to be answered, and cutting it would drop the answer on the floor.
   */
  cut(projectId: string, personId: string): number {
    const set = this.open.get(this.key(projectId, personId));
    if (!set) return 0;
    const requests = [...set].filter((r) => !isThisRequest(r));
    // The connection itself: destroying the request closes it only while the body is unread, and a
    // POST that streams its answer has read its body long ago.
    for (const r of requests) {
      // (A request made in a test, without a network, has no real socket to close.)
      if (typeof r.raw.socket?.destroy === "function") r.raw.socket.destroy();
      else r.raw.destroy();
    }
    return requests.length;
  }
}
