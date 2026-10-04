# Runbook: granting and removing the admin role

The admin role is granted **only** by a direct database command, never from inside the app (`CLAUDE.md`, "Admin console"). These commands run in the Cloudflare dashboard's D1 console.

**Production database:** `fennl`. **Preview database:** `fennl-preview`. Double-check which one you've opened.

## Open the console

1. [dash.cloudflare.com](https://dash.cloudflare.com) › **Storage & Databases** › **D1 SQL Database**.
2. Choose the database, then the **Console** tab.
3. Paste a command, replace the email address, and run it.

## Grant the admin role

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'you+admin@example.com';
```

Check it worked (this lists every admin):

```sql
SELECT email, role FROM "user" WHERE role = 'admin';
```

The account must already exist (sign up and confirm the email first).

## Before the first admin exists: open sign-up for a minute

Sign-up is invite-only during the beta (phase B5), and invite codes are made in the admin console. To create the very first admin account, open sign-up from the database, create and confirm the account, then close it again:

```sql
UPDATE app_setting SET value = 'false' WHERE key = 'sign_up_requires_code';
```

After the account exists:

```sql
UPDATE app_setting SET value = 'true' WHERE key = 'sign_up_requires_code';
```

From then on, use the admin console's **Sign-up** switch, which records each change in the audit log.

## Remove the admin role

Remove the role, then end every session that account has:

```sql
UPDATE "user" SET role = NULL WHERE email = 'you+admin@example.com';
```

```sql
DELETE FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = 'you+admin@example.com');
```

## Remove an admin's passkeys (lost device, or something suspicious)

```sql
DELETE FROM passkey WHERE user_id = (SELECT id FROM "user" WHERE email = 'you+admin@example.com');
```

```sql
DELETE FROM session WHERE user_id = (SELECT id FROM "user" WHERE email = 'you+admin@example.com');
```

Then sign in to the admin area with the account's password and add a passkey again (setup guide, Step 7.4). If you suspect someone else knew the password, reset it first.

## The audit log

The database records every role change and every removal of an admin's passkeys in the admin audit log by itself, so they show up in the console's activity list. (These rows aren't copied to the locked R2 bucket, since the database can't write there; Cloudflare also keeps its own record of dashboard activity.) The admin audit log itself can't be changed or deleted: `admin_audit_log` refuses updates and deletes, and each entry is also stored in the `fennl-audit` R2 bucket, locked for a year.
