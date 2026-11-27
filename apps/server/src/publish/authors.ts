import type { AuthorRef } from "@frontier/schema";
import { STAND_IN_DOMAIN } from "../auth/session.js";
import { displayName } from "../members/names.js";
import type { PeopleStore } from "../state/people.js";

/**
 * Who a saved version is by, from the name and email Git recorded (stage 27d). A version the app
 * made carries the person's email, or a stand-in made from their id (`authorOf`), so it is traced
 * to an account here: then the person's name as it is now is shown, and their id given. A version
 * Git alone has anything to say about (made before people, by a bot, pushed from outside) shows the
 * name Git has and no id. Never an email: not as the name either (a name that is one is "Someone"),
 * and owners are no exception, since the members list is where they see emails.
 */
export class Authors {
  constructor(private readonly people: PeopleStore) {}

  async resolve(author: { name: string; email: string }): Promise<AuthorRef> {
    const email = author.email.trim();
    const stand = new RegExp(`^(.+)@${STAND_IN_DOMAIN.replace(/\./g, "\\.")}$`, "i").exec(email);
    const person = stand
      ? await this.people.get(stand[1]!)
      : email === ""
        ? null
        : await this.people.byEmail(email);
    if (person) return { id: person.id, name: displayName(person) };
    const name = author.name.trim();
    return { id: null, name: name === "" || name.includes("@") ? "Someone" : name };
  }
}
