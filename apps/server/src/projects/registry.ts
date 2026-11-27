import type { ProjectRecord } from "@frontier/schema";
import type { Services } from "./services.js";

/**
 * Every project's services, each made the first time it is asked for and kept. A project that is
 * not opened costs nothing; one that is opened has its timers (the nightly backup, the fetch of
 * a GitHub library) until `close`.
 */
export class ProjectRegistry {
  private readonly open_ = new Map<string, Promise<Services>>();

  constructor(
    /** Makes a project's services, not yet brought up. */
    private readonly build: (record: ProjectRecord) => Promise<Services>,
  ) {}

  /** The project's services, made and brought up. A second request waits for the first. */
  open(record: ProjectRecord): Promise<Services> {
    let made = this.open_.get(record.id);
    if (!made) {
      made = this.build(record).then(async (services) => {
        await services.bringUp();
        return services;
      });
      // A failed opening is not kept, so the next request tries again.
      made.catch(() => this.open_.delete(record.id));
      this.open_.set(record.id, made);
    }
    return made;
  }

  /**
   * Makes a project's services without bringing them up: for the caller that clones and syncs
   * itself (the start of the server, and the tests, which do it by hand).
   */
  async adopt(record: ProjectRecord): Promise<Services> {
    const made = this.build(record);
    this.open_.set(record.id, made);
    made.catch(() => this.open_.delete(record.id));
    return made;
  }

  /** The services of the projects opened so far. */
  async opened(): Promise<Services[]> {
    return Promise.all([...this.open_.values()].map((p) => p.catch(() => null))).then((all) =>
      all.filter((s): s is Services => s !== null),
    );
  }

  /** The services of one project when it is open, without opening it. */
  async peek(id: string): Promise<Services | null> {
    return (await this.open_.get(id)?.catch(() => null)) ?? null;
  }

  async close(id: string): Promise<void> {
    const made = this.open_.get(id);
    this.open_.delete(id);
    if (made) await (await made.catch(() => null))?.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.open_.keys()].map((id) => this.close(id)));
  }
}
