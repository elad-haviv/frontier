# Settings: review and proposal

> **Changed by stage 27f.** AI keys are no longer kept on the server: each person keeps their own in
> their browser, and sends it with each AI request. Settings › Providers, the keys kept encrypted
> under `SECRETS_KEY`, keys from the environment and the monthly cap described below are gone. The
> sections moved: AI keys (This device), AI models and Your AI spending (You). Old addresses
> redirect. See `stage-27-people-and-projects.md`, "Your own AI keys".

For the owner's four asks: a side menu, several AI providers with their own keys, a model picker
with search and details, and a UX review to approve. Read on 2026-11-24 from
`apps/web/src/pages/Settings.tsx`, `components/OnThisDevice.tsx`, `apps/server/src/routes/settings.ts`,
`apps/server/src/ai/{provider,models,log}.ts`, `packages/schema/src/api.ts` (SettingsResponse,
AiSettingsRequest, ModelsResponse), `pages/Status.tsx`, and the stage 8 and stage 15 designs. I ran
the built app the way the e2e tests do (port 4012, sample vault, the stand-in AI) and took screenshots.

Files in this folder:

| File | What |
|---|---|
| `settings-now-desktop.png`, `settings-now-phone.png` | Today, with no key set |
| `settings-now-populated.png` | Today, with a key, two models and one call in the log |
| `settings-mockup.html` | The proposal. Static, light and dark. Desktop: Providers, Models with the picker open, Spending. Phone: section list (offline), Providers, picker sheet, details sheet |
| `settings-mock-0..3.png`, `settings-mock-1-dark.png` | Screenshots of the mockup's frames |

---

## 1. What's wrong today

Settings is one long column of five blocks: On this device, AI, Propose fields for a folder,
AI calls this month, Types and dates, Signing in. On a phone it's about 3,000 px tall, and the
AI block alone has eight controls.

**Finding your way**
1. **No menu and no deep links.** Every "set this in Settings" message in the app ("No model is
   chosen for this task. Choose one on the settings page.", Ask's "Choose one in Settings", the
   comments panel's tooltip) lands at the top of the page. On the phone, the first screen is the
   iPhone install card, and AI is below the fold.
2. **The order doesn't match how often things are used.** "On this device" comes first because it
   has to render offline, not because it's used most. AI, the section the owner actually changes,
   is second. Signing in is last, and Log out isn't on this page at all (it's in the app menu).
3. **Related things are spread around.** Backups (last backup time, the "backed up only to this
   disk" warning) are on Status. Export and Import are in the app menu. The cost log is three blocks
   below the cap it counts against.

**The AI block**
4. **One provider, hard-wired.** The copy says "Frontier's AI goes through OpenRouter". There is one
   key field, and the server reads only `openrouterUrl` and `OPENROUTER_API_KEY`.
5. **The key field mixes up three things.** The label carries the status in capitals ("PROVIDER KEY
   SET, ENDS IN 1234"). The input means "replace it". The key is only sent when you press the
   block's Save button, along with every other field, and nothing checks it. A mistyped key shows
   up later as a failed call somewhere else in the app.
6. **The model fields are plain text boxes with a `<datalist>`.** That gives no search across
   names, no grouping, and no details beyond one line of price. iOS Safari's datalist shows bare
   suggestions above the keyboard, so on the phone it's effectively "type the exact id". After a
   pick, the field shows the raw id (`sample/reader`), not the model's name.
7. **The three model fields behave differently.** Proposing fields shows the chosen model's price.
   Lore conversations shares the same list but shows no price. Concept art has no list at all, only
   a placeholder example (`google/gemini-2.5-flash-image`), and nothing checks that the model can
   make images.
8. **Lore conversations covers five features without saying so clearly**: Ask, writing help,
   talking to characters, exploring a map, and comments. The hint names only two of them.
9. **Test only tests the model for proposing fields.** It's disabled until that model is set, even
   if you only care about lore conversations, and it never tests the art model.
10. **One Save button for eight unrelated fields.** Changing the cap means pressing Save, which also
    re-sends the models and the style. The result shows as a banner at the top of the block, which is
    off-screen on a phone after you scroll down to Save. Leaving the page loses unsaved edits without
    a warning.
11. **The cap is a number field with no inline check.** A bad value is reported in the banner, not
    next to the field.
12. **The art style textarea is unstyled.** It renders in the browser's monospace font with a
    different border (see the screenshot), the only field on the page that looks like that.

**Spending**
13. **"AI calls this month" disappears when there are no calls.** That's exactly when you'd want to
    see "nothing spent yet".
14. **The log is raw.** The "Entry" column shows the internal task name (`extraction`) when a call
    isn't about an entry. Model is the raw id. When shows seconds. There's no month switch (the API
    already accepts `?month=`), no total next to the rows, and no tokens.
15. **Costs are all assumed to be reported.** The provider's `usage.cost` is taken as given, and a
    call that reports nothing is logged as $0, which is never shown as unknown. Today that's safe
    only because OpenRouter reports cost. With direct providers it would quietly undercount against
    the cap.

**The rest**
16. **"Propose fields for a folder" is a tool, not a setting**, and it asks you to type a folder path
    ("Such as 03 Gazetteer (Places & Locations)"). The app already has a folder tree to pick from.
17. **Offline, the server blocks just don't appear.** Only "On this device" renders, followed by a
    Problem with Retry. Nothing says that the AI, Signing in and Types sections exist but need a
    connection.
18. **Small things:** "Add a passkey" is a dashed (disabled) button until a name is typed, with no
    hint why. "Types and dates" is read-only text that lives in the AI-heavy page with no grouping.

---

## 2. Proposed design

### 2.1 Information architecture

Four groups, nine sections, in this order (most used first; device and account last, as in most apps):

| Group | Section | URL | Contents | Offline |
|---|---|---|---|---|
| AI | **Providers** | `/settings/ai/providers` | Connected services and their keys | needs connection |
| | **Models** | `/settings/ai/models`, `/settings/ai/models/:task` | One model per task, art style, "propose on publish" | needs connection |
| | **Spending** | `/settings/ai/spending?month=2026-11` | Cap, this month by provider, call log | needs connection |
| | **Propose for a folder** | `/settings/ai/folder-run` | Today's block, with a folder picker | needs connection |
| Library | **Types and dates** | `/settings/library/types` | Today's block | needs connection |
| | **Backups and export** | `/settings/library/backups` | Last backup and its warning (shared with Status), Export and Import links | needs connection |
| This device | **Offline copy** | `/settings/device` | Today's "On this device", unchanged | **works offline** |
| Account | **Signing in** | `/settings/account` | Passkeys, password switch, **Log out** (also kept in the app menu) | needs connection |

**Desktop (≥ the app's wide breakpoint):** a 220 px left rail inside the settings page, to the right of
the app's own side bar (mockup, Desktop 1). Group labels are small caps. The current section is
highlighted with the accent bar and has `aria-current="page"`. A section can show a status in the rail:
"1 problem" in red on Providers when a key is failing, "off" on Models when a task has no model.
`/settings` opens the first section that needs attention, or Providers if none does.

**Phone:** `/settings` is a grouped list, iOS style (mockup, Phone 1). Each row has a one-line state
("Connected: OpenRouter", "41 MB on this iPhone", "2 passkeys"). Tapping a row pushes the section,
and the top bar shows "‹ Settings" as Back. The browser Back button and the iOS edge swipe work,
because each section is its own URL. The rail and the list are the same component: a `nav` that
renders as a rail when wide and as the list page when narrow.

**Deep links fix the "go to Settings" dead ends.** Each server error that today says "on the settings
page" carries a link instead:
- `ai_off` with no key → `/settings/ai/providers`
- `ai_off` with no model → `/settings/ai/models/conversation` (or `extraction`, `art`). On desktop
  this scrolls to that row and opens the picker; on the phone it opens the picker sheet.
- `ai_cap_reached` → `/settings/ai/spending`, with the cap field focused

Old `/settings` links keep working.

### 2.2 AI › Providers

(Mockup Desktop 1 and Phone 2: one connected, one with a refused key, one not set up.)

**Which providers to support, and in what order.** Two adapters cover almost everything, plus
OpenRouter, which already exists:

| Adapter | Providers | Text with a fixed-form (JSON schema) answer | Pictures |
|---|---|---|---|
| OpenRouter (today's code) | OpenRouter | yes | yes, `/images` |
| OpenAI-compatible | **OpenAI, xAI (Grok), Google AI Studio** (its OpenAI-compatible endpoint), later Mistral, DeepSeek, Groq, and "Other" (base URL + key, such as a local server) | `response_format: json_schema` where the provider supports it | OpenAI and xAI `images/generations`. Gemini pictures need the native `generateContent` call, a small extra path |
| Anthropic | **Anthropic** | Messages API. Fixed form via a forced tool call (or Anthropic's structured outputs) | none: Anthropic has no image models |

**Recommendation: first release = OpenRouter + Anthropic + OpenAI + Google AI Studio + xAI.** That's
the five the owner named, and it needs only two new adapters. Mistral, DeepSeek and Groq are presets
of the OpenAI-compatible adapter (a name, a base URL and a key-format hint), so they cost very little
to add next. "Other, OpenAI-compatible" comes last because it brings two extra problems: an arbitrary
URL the server will call (SSRF), and models with no known price (see Decision 3). Check each
provider's current API details while building. They change, and this doc doesn't pin versions.

**A provider row** has a logo, a name, and a status line:
- **Connected**: "key ends …4f2a · checked 2 min ago", then the number of models, whether the
  provider reports costs, and "used for" links to the task rows. Actions: Check again, Replace key, Remove.
- **Key refused**: red dot. The provider's own words ("401 invalid x-api-key"), with the key
  stripped out if the provider echoes it. What it breaks ("Lore conversations is off until this
  works or you choose another model"). The replace field is already open with **Check and save**.
- **Not set up**: a hollow dot, one sentence on where to get a key, and **Add key**.
- **From the server's environment** (today's `OPENROUTER_API_KEY`, and later
  `ANTHROPIC_API_KEY` etc.): shown as "from the server's environment, ends in …", read-only, with no
  Remove. A key stored in Settings wins over the environment, as it does today.

**Adding or replacing a key.** A password-type field with `autocomplete="off"` and the provider's
key prefix as placeholder (`sk-ant-…`, `sk-or-…`), plus a show/hide eye. "Check and save" sends the
key to the server. The server makes a **free** call with it: list the provider's models, which costs
nothing and needs no model chosen. It stores the key only if that call works. On failure, the
provider's message is shown under the field and the field keeps its text so you can fix a typo. If
the provider can't be reached at all (as opposed to refusing the key), offer "Save anyway". The field
is cleared after a successful save. No key ever comes back from the server, only its last four
characters.

**Removing** asks first, and names what stops: "Lore conversations and Concept art use Anthropic.
Removing its key turns them off until you choose other models."

**No SECRETS_KEY** (today's `canStoreKey: false`): a banner at the top of Providers keeps today's
explanation. The Add and Replace buttons are disabled with that reason. Environment keys still show.

**"Which provider is used for what"** isn't a separate setting. Each task's model belongs to exactly
one provider, so Providers shows "used for …" and Models shows the provider's logo. The same model
can be reachable two ways (Grok 4.7 directly from xAI and through OpenRouter). Both are listed, each
under its provider, and the choice is stored as the pair *(provider, model)*.

### 2.3 AI › Models and the picker

(Mockup Desktop 2, Phone 3 and 4.)

**Tasks.** Today's three slots stay, renamed and explained:
- **Proposing fields**: reads an entry and suggests dates and types for the inbox.
- **Lore conversations**: Ask, writing help, talking to characters, exploring a map, comments.
- **Concept art**: pictures for discoveries. The art style textarea and "Propose fields for the
  entries of each publish" move next to the rows they belong to.

Whether to split Lore conversations into per-feature slots is Decision 4.

Each row shows the chosen model as a chip: the provider's logo, the model's **name** (not its id),
the key ability, and the price. With no model chosen, the row says "Off" and offers the recommended
model in one click ("Use Gemini 3.8 Flash, recommended"). With no provider connected, it says
"Connect a provider first" and links to Providers. Each row has a **Try it** action that runs
today's Test against *that* task's model. For Concept art, Try it makes a picture and shows what it
cost, after a confirmation, because a picture costs a few cents.

**The combobox** (ARIA 1.2 combobox with a listbox; `aria-activedescendant` follows the highlight):
- **Type-ahead** over the name, id and provider of every model of every *connected* provider, with
  the matched letters highlighted. Fuzzy enough that "sonet" finds Sonnet.
- **Grouped by provider**, with a count ("OpenRouter · 5 of 9"). A provider whose key is failing
  still gets a header ("Anthropic · key refused, fix it to list its models"), so the owner isn't left
  wondering where its models went.
- **Rows**: the name; the price in and out per million tokens (for an image model, the price per
  picture); then small tags: context ("1M context"), "reads images", "reasoning", "cost estimated"
  for providers that don't report cost, and **"Recommended for lore"**. The model in use is marked "· in use".
- **Filters** as chips: **Fits this task** (on by default), provider, "reads images", and "cheap"
  on the phone. Sort by recommended (default), price, or name.
- **Details panel** on the right (desktop), following the highlighted row: provider and exact id,
  a short description, price (including any tier above a context length), context and maximum
  output, what it reads and what it can answer, how its cost is known, and **"A typical lore question
  here sends about 14,000 tokens and gets 1,200 back: about 3.5¢ each. Your cap of $10 covers about
  280."** The typical sizes come from the owner's own log (median tokens per task this month), or
  sensible defaults when the log is empty. That one sentence turns per-million-token prices into
  something a person can judge.
- **Keyboard**: ↑/↓ move, Enter picks and saves, Esc closes and changes nothing, Tab moves into the
  filters. Typing goes to the search field.
- **Phone**: a full-height sheet titled with the task, with the search field on top (the keyboard
  opens with it) and Cancel. Tapping a row picks it. Tapping ⓘ opens the details sheet with
  **Use this model**.
- **Loading or failure**: a skeleton while the list loads. If a provider's list can't be fetched:
  "Couldn't fetch xAI's model list. Retry". You can still type an exact id (see below).

**Where the details come from.** Direct providers' model lists are thin: OpenAI's gives ids only,
Anthropic's gives names, and Google's gives token limits. None reliably gives prices or "can answer in
a fixed form". OpenRouter's **public** `/models` list (no key needed) has all of it. The server
fetches it hourly, as today, and enriches each provider's models by matching ids
(`claude-sonnet-5-5` ↔ `anthropic/claude-sonnet-5.5`) through a small mapping per provider. A
model that can't be matched is listed under "Not checked", with "details unknown". It can be picked
only after **Try it** passes.

**"Recommended"** is a short list, per task, kept in server code (`ai/recommended.ts`): for each
task, an ordered list of ids, and the first one that's available among connected providers gets the
badge. The details panel says "Frontier's pick, reviewed 2026-11". There's no ranking algorithm to
explain or maintain.

**When a model can't do the task.** Every call for Proposing fields and Lore conversations asks for
a JSON-schema answer (`response_format: json_schema`). Concept art needs a model that makes pictures.
- **Filter, then explain.** With "Fits this task" on, models that can't do the task are hidden. A
  footer says how many: "3 more match '4' but can't give fixed-form answers, which lore
  conversations need. Show them." Shown, they're greyed out with the reason and **can't be picked**.
- **An exact id typed that isn't listed** offers "Use 'x' anyway". It's picked only after Try it
  passes, and the row then carries a warning tag.
- **A provider with no models for a task** (Anthropic for art) shows its header with "no image models".
- **A model that disappears later** (retired by the provider): the task row turns amber ("Not listed
  by OpenRouter any more; calls may fail"), and so does the rail.

### 2.4 AI › Spending

(Mockup Desktop 3.)
- **This month at a glance**: "$3.42 of a $[10] cap · November 2026", a meter, and "Resets
  1 December". The cap field is inline here, next to what it limits, and saves on blur or Enter.
- **By provider**, with a **"How we know"** column. This is the honest part:
  - *Reported*: OpenRouter returns the cost of each call (`usage.cost`). Shown as plain dollars.
  - *Estimated*: most direct providers return tokens, not dollars. Frontier multiplies the tokens by
    the catalogue price at the time of the call, stores the result **with a flag**, and shows it with
    "≈". Estimates **do** count against the cap.
  - *Unknown*: the price isn't known (a custom endpoint, or a model the catalogue doesn't match).
    Shown as "—" with "no price known: not counted. Set a price". Decision 3 decides whether this can
    happen at all.
  - The footnote keeps today's advice ("The cap is Frontier's own. Also set a hard limit with each
    provider") and links to each connected provider's billing-limit page.
- **The call log**: month switch (‹ October · November ›); a filter for failed calls only. Columns:
  When ("Today 11:03"), What (a human label: "Lore question", "Proposed fields · Mira" linked,
  "Writing help · Harbor", "Concept art · Test Hollow", "Talking with · Shade"), Model (name, with the
  provider faint), Tokens in/out ("picture" for art), and Cost (plain, "≈", "unknown" or
  "failed: <reason>"). **Empty state**: "No AI calls in November yet." instead of hiding the section.
  On the phone, rows become two-line cards (What and Cost on top, When · Model below).

### 2.5 The other sections, tidied

- **Propose for a folder**: today's block, but the folder is chosen with a folder picker (the folder
  list from `components/MoveTo.tsx`, which "Move to" already uses), defaulting to "The whole library". Estimate, then Start, as today. With
  no model for Proposing fields: "Choose a model for proposing fields first" linking to that row.
  (Later, this could move to the Inbox, where its results land. Not needed now.)
- **Types and dates**: today's block. Its path `.frontier/schema.yaml` shown in mono, with a "Copy"
  button for the built-in text.
- **Backups and export**: the last backup time and the "backed up only to this disk" warning (same
  data as Status, so one place to look), "Export the library" and "Import", which today sit only in
  the app menu. Status keeps its copy.
- **Offline copy**: today's "On this device", unchanged (install card, space used, Remove everything).
  It's the one section that always works offline.
- **Signing in**: the list of passkeys (name, date added, "this device" when it was added here). Add
  a passkey: the name field keeps today's suggestion. The button is enabled and asks for the name if
  it's missing, instead of a dashed button with no hint. "Switch the password off" stays, with the
  same rule. **Log out** at the bottom, with the same warning about unsent changes as the app menu.

### 2.6 Saving, validation, empty states, offline

**Saving: save each change as it's made; no page Save button** (Decision 2). The API already takes
partial updates (`PUT /api/settings/ai` with any subset of fields), so this fits.
- **Choices** (a model, a toggle): saved when chosen. A small "✓ Saved" appears next to the control
  for two seconds, and a toast offers **Undo** for model changes (the app already has toasts with an
  action, in `Shell.tsx`).
- **Text** (the cap, the art style): saved on blur or Enter, with the same "✓ Saved". The art style
  counts characters against its 600 limit.
- **Keys**: never auto-saved. **Check and save** is an explicit action, because it calls the provider.
- **On failure**: the control goes back to what's stored, and the error shows *under that control*,
  not in a banner at the top of the block.

**Validation, inline under the field:**
- Cap: a number from 0 to 10,000. "The cap is an amount in dollars, such as 10." With a cap below
  what's already spent: "This is below the $3.42 already spent, so AI stops until December." Allowed,
  but stated.
- Key: not empty. A prefix that doesn't match the provider gets a warning, not a block: "OpenRouter
  keys usually start with sk-or-".
- Custom base URL: `https://` only, and not a private address (see Security).

**Empty states:**
- No provider: Providers shows three cards (OpenRouter "one key, hundreds of models, easiest start",
  Anthropic, Google), and Models shows "Connect a provider first" on each row.
- Provider but no model: the row says "Off" and offers the recommended model in one click.
- No calls: "No AI calls in November yet."

**Offline:** `/api/settings*` never goes through the service worker (stage 15), so nothing from the
server can be shown offline. The rail and the list still show every section, with "Needs a
connection" under each server one (mockup, Phone 1). Opening one shows a short card: "AI settings
live on your server. They open when you're connected." The page offers a link to Offline copy, which
works. A connection banner across the top says so once. When the connection comes back, the open
section loads by itself; there's no Retry to press.

---

## 3. Mockups

`settings-mockup.html` (open it in a browser; the dark scheme follows the system):
1. **Desktop 1 · Providers**: OpenRouter connected, Anthropic with a refused key (the replace field
   open), Google AI Studio not set up, and "Add another provider".
2. **Desktop 2 · Models, picker open**: "4" typed into the Lore conversations picker. Results are
   grouped under OpenRouter and xAI, with the failing Anthropic header, a recommended badge, and the
   "3 more can't…" footer. The details panel shows Grok 4.7, with its cost estimate.
3. **Desktop 3 · Spending**: cap and meter, by provider with "How we know", and the call log with
   ≈, unknown and failed rows.
4. **Phone**: the section list offline; Providers; the picker sheet searching "flash"; the details
   sheet with "Use this model".

Prices and names are illustrative, from OpenRouter's public list on the day of writing.

---

## 4. Decisions for the owner

**D1. Which providers in the first release?**
- (a) **OpenRouter + Anthropic + OpenAI + Google AI Studio + xAI**, then Mistral, DeepSeek and Groq
  as presets, then a custom endpoint. ← *recommended*. These are the five you named, and they need
  two new adapters.
- (b) All of them at once, including a custom endpoint: about two more days, plus the SSRF and
  unknown-price work.
- (c) OpenRouter only, but with the new menu and picker. OpenRouter already serves all of these
  providers' models through one key. Cheapest, but it isn't what you asked for.

**D2. How settings are saved.**
- (a) **Each change saves as it's made, with "✓ Saved" and Undo for model changes; keys only through
  "Check and save".** ← *recommended*. With a menu, a page-wide Save button gets lost between sections.
- (b) Keep a Save button per section, with a "you have unsaved changes" guard on leaving it.

**D3. Calls whose cost the provider doesn't report.**
- (a) **Estimate from tokens × the catalogue price and count it against the cap (shown "≈"). A
  model with no known price can't be picked until you type its price per million tokens (0 is fine
  for a free local model).** ← *recommended*. The cap then always means something.
- (b) Estimate where possible, and let unknown-price models run, shown as "unknown" and not counted.
  Simpler, but a custom or unmatched model would spend outside the cap.

**D4. How fine-grained the tasks are.**
- (a) **Keep three tasks (Proposing fields, Lore conversations, Concept art), each with its own
  model.** ← *recommended*, with "More: use a different model for…" holding optional overrides for
  writing help, characters and map exploring, added only if you find you want them.
- (b) Split Lore conversations into five slots now (Ask, writing help, characters, map exploring,
  comments). More control, but five pickers to fill before AI works, and five more ways to break.

---

## 5. Build plan (one engineer)

Phased so each phase ships on its own. Sizes are working days, including tests.

### Phase A: layout, deep links, saving, the picker (OpenRouter only), about 5 days

| Work | Where | Size |
|---|---|---|
| Nested routes `/settings/:group/:section`, a `SettingsNav` rendering as a rail (wide) or a list page (narrow), Back on the phone, `/settings` choosing the first section. Split `Settings.tsx` into one file per section under `pages/settings/` | `App.tsx`, `pages/settings/*`, `styles.css` | 1.5 |
| Per-control saving: a `useAutoSave` hook (PUT a subset, "✓ Saved", go back on error, Undo toast); inline validation; a styled textarea; the offline card for each section | `pages/settings/*`, `components/ui/*` | 1 |
| `ModelPicker` combobox: ARIA combobox and listbox, fuzzy filter, groups, tags, details panel, phone sheet, keyboard | `components/ModelPicker.tsx` | 2 |
| Richer model list: context, max output, input modalities, image output, reasoning, price per picture; the "fits the task" flag per task; `recommended.ts`; the art task's list from OpenRouter's image models | `ai/models.ts`, `packages/schema` ModelsResponse, `routes/settings.ts` | 0.5 |
| Error messages carry a deep link (`ApiError` gets an optional `href`); the client renders it as a link | `errors.ts`, the AI routes, `components/ui/Problem.tsx` | 0.5 |
| The log: human labels for tasks, model names, tokens, month switch, empty state | `routes/settings.ts`, `pages/settings/Spending.tsx` | (in the above) |

### Phase B: several providers, about 6 to 7 days

| Work | Where | Size |
|---|---|---|
| Settings schema v2: `ai.providers: [{ id, kind, label, baseUrl?, key: Encrypted, addedAt, check: { at, ok, message } }]`; `ai.models[task]: { provider, model } \| null`. **Migration on read**: the old `key` becomes an `openrouter` provider, and old model strings become `{ provider: "openrouter", model }` | `packages/schema` Settings, `state/settings.ts` | 1 |
| Split `AiProvider` into the cap, log and retry logic (kept) and a `Transport` interface: `chat(model, messages, schema)`, `image(model, prompt)`, `listModels()`, `check()`. `OpenRouterTransport` from today's code; `OpenAICompatibleTransport` (OpenAI, xAI, Gemini's OpenAI endpoint, presets); `AnthropicTransport` (Messages API, fixed form via a forced tool); Gemini pictures via `generateContent` | `ai/provider.ts`, `ai/transports/*` | 3 |
| Provider routes: `GET /api/ai/providers` (no keys, last four only), `POST /api/ai/providers` (kind, key, baseUrl, checked before storing), `POST /:id/check`, `PUT /:id/key`, `DELETE /:id` (refused while a task uses it, unless `?force` from the confirm dialog) | `routes/settings.ts` | 1 |
| Catalogue: per-provider lists merged and enriched from OpenRouter's public list via an id mapping; "Not checked" for unmatched; cached hourly per provider | `ai/models.ts` | 1 |
| Cost: the log gains `provider` and `costSource: "reported" \| "estimated" \| "unknown"` (old rows read as `openrouter` and `reported`); estimates from tokens × price; the cap counts reported and estimated; the Spending page groups by provider | `ai/log.ts`, `ai/provider.ts`, `routes/settings.ts` | 0.5 |
| The Providers section UI | `pages/settings/Providers.tsx` | 0.5 to 1 |

### Phase C: presets and a custom endpoint, about 2 days

Mistral, DeepSeek and Groq presets. "Other, OpenAI-compatible" with a base URL, the SSRF guard,
and a typed price per model (D3a).

### Tests (spread through the phases, about 2 days)

- Unit: migration v1→v2, each transport against a stub, cost source and cap arithmetic, key
  redaction in error text, the catalogue mapping.
- e2e (phone and desktop): navigate by the rail and the list, deep link from an AI error, pick a
  model with the keyboard, the offline list, add a key that fails then one that works.
  `apps/web/e2e/server.mjs` gains a second stand-in provider (Anthropic-shaped) beside the OpenRouter one.

**Total: about 15 days**, or 5 days for Phase A alone.

### Security (applies throughout)

- **Keys stay on the server.** They're stored encrypted with AES-256-GCM under `SECRETS_KEY`, as
  today (`state/secrets.ts`), one record per provider. No response ever contains a key, only the
  `keyLast4`, the source (settings or environment) and the check status. The browser holds a typed key
  only until "Check and save" returns, then clears the field. The field never lands in localStorage,
  the offline queue or the service worker (it's a `/api/` non-GET, which stage 15 already sends
  straight to the network).
- **Key checks happen on the server**, never from the browser to the provider. That also keeps keys
  out of browser history and extensions that watch requests.
- **Provider error text is redacted** before it's stored or shown: some providers echo part of the
  key. Strip anything that looks like the key or a common key pattern.
- **Logging**: keep request bodies out of Fastify's logs for `/api/ai/providers*` (add an explicit
  redact rule so a future log-level change can't leak them). Log lines never carry keys.
- **Custom base URL**: `https://` only, resolved and refused if private, loopback or link-local
  (reuse the image-fetch guard and its `IMAGE_FETCH_ALLOW_LOOPBACK` escape hatch for tests). No
  redirects followed.
- **The key routes** are session-only (as all settings routes are) and rate-limited, because a check
  is a network call to a third party.
- **Removing a provider** deletes its encrypted key from `settings.json`. Rotating `SECRETS_KEY`
  makes stored keys unreadable, so Providers shows them as "can't be read, enter it again" rather than
  failing quietly.
