import { z } from "zod";
import { ProjectRole } from "./projects.js";
import { AccountEmail } from "./people.js";

/**
 * Stage 27c: members, invite links and joining. Members are listed and changed by owners under
 * `/api/p/:project/members`; an invite link is made by an owner for one project and one role, and
 * is used by one person, once, within 7 days.
 */

/** How long an invite link works. */
export const INVITE_DAYS = 7;

/** The shortest and longest an invite code can be in an address; anything else is "unknown". */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

// ---- Members ---------------------------------------------------------------------------------

/** One row of the member list. */
export const MemberRow = z.object({
  id: z.string(),
  name: z.string(),
  /** Only owners are told members' emails; for anyone else it is null. */
  email: z.string().nullable(),
  role: ProjectRole,
  addedAt: z.string(),
  /** When the person last used the project (rough: kept to within a few minutes); null if never since. */
  lastActiveAt: z.string().nullable(),
  /** This row is the person asking. */
  you: z.boolean(),
});
export type MemberRow = z.infer<typeof MemberRow>;

/** `GET /api/p/:project/members` */
export const MembersResponse = z.object({
  members: z.array(MemberRow),
  /** Whether the person may change roles, remove people and make invitations (owners). */
  canManage: z.boolean(),
});
export type MembersResponse = z.infer<typeof MembersResponse>;

/** How many days a person's unsaved changes are kept in a project they have left or were removed from (stage 27d). */
export const AWAY_KEEP_DAYS = 30;

/**
 * `DELETE /api/p/:project/members/:id` and `POST /api/p/:project/members/leave` (stage 27d): how
 * many unsaved changes (entries, renames and the like) the person leaves in the project. They are
 * kept for `keptDays` days, restored if the person rejoins within them, and then removed.
 */
export const RemoveMemberResponse = z.object({
  ok: z.literal(true),
  unsavedKept: z.number().int().min(0),
  keptDays: z.number().int().min(0),
});
export type RemoveMemberResponse = z.infer<typeof RemoveMemberResponse>;

/** `PUT /api/p/:project/members/:id` */
export const ChangeRoleRequest = z.object({ role: ProjectRole });
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequest>;

// ---- Invitations (owner) ---------------------------------------------------------------------

/** `POST /api/p/:project/invites` */
export const CreateInviteRequest = z.object({ role: ProjectRole });
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

/** The answer to making a link: the only time the code is ever given. */
export const CreateInviteResponse = z.object({
  id: z.string(),
  /** The secret part. Shown once; the server keeps only a hash of it. */
  code: z.string(),
  /** The address of the join page: `/join/<code>`, as a path (prefix it with the app's address). */
  path: z.string(),
  /** The same as a full address, from the server's PUBLIC_URL. */
  url: z.string(),
  role: ProjectRole,
  expiresAt: z.string(),
});
export type CreateInviteResponse = z.infer<typeof CreateInviteResponse>;

/** One waiting invitation; never the code. */
export const InviteSummary = z.object({
  id: z.string(),
  role: ProjectRole,
  createdBy: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.string(),
  expiresAt: z.string(),
  /** Whole seconds left on the server's clock. */
  secondsLeft: z.number().int(),
});
export type InviteSummary = z.infer<typeof InviteSummary>;

/** `GET /api/p/:project/invites`: the links waiting (not used, cancelled or run out). */
export const InvitesResponse = z.object({ invites: z.array(InviteSummary) });
export type InvitesResponse = z.infer<typeof InvitesResponse>;

// ---- Joining (public) ------------------------------------------------------------------------

/** `GET /api/join/:code` for a link that works: what the join page shows. */
export const JoinInfo = z.object({
  project: z.object({
    name: z.string(),
    colour: z.number().int(),
    entries: z.number().int().nullable(),
    maps: z.number().int().nullable(),
    people: z.number().int(),
  }),
  inviter: z.object({ name: z.string() }),
  role: ProjectRole,
  /** Whether "Continue with Google" is offered. */
  google: z.boolean(),
  /** The person asking is logged in and already in this project (the link is then not needed). */
  alreadyMember: z.boolean(),
});
export type JoinInfo = z.infer<typeof JoinInfo>;

/** `POST /api/join/:code`: a new person joins with an email and a password. */
export const JoinPasswordRequest = z.object({
  name: z.string().trim().min(1, "Give a name.").max(80, "Use 80 characters or fewer."),
  email: AccountEmail,
  password: z.string().min(12, "Use at least 12 characters.").max(500),
});
export type JoinPasswordRequest = z.infer<typeof JoinPasswordRequest>;

/** `POST /api/join/:code/passkey/options`: the name and the email (every account has one). */
export const JoinPasskeyOptionsRequest = z.object({
  name: z.string().trim().min(1, "Give a name.").max(80, "Use 80 characters or fewer."),
  email: AccountEmail,
});
export type JoinPasskeyOptionsRequest = z.infer<typeof JoinPasskeyOptionsRequest>;

/** What a successful join answers: the session has started, and this is where to go. */
export const JoinedResponse = z.object({
  ok: z.literal(true),
  /** The project's address (its slug): open `/p/<slug>`. */
  project: z.string(),
  role: ProjectRole,
});
export type JoinedResponse = z.infer<typeof JoinedResponse>;

// ---- What is stored --------------------------------------------------------------------------

/**
 * An invitation as kept in `/data/state/invites.json`. The code itself is never stored, only a
 * SHA-256 of it (the code has far more entropy than any password, so a fast hash is enough).
 */
export const InviteRecord = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  role: ProjectRole,
  /** Hex SHA-256 of the code. */
  codeHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().optional(),
  usedBy: z.string().optional(),
  cancelledAt: z.string().datetime().optional(),
});
export type InviteRecord = z.infer<typeof InviteRecord>;

export const InvitesFile = z.object({
  version: z.literal(1).default(1),
  invites: z.array(InviteRecord).default([]),
});
export type InvitesFile = z.infer<typeof InvitesFile>;
