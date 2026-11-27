import type { ProjectRecord } from "@frontier/schema";
import { ApiError } from "../errors.js";
import type { Services } from "./services.js";

/**
 * Every project's services, each made the first time it is asked for and kept. A project that is
 * not opened costs nothing; one that is opened has its timers (the nightly backup, the fetch of
 * a GitHub library) until `close`.
 */
/** What a request is told when the project went while it was running. */
const goneError = () => new ApiError("no_project", "This project has been deleted.");

export class ProjectRegistry {
  private readonly open_ = new Map<string, Promise<Services>>();
  /** The services that are made and brought up, for a caller that must not wait for an opening. */
  private readonly ready_ = new Map<string, Services>();
  /** Projects that were deleted: never opened again, whatever record a request still holds. */
  private readonly gone = new Set<string>();

  constructor(
    /** Makes a project's services, not yet brought up. */
    private readonly build: (record: ProjectRecord) => Promise<Services>,
  ) {}

  /** The project's services, made and brought up. A second request waits for the first. */
  open(record: ProjectRecord): Promise<Services> {
    if (this.gone.has(record.id)) return Promise.reject(goneError());
    let made = this.open_.get(record.id);
    if (!made) {
      made = this.build(record).then(async (services) => {
        await services.bringUp();
        if (this.open_.get(record.id) === made) this.ready_.set(record.id, services);
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
    void made.then(
      (services) => {
        if (this.open_.get(record.id) === made) this.ready_.set(record.id, services);
      },
      () => undefined,
    );
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

  /**
   * The services of a project that is already open and brought up, or null. Never opens, never
   * waits: the project list uses it to show live numbers without waking a project (stage 27b).
   */
  loaded(id: string): Services | null {
    return this.ready_.get(id) ?? null;
  }

  /**
   * Marks a project as deleted and closes its services. From the first line on `open` refuses the
   * id, so a request that already has the project's record cannot bring its services (and its
   * folders) back. Delete the project from the store before this, and move the folder after.
   */
  async retire(id: string): Promise<void> {
    this.gone.add(id);
    await this.close(id);
  }

  async close(id: string): Promise<void> {
    const made = this.open_.get(id);
    this.open_.delete(id);
    this.ready_.delete(id);
    if (made) await (await made.catch(() => null))?.close();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.open_.keys()].map((id) => this.close(id)));
  }
}
