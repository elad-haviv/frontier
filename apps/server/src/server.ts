import { join } from "node:path";
import type { Config } from "./config.js";
import { LoginLimiter } from "./auth/limit.js";
import { PeopleStore } from "./state/people.js";
import type { StateFiles } from "./state/files.js";

/**
 * What belongs to the whole server rather than to one library: who has an account, and how many
 * login attempts an address has used. A library's services refer to it, and a server that holds
 * several libraries makes it once and hands it to each.
 */
export interface Server {
  /** Everyone who has an account (stage 27a). */
  people: PeopleStore;
  loginLimit: LoginLimiter;
}

export function makeServer(config: Config, files: StateFiles): Server {
  return {
    people: new PeopleStore(join(config.dataDir, "state"), files),
    loginLimit: new LoginLimiter(config.loginAttempts),
  };
}
