import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { member, organization, session, user } from "../db/schema";

/**
 * Households are Better Auth organizations. Every person gets their own ("personal") household
 * the first time they sign in. Its slug is derived from the person's ID, so it's unique per person
 * and two requests racing to create it can't make two.
 */
const PERSONAL_SLUG_PREFIX = "personal-";

export function personalSlug(userId: string): string {
  return `${PERSONAL_SLUG_PREFIX}${userId}`;
}

/** "June Lee" → "June's kitchen". */
export function householdName(personName: string): string {
  const first = personName.trim().split(/\s+/)[0];
  return first ? `${first}'s kitchen` : "My kitchen";
}

async function findPersonalHousehold(db: Database, userId: string) {
  return db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, personalSlug(userId)))
    .get();
}

/** The person's own household, created if it doesn't exist yet. Returns its ID. */
export async function ensurePersonalHousehold(db: Database, userId: string): Promise<string> {
  const existing = await findPersonalHousehold(db, userId);
  if (existing) return existing.id;

  const person = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).get();
  if (!person) throw new Error(`No user ${userId}`);

  const id = crypto.randomUUID();
  const now = new Date();
  try {
    // One batch, so the household and its first member are created together or not at all.
    await db.batch([
      db.insert(organization).values({
        id,
        name: householdName(person.name),
        slug: personalSlug(userId),
        createdAt: now,
      }),
      db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: id,
        userId,
        role: "owner",
        createdAt: now,
      }),
    ]);
    return id;
  } catch (error) {
    // Another request created it first (the slug is unique): use theirs.
    const raced = await findPersonalHousehold(db, userId);
    if (raced) return raced.id;
    throw error;
  }
}

/** The person's role in a household, or undefined if they aren't a member. */
export async function membershipRole(
  db: Database,
  userId: string,
  householdId: string,
): Promise<string | undefined> {
  const row = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, householdId)))
    .get();
  return row?.role;
}

/**
 * The household a person works in: a shared household if they've joined one (phase G1), otherwise
 * their own, which is created if needed.
 */
export async function activeHouseholdFor(db: Database, userId: string): Promise<string> {
  const memberships = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .all();
  const shared = memberships.find((m) => !m.slug.startsWith(PERSONAL_SLUG_PREFIX));
  if (shared) return shared.id;
  return ensurePersonalHousehold(db, userId);
}

export interface HouseholdAccess {
  householdId: string;
  role: string;
}

/**
 * Answers "which household is this request for, and is the caller a member?". The session's
 * active household is used only if the caller really is a member of it; otherwise (an old
 * session, or one pointing anywhere else) the caller's own household is used and the session is
 * corrected. So a request can only ever reach a household the caller belongs to.
 */
export async function householdForSession(
  db: Database,
  userId: string,
  sessionId: string,
  activeHouseholdId: string | null | undefined,
): Promise<HouseholdAccess> {
  if (activeHouseholdId) {
    const role = await membershipRole(db, userId, activeHouseholdId);
    if (role) return { householdId: activeHouseholdId, role };
  }
  const householdId = await activeHouseholdFor(db, userId);
  await db
    .update(session)
    .set({ activeOrganizationId: householdId })
    .where(eq(session.id, sessionId));
  const role = await membershipRole(db, userId, householdId);
  if (!role) throw new Error(`User ${userId} is not a member of household ${householdId}`);
  return { householdId, role };
}

export interface HouseholdSummary {
  id: string;
  name: string;
  role: string;
  members: { name: string; isYou: boolean }[];
}

/** What the Account page shows. Call only with an access check from householdForSession. */
export async function householdSummary(
  db: Database,
  access: HouseholdAccess,
  userId: string,
): Promise<HouseholdSummary> {
  const household = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, access.householdId))
    .get();
  const members = await db
    .select({ userId: member.userId, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, access.householdId))
    .all();
  return {
    id: access.householdId,
    name: household?.name ?? "",
    role: access.role,
    members: members.map((m) => ({ name: m.name, isYou: m.userId === userId })),
  };
}
