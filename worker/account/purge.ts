import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { account, emailChange, organization, premiumGrant, promoCode, user } from "../db/schema";
import { personalSlug } from "../household/household";

// Removing accounts whose email was never verified (phase B7a). Usually a mistyped address: the
// account can't be signed in to, shows up in admin searches, and holds the address so its real
// owner couldn't sign up with it. A Cron Trigger runs this every hour (worker/index.ts).

/** How long a new account has to verify its email before it's removed. */
export const UNVERIFIED_ACCOUNT_HOURS = 24;

/**
 * The accounts to remove: made with email and password, never verified, older than the cutoff.
 * Accounts that also sign in with Google or Apple, admins, and accounts with a waiting email
 * change (support may be fixing a mistyped address) are left alone.
 */
function doomed(cutoff: Date, now: Date): SQL {
  return sql`select ${user.id} from ${user}
    where ${user.emailVerified} = 0
      and ${user.createdAt} < ${cutoff.getTime()}
      and coalesce(${user.role}, '') <> 'admin'
      and not exists (
        select 1 from ${account}
        where ${account.userId} = ${user.id} and ${account.providerId} <> 'credential'
      )
      and not exists (
        select 1 from ${emailChange}
        where ${emailChange.userId} = ${user.id}
          and ${emailChange.completedAt} is null
          and ${emailChange.cancelledAt} is null
          and ${emailChange.expiresAt} > ${now.getTime()}
      )`;
}

/**
 * Removes them, with everything that's theirs: their personal household (and with it any Premium
 * from a code), sessions and devices. A code they signed up with gets its use back, so the person
 * can sign up again with the same code. One batch, so it's all or nothing; each statement
 * re-checks the same conditions, so an account verified meanwhile is left whole.
 * Returns the removed accounts' email addresses.
 */
export async function removeUnverifiedAccounts(db: Database, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_HOURS * 60 * 60 * 1000);
  const ids = doomed(cutoff, now);
  const [, , removed] = await db.batch([
    db
      .update(promoCode)
      .set({
        uses: sql`max(${promoCode.uses} - (
          select count(*) from ${premiumGrant}
          where ${premiumGrant.promoCodeId} = ${promoCode.id} and ${premiumGrant.userId} in (${ids})
        ), 0)`,
      })
      .where(
        sql`${promoCode.id} in (
          select ${premiumGrant.promoCodeId} from ${premiumGrant}
          where ${premiumGrant.userId} in (${ids})
        )`,
      ),
    db
      .delete(organization)
      .where(
        sql`${organization.slug} in (select ${personalSlug("")} || doomed.id from (${ids}) as doomed)`,
      ),
    db
      .delete(user)
      .where(sql`${user.id} in (${ids})`)
      .returning({ email: user.email }),
  ]);
  return removed.map((row) => row.email);
}
