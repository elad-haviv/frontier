import { expect, type Browser, type BrowserContext, type Page, test } from "./test.ts";
import { api, EMAIL, noSidewaysScroll, PASSWORD, tidyPeople } from "./helpers.ts";

/**
 * Stage 28: email. These run against the second e2e server (`E2E_MAIL=1`, see
 * `playwright.config.ts`), which keeps the mail it sends in memory and shows it at
 * `/api/test/mail`. Nobody is logged in at the start: each test logs in or joins as a person would.
 * People made here stay accounts on the server, so every address is new, and the owner's project
 * is put back (no people, no links waiting) after each test.
 */
test.describe.configure({ mode: "serial" });

const WORDS = "a long enough password";
const mail = (who: string) => `${who}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const open: BrowserContext[] = [];
let owner: Page | null = null;
test.afterEach(async () => {
  if (owner) await tidyPeople(owner);
  owner = null;
  for (const context of open.splice(0)) await context.close().catch(() => undefined);
});

/** A browser nobody is logged in on. */
async function browserWith(browser: Browser) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 800 },
  });
  open.push(context);
  // The card about the Home Screen is for phones, and it is seen.
  await context.addInitScript("localStorage.setItem('frontier.installNotice', '1')");
  return { context, page: await context.newPage() };
}

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await expect(page).not.toHaveURL(/\/login/);
}

/** The server's owner, logged in, who makes the invitations. */
async function ownerOf(browser: Browser): Promise<Page> {
  const { page } = await browserWith(browser);
  await logIn(page, EMAIL, PASSWORD);
  await expect(page.locator(".home h1")).toBeVisible();
  owner = page;
  return page;
}

/** What the server mailed to an address, oldest first. */
async function inbox(page: Page, to: string): Promise<Message[]> {
  const res = await page.request.get("/api/test/mail");
  const all = ((await res.json()) as { messages: Message[] }).messages;
  return all.filter((m) => m.to.toLowerCase().includes(to.toLowerCase()));
}

/** Waits for `count` messages to an address (the mail is sent just after the answer). */
async function waitForMail(page: Page, to: string, count = 1): Promise<Message[]> {
  await expect
    .poll(async () => (await inbox(page, to)).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(count);
  return inbox(page, to);
}

/** The path (with its query) of the link in a message, for the browser on the same server. */
function linkIn(message: Message, kind: "join" | "confirm" | "reset"): string {
  const found = new RegExp(`https?://[^\\s"<>]+/${kind}/[^\\s"<>]+`).exec(message.text);
  expect(found, `a /${kind}/ link in "${message.subject}"`).not.toBeNull();
  const url = new URL(found![0]);
  return url.pathname + url.search;
}

const banner = (page: Page) => page.locator(".confirm-banner");

/** Makes a link by hand (no address), and gives it. */
async function copiedLink(page: Page): Promise<string> {
  await page.goto("/p/sample/settings/members");
  await page.getByRole("button", { name: "Make the link" }).click();
  const url = (await page.getByTestId("invite-link").textContent())!.trim();
  expect(url).toContain("/join/");
  expect(url).not.toContain("?m=");
  return new URL(url).pathname;
}

/** Joins by a link with a name, an address and a password, and gives the person's own page. */
async function joinBy(browser: Browser, path: string, name: string, address: string) {
  const person = await browserWith(browser);
  await person.page.goto(path);
  await person.page.getByLabel("Your name").fill(name);
  await person.page.getByLabel("Email").fill(address);
  await person.page.getByLabel("Password").fill(WORDS);
  await person.page.getByRole("button", { name: "Join Sample" }).click();
  await expect(person.page).toHaveURL(/\/p\/sample$/);
  await expect(person.page.locator(".home h1")).toBeVisible();
  return person;
}

test("an invite is emailed, its link opens the join page with the address filled in, and joining shows no banner", async ({
  browser,
}) => {
  const olive = await ownerOf(browser);
  const address = mail("ines.emailed");
  await olive.goto("/p/sample/settings/members");
  // The invite box offers an address, and the button says what it will do.
  const send = olive.getByRole("button", { name: "Make the link" });
  await expect(send).toBeVisible();
  await olive.getByLabel(/Send it to/).fill("nope");
  await olive.getByLabel(/Send it to/).press("Enter");
  await expect(olive.getByText("That doesn't look like an email address.")).toBeVisible();
  await olive.getByLabel(/Send it to/).fill(address);
  await expect(olive.getByRole("button", { name: "Send the invite" })).toBeVisible();
  await olive.getByLabel(/Send it to/).press("Enter");
  const group = olive.getByRole("group", { name: "The invite link" });
  await expect(group).toContainText(`Sent to ${address}.`);
  await expect(group).toContainText("Anyone who opens it can join with it");
  // The link is shown to copy, and it has no proof: only the email does.
  await expect(olive.getByTestId("invite-link")).toContainText("/join/");
  await expect(olive.getByTestId("invite-link")).not.toContainText("?m=");
  // Waiting: where it went, and Resend.
  const waiting = olive.locator(".invite-row", { hasText: address });
  await expect(waiting).toContainText(`Sent to ${address}`);
  await expect(waiting.getByRole("button", { name: /^Resend/ })).toBeVisible();
  await noSidewaysScroll(olive);

  const [sent] = await waitForMail(olive, address);
  expect(sent!.subject).toContain("invited you");
  const path = linkIn(sent!, "join");
  expect(path).toMatch(/\?m=/);

  // The person opens it from the mail: the address is there, and the page says why.
  const ines = await browserWith(browser);
  await ines.page.goto(path);
  await expect(ines.page.getByLabel("Email")).toHaveValue(address);
  await expect(
    ines.page.getByText("Your invitation was emailed to this address, so it counts as confirmed."),
  ).toBeVisible();
  await ines.page.getByLabel("Your name").fill("Ines Emailed");
  await ines.page.getByLabel("Password").fill(WORDS);
  await ines.page.getByRole("button", { name: "Join Sample" }).click();
  await expect(ines.page).toHaveURL(/\/p\/sample$/);
  await expect(ines.page.locator(".home h1")).toBeVisible();
  // In at once, with no banner, and no second email.
  await expect(banner(ines.page)).toHaveCount(0);
  await ines.page.reload();
  await expect(ines.page.locator(".home h1")).toBeVisible();
  await expect(banner(ines.page)).toHaveCount(0);
  expect(await inbox(olive, address)).toHaveLength(1);
  // The owner sees no "Unconfirmed" beside her.
  await olive.goto("/p/sample/settings/members");
  const row = olive.locator(".member-row", { hasText: "Ines Emailed" });
  await expect(row).toContainText(address);
  await expect(row.locator(".tag-unconfirmed")).toHaveCount(0);
});

test("a copied link with another address shows the banner, Resend kills the old link, and the link from the mail clears it", async ({
  browser,
}) => {
  const olive = await ownerOf(browser);
  const address = mail("yael.copied");
  const path = await copiedLink(olive);
  const yael = await joinBy(browser, path, "Yael Copied", address);

  // The banner is on every page, with no way to close it, and says where the link went.
  await expect(banner(yael.page)).toContainText(
    `Confirm your email: we sent a link to ${address}.`,
  );
  await expect(banner(yael.page).getByRole("button", { name: /^Resend/ })).toBeVisible();
  await expect(banner(yael.page).getByRole("button", { name: "Change address" })).toBeVisible();
  await yael.page.goto("/p/sample/maps");
  await expect(banner(yael.page)).toBeVisible();
  await yael.page.goto("/projects");
  await expect(banner(yael.page)).toBeVisible();
  // One short block on a phone, with nothing spilling sideways.
  await yael.page.setViewportSize({ width: 390, height: 844 });
  await yael.page.goto("/p/sample");
  await expect(banner(yael.page)).toBeVisible();
  await noSidewaysScroll(yael.page);
  await yael.page.setViewportSize({ width: 1280, height: 800 });

  // The owner sees the dashed tag beside the address.
  await olive.goto("/p/sample/settings/members");
  await expect(
    olive.locator(".member-row", { hasText: "Yael Copied" }).locator(".tag-unconfirmed"),
  ).toHaveText("Unconfirmed");

  const [first] = await waitForMail(olive, address);
  expect(first!.subject).toContain("Confirm");
  const oldLink = linkIn(first!, "confirm");

  // Resend makes a new link: the first one stops working.
  await yael.page.goto("/p/sample");
  await banner(yael.page)
    .getByRole("button", { name: /^Resend/ })
    .click();
  await expect(banner(yael.page).getByRole("status")).toHaveText(
    "Sent again. Check your inbox and spam.",
  );
  const mails = await waitForMail(olive, address, 2);
  const newLink = linkIn(mails[1]!, "confirm");
  expect(newLink).not.toBe(oldLink);
  const dead = await yael.context.newPage();
  await dead.goto(oldLink);
  await expect(
    dead.getByRole("heading", { name: "This link has expired or was already used" }),
  ).toBeVisible();
  // Logged in, the page offers a new link right there.
  await expect(dead.getByRole("button", { name: "Send a new link" })).toBeVisible();
  await dead.close();

  // The new link, opened in this browser: confirmed, and the button opens the project.
  const page = await yael.context.newPage();
  await page.goto(newLink);
  await expect(
    page.getByRole("heading", { name: "Your email address is confirmed" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Sample" })).toBeVisible();
  await noSidewaysScroll(page);
  // Opened again, it says so.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "This address is already confirmed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Sample" }).click();
  await expect(page).toHaveURL(/\/p\/sample$/);
  await expect(banner(page)).toHaveCount(0);
  // The other tab learns of it when it is looked at again.
  await yael.page.bringToFront();
  await yael.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(banner(yael.page)).toHaveCount(0, { timeout: 15_000 });
  // And the owner's list no longer marks it.
  await olive.goto("/p/sample/settings/members");
  await expect(olive.locator(".member-row", { hasText: "Yael Copied" })).toBeVisible();
  // (The server's own account, which is from before mail, is still unconfirmed, and says so.)
  await expect(
    olive.locator(".member-row", { hasText: "Yael Copied" }).locator(".tag-unconfirmed"),
  ).toHaveCount(0);
});

test("a confirm link opened logged out says so and offers Log in", async ({ browser }) => {
  const olive = await ownerOf(browser);
  const address = mail("noam.loggedout");
  const path = await copiedLink(olive);
  await joinBy(browser, path, "Noam Loggedout", address);
  const [confirmMail] = await waitForMail(olive, address);
  const stranger = await browserWith(browser);
  await stranger.page.goto(linkIn(confirmMail!, "confirm"));
  await expect(
    stranger.page.getByRole("heading", { name: "Your email address is confirmed" }),
  ).toBeVisible();
  // Nobody was logged in by it: Log in goes to the login page.
  await stranger.page.getByRole("button", { name: "Log in" }).click();
  await expect(stranger.page).toHaveURL(/\/login$/);
  // Nothing of the link is left in the browser's storage.
  const kept = await stranger.page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(kept).not.toContain(
    new URL(`http://x${linkIn(confirmMail!, "confirm")}`).pathname.split("/").pop()!,
  );
});

test("changing the address: a link to the new one, the old one is told, and the change completes when it is opened", async ({
  browser,
}) => {
  const olive = await ownerOf(browser);
  const first = mail("dana.first");
  const second = mail("dana.second");
  const path = await copiedLink(olive);
  const dana = await joinBy(browser, path, "Dana Changes", first);
  await waitForMail(olive, first);

  // Change address, from the banner: the new address and the current password.
  await banner(dana.page).getByRole("button", { name: "Change address" }).click();
  await expect(dana.page.getByLabel("New address")).toBeFocused();
  await dana.page.getByLabel("New address").fill("nope");
  await dana.page.getByLabel("Your password").fill(WORDS);
  await dana.page.getByLabel("Your password").press("Enter");
  await expect(dana.page.getByText("That doesn't look like an email address.")).toBeVisible();
  await dana.page.getByLabel("New address").fill(second);
  await dana.page.getByLabel("Your password").fill("not the password at all");
  await dana.page.getByLabel("Your password").press("Enter");
  await expect(dana.page.getByText("The current password is not right.")).toBeVisible();
  await dana.page.getByLabel("Your password").fill(WORDS);
  await dana.page.getByLabel("Your password").press("Enter");
  await expect(banner(dana.page).getByRole("status")).toContainText(
    `We sent a link to ${second}. Your address stays ${first} until you open it.`,
  );
  // While it waits the banner is about the new address.
  await expect(banner(dana.page)).toContainText(
    `Confirm your new address: we sent a link to ${second}.`,
  );

  // The new address gets the link, and the old one is told, with the new one masked.
  const toSecond = await waitForMail(olive, second);
  expect(toSecond[0]!.subject).toContain("Confirm");
  const toldFirst = await waitForMail(olive, first, 2);
  expect(toldFirst[1]!.subject).toContain("being changed");
  expect(toldFirst[1]!.text).not.toContain(second);

  // Settings, Signing in: still the old address, and the change waiting, which can be cancelled.
  await dana.page.goto("/p/sample/settings/account");
  const block = dana.page.getByTestId("email-block");
  await expect(block).toContainText(first);
  await expect(block).toContainText(`Waiting for you to confirm ${second}.`);
  await block.getByRole("button", { name: "Cancel the change" }).click();
  await expect(block.getByRole("status")).toHaveText("The change was cancelled.");
  await expect(block).not.toContainText("Waiting for you");

  // Ask again, from Settings this time, and open the link: the address changes.
  await block.getByRole("button", { name: "Change address" }).click();
  await dana.page.getByLabel("New address").fill(second);
  await dana.page.getByLabel("Your password").fill(WORDS);
  await dana.page.getByRole("button", { name: "Send a link to the new address" }).click();
  await expect(block).toContainText(`Waiting for you to confirm ${second}.`);
  const linkTwo = await expect
    .poll(async () => (await inbox(olive, second)).length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2)
    .then(async () => (await inbox(olive, second)).at(-1)!);
  const page = await dana.context.newPage();
  await page.goto(linkIn(linkTwo, "confirm"));
  await expect(page.getByRole("heading", { name: "Your email address was changed" })).toBeVisible();
  await dana.page.reload();
  await expect(dana.page.getByTestId("email-block")).toContainText(second);
  await expect(dana.page.getByTestId("email-block")).toContainText("Confirmed");
  await expect(banner(dana.page)).toHaveCount(0);
  // The profile does not take the address: it points to Change address.
  await dana.page.goto("/p/sample/settings/profile");
  await expect(dana.page.getByTestId("profile-email")).toContainText(second);
  await expect(dana.page.getByLabel("Email")).toHaveCount(0);
  await expect(dana.page.getByRole("link", { name: "Change address" })).toBeVisible();
  // The old address can log in no more; the new one can.
  const again = await browserWith(browser);
  await logIn(again.page, second, WORDS);
  await expect(again.page.locator(".home h1")).toBeVisible();
});

test("forgot password: the same answer for every address, a link that works once, and the new password logs in", async ({
  browser,
}) => {
  const olive = await ownerOf(browser);
  const address = mail("wren.forgot");
  const path = await copiedLink(olive);
  const wren = await joinBy(browser, path, "Wren Forgot", address);
  await wren.context.close();
  open.splice(open.indexOf(wren.context), 1);

  const lost = await browserWith(browser);
  await lost.page.goto("/login");
  await lost.page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(lost.page).toHaveURL(/\/forgot-password$/);
  await expect(lost.page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(lost.page.getByLabel("Email")).toBeFocused();
  await lost.page.getByLabel("Email").fill("nope");
  await lost.page.getByLabel("Email").press("Enter");
  await expect(lost.page.getByText("That doesn't look like an email address.")).toBeVisible();

  // A stranger's address reads the same, and gets no email.
  const stranger = mail("nobody.here");
  await lost.page.getByLabel("Email").fill(stranger);
  await lost.page.getByLabel("Email").press("Enter");
  const heading = lost.page.getByRole("heading", {
    name: "If that address has an account, we sent a link",
  });
  await expect(heading).toBeVisible();
  await noSidewaysScroll(lost.page);
  await lost.page.getByRole("button", { name: "Use another address" }).click();
  await lost.page.getByLabel("Email").fill(address);
  await lost.page.getByLabel("Email").press("Enter");
  await expect(heading).toBeVisible();
  expect(await inbox(olive, stranger)).toHaveLength(0);

  const [reset] = (await waitForMail(olive, address)).filter((m) => m.subject.includes("Reset"));
  const link = linkIn(reset!, "reset");
  const page = await lost.context.newPage();
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  const field = page.getByLabel("New password");
  await expect(field).toBeFocused();
  const button = page.getByRole("button", { name: "Set the password" });
  await expect(button).toBeDisabled();
  await expect(page.getByText("12 or more characters.")).toBeVisible();
  await field.fill("short");
  await expect(page.getByText("7 more characters needed.")).toBeVisible();
  await expect(button).toBeDisabled();
  await page.getByLabel("Show the password").check();
  await expect(field).toHaveAttribute("type", "text");
  const fresh = "a brand new password";
  await field.fill(fresh);
  await expect(page.getByText("Good.")).toBeVisible();
  await expect(button).toBeEnabled();
  await noSidewaysScroll(page);
  await field.press("Enter");
  await expect(page.getByRole("heading", { name: "Your password is changed" })).toBeVisible();
  await expect(page.getByText("We logged you out everywhere else.")).toBeVisible();

  // The link was used: it says so, and offers to ask again.
  const used = await lost.context.newPage();
  await used.goto(link);
  await expect(
    used.getByRole("heading", { name: "This link has expired or was already used" }),
  ).toBeVisible();
  await used.getByRole("button", { name: "Ask for a new link" }).click();
  await expect(used).toHaveURL(/\/forgot-password$/);

  // Log in with the new password, not the old one.
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.fill("#email", address);
  await page.fill("#password", WORDS);
  await page.click("button[type=submit]");
  await expect(page.getByText("Wrong email or password.")).toBeVisible();
  await page.fill("#password", fresh);
  await page.click("button[type=submit]");
  await expect(page.locator(".home h1")).toBeVisible();
  // A reset confirms the address: no banner.
  await expect(banner(page)).toHaveCount(0);
});

test("a join with an address that has an account offers Forgot password, and the reset leads back to the invitation", async ({
  browser,
}) => {
  const olive = await ownerOf(browser);
  const address = mail("rhea.exists");
  const first = await joinBy(browser, await copiedLink(olive), "Rhea Exists", address);
  await first.context.close();
  open.splice(open.indexOf(first.context), 1);
  // She is taken out of the project: the account stays, as it does.
  await olive.goto("/p/sample/settings/members");
  const members = (await (await olive.request.get(api("/members"))).json()) as {
    members: { id: string; name: string }[];
  };
  await olive.request.delete(
    api(`/members/${members.members.find((m) => m.name === "Rhea Exists")!.id}`),
  );

  // An invitation emailed to her address, opened from the mail: the address is filled in.
  await olive.reload();
  await olive.getByLabel(/Send it to/).fill(address);
  await olive.getByRole("button", { name: "Send the invite" }).click();
  await expect(olive.getByRole("group", { name: "The invite link" })).toContainText(
    `Sent to ${address}.`,
  );
  const invites = (await waitForMail(olive, address)).filter((m) =>
    m.subject.includes("invited you"),
  );
  const path = linkIn(invites.at(-1)!, "join");

  const rhea = await browserWith(browser);
  const accepted: string[] = [];
  rhea.context.on("request", (r) => {
    if (r.url().includes("/accept")) accepted.push(r.url());
  });
  await rhea.page.goto(path);
  await expect(rhea.page.getByLabel("Email")).toHaveValue(address);
  await rhea.page.getByLabel("Your name").fill("Rhea Exists");
  await rhea.page.getByLabel("Password").fill("whatever it was before");
  await rhea.page.getByRole("button", { name: "Join Sample" }).click();
  await expect(
    rhea.page.getByText("You may already have an account: log in to join."),
  ).toBeVisible();
  await noSidewaysScroll(rhea.page);
  await rhea.page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(rhea.page).toHaveURL(/\/forgot-password$/);
  await expect(rhea.page.getByLabel("Email")).toHaveValue(address);
  await rhea.page.getByLabel("Email").press("Enter");
  await expect(
    rhea.page.getByRole("heading", { name: "If that address has an account, we sent a link" }),
  ).toBeVisible();

  const resets = (await waitForMail(olive, address)).filter((m) => m.subject.includes("Reset"));
  const reset = await rhea.context.newPage();
  await reset.goto(linkIn(resets[0]!, "reset"));
  const fresh = "another fresh password";
  await reset.getByLabel("New password").fill(fresh);
  await reset.getByLabel("New password").press("Enter");
  await expect(reset.getByRole("heading", { name: "Your password is changed" })).toBeVisible();
  // Log in leads to the login page, which goes on to the invitation: the bare page, since the
  // proof is never kept through a reset.
  await reset.getByRole("button", { name: "Log in" }).click();
  await reset.fill("#email", address);
  await reset.fill("#password", fresh);
  await reset.click("button[type=submit]");
  await expect(reset).toHaveURL(/\/join\/[A-Za-z0-9_-]+$/);
  await reset.getByRole("button", { name: /^Join as / }).click();
  await expect(reset).toHaveURL(/\/p\/sample$/);
  await expect(reset.locator(".home h1")).toBeVisible();
  // The proof did not survive the reset (it is never stored), so the accept carries none.
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).not.toContain("?m=");
});
