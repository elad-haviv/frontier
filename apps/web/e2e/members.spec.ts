import { expect, type Browser, type BrowserContext, type Page, test } from "./test.ts";
import { api, EMAIL, NAME, noSidewaysScroll, openSideBar, PASSWORD, proj } from "./helpers.ts";

/**
 * Stage 27c: people in a project. The owner makes invite links; people join by them, are listed in
 * Members, have their role changed and are taken out; the join page says why a link is dead. Each
 * test leaves the project as it found it: the owner alone, with no link waiting.
 */
test.describe.configure({ mode: "serial" });

const WORDS = "a long enough password";
/** Emails are made new each run: a person made by one test stays an account on the server. */
const mail = (who: string) => `${who}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;

interface Made {
  id: string;
  code: string;
  path: string;
  url: string;
}

/** An invite link from the owner, through the server's own call. */
async function invite(page: Page, role: "owner" | "writer" | "reader" = "writer"): Promise<Made> {
  const res = await page.request.post(api("/invites"), { data: { role } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as Made;
}

/** A browser with nobody logged in: a person who has only a link. */
async function stranger(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

/** A new person in the project, made through the join call, with their own logged-in browser. */
async function joined(
  browser: Browser,
  owner: Page,
  role: "owner" | "writer" | "reader",
  name: string,
) {
  const made = await invite(owner, role);
  const s = await stranger(browser);
  const res = await s.context.request.post(`/api/join/${made.code}`, {
    data: { name, email: mail("person"), password: WORDS },
  });
  expect(res.status(), await res.text()).toBe(200);
  return { ...s, made };
}

/** The member rows of the project, as the owner's call lists them. */
async function members(page: Page) {
  const res = await page.request.get(api("/members"));
  return ((await res.json()) as { members: { id: string; name: string; you: boolean }[] }).members;
}

/** Takes a person out, through the server, so a test leaves the project as it found it. */
async function takeOut(page: Page, name: string) {
  for (const m of await members(page)) {
    if (m.name === name) await page.request.delete(api(`/members/${m.id}`));
  }
}

test("an owner makes a link, a new person joins by password and is listed, changes role, and is removed", async ({
  page,
  browser,
}) => {
  await page.goto(proj("/settings/members"));
  await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
  // The owner sees themselves, with their email, and cannot step down as the only owner.
  const me = page.locator(".member-row", { hasText: NAME });
  await expect(me).toContainText("You");
  await expect(me).toContainText(EMAIL);
  await expect(page.getByLabel(`Role of ${NAME}`)).toBeDisabled();
  await expect(me).toContainText("the only owner");

  // A link for a Writer, by default; it is shown once, with what it can do said plainly.
  await expect(page.getByLabel("They join as")).toHaveValue("writer");
  await page.getByRole("button", { name: "Make an invite link" }).click();
  const box = page.getByTestId("invite-link");
  await expect(box).toContainText("/join/");
  const url = (await box.textContent())!.trim();
  const group = page.getByRole("group", { name: "The invite link" });
  await expect(group).toContainText("It works once, for 7 days");
  await expect(group).toContainText("will not show this link again");
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(page.getByText("A link for one writer")).toBeVisible();
  await expect(page.getByText(/Made by Olive Owner/)).toBeVisible();
  await noSidewaysScroll(page);

  // The new person: name, email and password, and they are in.
  const wren = await stranger(browser);
  const wrenMail = mail("wren");
  await wren.page.goto(url);
  await expect(
    wren.page.getByRole("heading", { name: "Olive Owner invited you to write in Sample" }),
  ).toBeVisible();
  await expect(wren.page.locator(".join-project")).toContainText(/\d+ entries/);
  await expect(wren.page.locator(".join-project")).toContainText("Writer");
  await expect(wren.page.getByText("runs on your own AI key")).toBeVisible();
  await noSidewaysScroll(wren.page);
  // Name and email are asked for on every way in.
  await wren.page.getByRole("button", { name: "Join Sample" }).click();
  await expect(wren.page.getByText("Give your name.")).toBeVisible();
  await expect(wren.page.getByText("Give your email.")).toBeVisible();
  await wren.page.getByLabel("Your name").fill("Wren Writer");
  await wren.page.getByLabel("Email").fill(wrenMail);
  await wren.page.getByLabel("Password").fill("short");
  await wren.page.getByRole("button", { name: "Join Sample" }).click();
  await expect(wren.page.getByText("Use at least 12 characters.")).toBeVisible();
  await wren.page.getByLabel("Password").fill(WORDS);
  await wren.page.getByRole("button", { name: "Join Sample" }).click();
  await expect(wren.page).toHaveURL(/\/p\/sample$/);
  await expect(wren.page.locator(".home h1")).toBeVisible();
  await openSideBar(wren.page);
  await expect(wren.page.locator(".left-person")).toContainText("Writer here");

  // The link was used: it is gone from the owner's list, and the new person is listed.
  await page.reload();
  await expect(page.getByText("No invitations are waiting.")).toBeVisible();
  const row = page.locator(".member-row", { hasText: "Wren Writer" });
  await expect(row).toContainText(wrenMail);
  await expect(row).toContainText(/not here since joining|active/);

  // A writer reads the same list, with no emails and no controls but their own way out.
  await wren.page.goto(proj("/settings/members"));
  await expect(wren.page.locator(".member-row", { hasText: NAME })).not.toContainText(EMAIL);
  await expect(wren.page.getByLabel(`Role of ${NAME}`)).toHaveCount(0);
  await expect(wren.page.getByRole("button", { name: "Make an invite link" })).toHaveCount(0);
  await expect(wren.page.getByRole("button", { name: "Leave this project" })).toBeEnabled();

  // The owner makes them a reader: their shell follows, with a word, while the app is open.
  await page.getByLabel("Role of Wren Writer").selectOption("reader");
  await expect(page.getByText("Wren Writer is now a Reader.")).toBeVisible();
  await expect(async () => {
    await openSideBar(wren.page).catch(() => undefined);
    await expect(wren.page.locator(".left-person")).toContainText("Reader here");
  }).toPass({ timeout: 20_000 });
  await expect(wren.page.locator(".left-reader-note")).toContainText("cannot change the text");

  // Removing them asks first, in the row, and keeps the safe answer in reach.
  await page.getByRole("button", { name: "Remove Wren Writer" }).click();
  await expect(page.getByRole("group", { name: "Remove Wren Writer?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep" })).toBeFocused();
  await page.getByRole("button", { name: "Keep" }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Remove Wren Writer" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Wren Writer was removed. What they wrote stays")).toBeVisible();
  await expect(page.locator(".member-row", { hasText: "Wren Writer" })).toHaveCount(0);

  // The removed person, with the app open, lands on All projects and is told why.
  await expect(wren.page).toHaveURL(/\/projects$/, { timeout: 20_000 });
  await expect(wren.page.getByText("You are no longer in Sample")).toBeVisible();
  await expect(wren.page.getByText("You're not in a project yet.")).toBeVisible();
  await expect(wren.page.getByText("invite link from one of its owners")).toBeVisible();
  // Only the server's first account makes projects.
  await expect(wren.page.getByRole("button", { name: "New project" })).toHaveCount(0);
  await wren.context.close();
});

test("an owner link is made on purpose, and a waiting link can be cancelled", async ({ page }) => {
  await page.goto(proj("/settings/members"));
  await page.getByLabel("They join as").selectOption("owner");
  await page.getByRole("button", { name: "Make an invite link" }).click();
  const dialog = page.getByRole("dialog", { name: "Make a link that joins as an owner?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("delete Sample");
  // Not now: no link is made.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("invite-link")).toHaveCount(0);
  await expect(page.getByText("No invitations are waiting.")).toBeVisible();
  // On purpose: it is made.
  await page.getByRole("button", { name: "Make an invite link" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Make an owner link" }).click();
  await expect(page.getByTestId("invite-link")).toBeVisible();
  await expect(
    page.getByText("who joins as an Owner").or(page.getByText("joins as an Owner")),
  ).toBeVisible();
  await expect(page.getByText("A link for one owner")).toBeVisible();
  // Cancelled, it stops working at once.
  const url = (await page.getByTestId("invite-link").textContent())!.trim();
  await page.getByRole("button", { name: /^Cancel the link for one owner/ }).click();
  await expect(
    page.getByText("The invitation was cancelled. Its link no longer works."),
  ).toBeVisible();
  await expect(page.getByText("No invitations are waiting.")).toBeVisible();
  const res = await page.request.get(`/api/join/${url.split("/join/")[1]}`);
  expect(res.status()).toBe(410);
});

test("a link that does not work says why, and whom to ask", async ({ page, browser }) => {
  const cancelled = await invite(page);
  await page.request.delete(api(`/invites/${cancelled.id}`));
  const used = await joined(browser, page, "reader", "Una Used");
  const s = await stranger(browser);

  await s.page.goto(cancelled.path);
  await expect(
    s.page.getByRole("heading", { name: "This invitation was cancelled" }),
  ).toBeVisible();
  await expect(s.page.getByText("Ask Olive Owner for a new link.")).toBeVisible();
  await expect(s.page.getByRole("button", { name: /Join/ })).toHaveCount(0);

  await s.page.goto(used.made.path);
  await expect(
    s.page.getByRole("heading", { name: "This invite link was already used" }),
  ).toBeVisible();
  await expect(s.page.getByText("ask Olive Owner for a new one")).toBeVisible();

  await s.page.goto("/join/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(s.page.getByRole("heading", { name: "This link does not work" })).toBeVisible();
  await expect(s.page.getByText("cut short")).toBeVisible();
  await noSidewaysScroll(s.page);

  // An address that is not a code at all gets the same words, and no name.
  await s.page.goto("/join/nope");
  await expect(s.page.getByRole("heading", { name: "This link does not work" })).toBeVisible();

  await s.context.close();
  await used.context.close();
  await takeOut(page, "Una Used");
});

test("an email that has an account is sent to log in, and the link goes into that account", async ({
  page,
  browser,
}) => {
  const made = await invite(page);
  const s = await stranger(browser);
  await s.page.goto(made.path);
  await s.page.getByLabel("Your name").fill("Olive Again");
  await s.page.getByLabel("Email").fill(EMAIL);
  await s.page.getByLabel("Password").fill(WORDS);
  await s.page.getByRole("button", { name: "Join Sample" }).click();
  // No account is made: the page asks for a login, keeping the link.
  await expect(
    s.page.getByText("Log in with your account, and this invitation goes into it."),
  ).toBeVisible();
  await s.page.getByLabel("Password").fill(PASSWORD);
  await s.page.getByRole("button", { name: "Log in and join" }).click();
  // They are in the project already: the link is not used up, and the project opens.
  await expect(s.page).toHaveURL(/\/p\/sample$/);
  await expect(s.page.locator(".home h1")).toBeVisible();
  const still = await page.request.get(`/api/join/${made.code}`);
  expect(still.status()).toBe(200);
  await page.request.delete(api(`/invites/${made.id}`));
  await s.context.close();
});

test("a person who is logged in joins as themselves, and one already in the project is taken to it", async ({
  page,
  browser,
}) => {
  const first = await joined(browser, page, "writer", "Lena Leaver");
  // Leaving asks first, and ends on All projects.
  await first.page.goto(proj("/settings/members"));
  await first.page.getByRole("button", { name: "Leave this project" }).click();
  const ask = first.page.getByRole("dialog", { name: "Leave Sample?" });
  await expect(ask).toContainText("What you wrote stays, under your name");
  await ask.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(first.page).toHaveURL(/\/projects$/);
  await expect(first.page.getByText("You're not in a project yet.")).toBeVisible();
  // They are no longer listed.
  await page.goto(proj("/settings/members"));
  await expect(page.locator(".member-row", { hasText: "Lena Leaver" })).toHaveCount(0);

  // With a new link, and still logged in, they are offered to join as themselves.
  const again = await invite(page, "reader");
  await first.page.goto(again.path);
  await expect(first.page.getByText("You are logged in as")).toBeVisible();
  await first.page.getByRole("button", { name: "Join as Lena Leaver" }).click();
  await expect(first.page).toHaveURL(/\/p\/sample$/);
  await openSideBar(first.page);
  await expect(first.page.locator(".left-person")).toContainText("Reader here");

  // Opening a link to a project they are in goes straight to it, and keeps the link.
  const spare = await invite(page, "reader");
  await first.page.goto(spare.path);
  await expect(first.page).toHaveURL(/\/p\/sample$/);
  const still = await page.request.get(`/api/join/${spare.code}`);
  expect(still.status()).toBe(200);
  await page.request.delete(api(`/invites/${spare.id}`));

  await first.context.close();
  await takeOut(page, "Lena Leaver");
});

test("the only owner cannot step down, leave or be removed, and is told why", async ({ page }) => {
  await page.goto(proj("/settings/members"));
  await expect(page.getByRole("button", { name: "Leave this project" })).toBeDisabled();
  await expect(
    page.getByText("You are the only owner. A project always needs an owner."),
  ).toBeVisible();
  // The server refuses the same things, in its own words, whatever the page shows.
  const mine = (await members(page)).find((m) => m.you)!;
  const step = await page.request.put(api(`/members/${mine.id}`), { data: { role: "reader" } });
  expect(step.status()).toBe(409);
  expect(((await step.json()) as { error: { code: string } }).error.code).toBe("last_owner");
  const out = await page.request.post(api("/members/leave"));
  expect(out.status()).toBe(409);
  const gone = await page.request.delete(api(`/members/${mine.id}`));
  expect(gone.status()).toBe(409);
});

test("with two owners, one can be made a writer and taken out, and the other stays", async ({
  page,
  browser,
}) => {
  const second = await joined(browser, page, "owner", "Otto Owner");
  await page.goto(proj("/settings/members"));
  // Both are owners now, so either can be changed.
  await expect(page.getByLabel(`Role of ${NAME}`)).toBeEnabled();
  await page.getByLabel("Role of Otto Owner").selectOption("writer");
  await expect(page.getByText("Otto Owner is now a Writer.")).toBeVisible();
  await page.getByRole("button", { name: "Remove Otto Owner" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Otto Owner was removed.")).toBeVisible();
  await second.context.close();
});

test("a save made while a writer, and refused once they are a reader, is offered to copy out or discard", async ({
  page,
  browser,
}) => {
  const writer = await joined(browser, page, "writer", "Wanda Writer");
  const w = writer.page;
  const path = "01 Places/Harbor/Old Quay.md";
  await w.goto(proj(`/edit/${path.split("/").map(encodeURIComponent).join("/")}`));
  await expect(w.locator(".cm-content")).toBeVisible();
  await w.locator(".cm-content").click();
  // Typed with no connection: it is kept on this device, to be sent.
  await writer.context.setOffline(true);
  await w.keyboard.press("Control+End");
  await w.keyboard.type(" A line typed before the role changed.");
  await expect(w.locator(".save-offline")).toBeVisible();

  // The owner makes them a reader meanwhile; when the connection returns the server refuses it.
  const mine = (await members(page)).find((m) => m.name === "Wanda Writer")!;
  const changed = await page.request.put(api(`/members/${mine.id}`), { data: { role: "reader" } });
  expect(changed.status()).toBe(200);
  await writer.context.setOffline(false);

  // It is not sent again, and it is not lost: All projects offers its text, to copy or discard.
  await w.goto("/projects");
  const stranded = w.locator(".stranded");
  await expect(stranded).toBeVisible({ timeout: 30_000 });
  await expect(stranded).toContainText(/sample/i);
  await expect(stranded).toContainText("your role no longer lets you change it");
  await expect(stranded).toContainText("Old Quay");
  await expect(stranded.getByRole("button", { name: "Copy the text" })).toBeVisible();
  await expect(stranded.getByRole("button", { name: "Retry" })).toHaveCount(0);
  // The server never saw it.
  const text = await page.request.get(api(`/entries?path=${encodeURIComponent(path)}`));
  expect(JSON.stringify(await text.json())).not.toContain("typed before the role changed");
  await stranded.getByRole("button", { name: "Discard" }).click();
  await w.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
  await expect(w.locator(".stranded")).toHaveCount(0);

  await writer.context.close();
  await takeOut(page, "Wanda Writer");
});
