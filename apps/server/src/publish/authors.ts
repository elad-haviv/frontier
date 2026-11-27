import { type AuthorRef, emailKey, STAND_IN_DOMAIN } from "@frontier/schema";
import { displayName } from "../members/names.js";
import type { PeopleStore } from "../state/people.js";

/** The stand-in form: `<person id>@people.frontier.invalid`, in any letter case. */
const STAND_IN = new RegExp(`^(.+)@${STAND_IN_DOMAIN.replace(/\./g, "\\.")}$`, "i");

/**
 * Who a saved version is by, from the name and email Git recorded (stage 27d). A version the app
 * made carries the person's email, or a stand-in made from their id (`authorOf`), so it is traced
 * to an account here: then the person's name as it is now is shown, and their id given. A version
 * Git alone has anything to say about (made before people, by a bot, pushed from outside) shows the
 * name Git has and no id. Never an email: not as the name either (a name that is one is "Someone"),
 * and owners are no exception, since the members list is where they see emails.
 *
 * Two rules keep a version from being credited to someone it is not by:
 *  - the stand-in form names a person only when that person has no email of their own (a person
 *    with one is always authored by it), so nobody can write another's stand-in address;
 *  - only people who are or were members of this project are found (`ofProject`); anyone else is
 *    shown by the name Git has.
 */
export class Authors {
  constructor(
    private readonly people: PeopleStore,
    /** Whether a person is, or was, a member of the project the versions are in. */
    private readonly ofProject: (personId: string) => boolean = () => true,
  ) {}

  async resolve(author: { name: string; email: string }): Promise<AuthorRef> {
    const email = author.email.trim();
    const stand = STAND_IN.exec(emailKey(email));
    let person = null;
    if (stand) {
      const found = await this.people.get(stand[1]!);
      // The stand-in is what a person with no email is authored by; never someone who has one.
      person = found && found.email.trim() === "" ? found : null;
    } else if (email !== "") {
      person = await this.people.byEmail(email);
    }
    if (person && this.ofProject(person.id)) return { id: person.id, name: displayName(person) };
    const name = author.name.trim();
    return { id: null, name: name === "" || name.includes("@") ? "Someone" : name };
  }
}
