# Admin area setup: Cloudflare Access and your admin accounts

This sets up the admin console on the **beta site** and on **preview links**, and creates your admin account on each. Allow about 45 minutes. There's no code to write.

Rewritten on 2026-10-06 from Cloudflare's current docs and from what's already set up on your account. Cloudflare renames screens often; if a step looks different, tell me what you see.

## How it fits together

The admin console has three locks, one after another:

1. **Cloudflare Access.** Cloudflare asks who you are before any Fennl code runs.
2. **A passkey** (Face ID, fingerprint, PIN, or a hardware key) on a separate admin account. A password alone never opens it.
3. **The admin role.** You give it with a database command. Nothing in the app can give it.

There are **two separate sites**, each with its own database. Each needs its own admin account:

| | Beta site | Preview links |
| --- | --- | --- |
| App address | `beta.fennl.app` | a new link per pull request, like `pr-15-fennl-preview.terrastak.workers.dev` |
| Admin console | `terra.fennl.app` (the `ADMIN_HOSTNAME` you chose) | the same preview link, then `/admin` |
| Database (D1) | `fennl` | `fennl-preview` (shared by all previews) |
| Behind Access | only the admin address | the whole preview, app included |
| Passkey | one for `terra.fennl.app` | one for all preview links |

Your preview account and passkey keep working on every new preview link, because all previews share one database.

**Settings that are already right** (checked 2026-10-06), so you don't need to redo them:

- Zero Trust is set up. Your team domain is `terrastak.cloudflareaccess.com`.
- The preview Worker (`fennl-preview`) is behind Access.
- GitHub variables `APP_HOSTNAME` (`beta.fennl.app`), `ADMIN_HOSTNAME` (`terra.fennl.app`) and `ACCESS_TEAM_DOMAIN`.

**What's still missing:**

- An Access application for `terra.fennl.app`. Today the address works, but Fennl refuses the admin pages because Access isn't in front of it.
- `ACCESS_AUD_ADMIN` holds an ID with dashes. It needs the application's **AUD tag**: 64 letters and numbers, with no dashes.
- `ADMIN_ALERT_EMAIL` is empty.

## Part A: One policy for you

A policy says who may pass Access. You'll make one and use it everywhere.

1. [dash.cloudflare.com](https://dash.cloudflare.com) › **Zero Trust**. (It may open as "Cloudflare One".)
2. **Access controls** › **Policies** › **Add a policy**.
3. Fill it in:
   - **Policy name:** `Fennl owner`
   - **Action:** **Allow**
   - **Session duration:** **8 hours**
   - **Add include:** selector **Emails**, value: the email address you sign in to Cloudflare with
4. Select **Save**.

When Access asks who you are, it offers **Cloudflare** (sign in with your Cloudflare account) by default. Use that, with the same email as in the policy.

## Part B: The admin address on the beta site

### B1. Put Access in front of `terra.fennl.app`

1. **Zero Trust** › **Access controls** › **Applications**.
2. If there's an application from an earlier try that isn't `fennl-preview`'s, open it and check its address. If it isn't exactly `terra.fennl.app`, delete it. Nothing depends on it yet.
3. **Create new application** › **Self-hosted and private** › **Add public hostname**:
   - **Subdomain:** `terra`
   - **Domain:** `fennl.app`
   - **Path:** leave empty
4. Fill in the rest:
   - **Application name** (if asked): `Fennl admin`
   - **Access policies:** select **Fennl owner**
   - **Session duration:** **8 hours**
5. Select **Create**.

Don't use the **Access** tab on the `fennl` Worker (Workers & Pages › fennl). That would put the whole beta site, app included, behind Access.

### B2. Copy its AUD tag

1. In **Access controls** › **Applications**, select **Configure** on **Fennl admin**.
2. Open **Additional settings** (on some screens it's under **Overview**).
3. Copy the **Application Audience (AUD) Tag**. It's 64 letters and numbers with **no dashes**, for example `3f60b49da7caa0918675f1254fb81b253f14cb55c66fb65330904d4158834cb9`. The shorter value with dashes is the application's ID; don't use that one.

## Part C: The preview links

### C1. A key for GitHub's checks

After building each preview, GitHub checks that it answers. Now that previews are behind Access, GitHub needs its own key.

1. **Zero Trust** › **Access controls** › **Service credentials** › **Service Tokens** › **Create Service Token**.
2. Name: `fennl-ci`. **Service Token Duration:** the longest offered (**Non-expiring** if it's there). If it does expire, add a calendar reminder.
3. **Generate token**. Copy the **Client ID** and the **Client Secret** straight into GitHub (Part D). The secret is shown only once.

### C2. Let that key through the preview lock

1. **Access controls** › **Applications** › the application for **fennl-preview**. It was made when you protected the preview Worker, and its name mentions `fennl-preview`. Select **Configure**.
2. **Policies** › **Add a policy** (or **Create new policy**):
   - **Policy name:** `GitHub checks`
   - **Action:** **Service Auth**
   - **Add include:** selector **Service Token**, value **fennl-ci**
3. Save. Keep the policy that lets you in (**Fennl owner**, or "members of this Cloudflare account" if you chose that when protecting the Worker). Either one works.
4. Copy this application's **AUD tag**, as in B2. It should start with `3f60b49d`.

## Part D: GitHub settings

[github.com/terrastak/fennl](https://github.com/terrastak/fennl) › **Settings** › **Secrets and variables** › **Actions**. Set or fix these. Values are pasted exactly, with no spaces and no `https://`:

| Tab | Name | Value |
| --- | --- | --- |
| Variables | `ACCESS_AUD_ADMIN` | the AUD tag from B2 (64 characters, no dashes) |
| Variables | `ACCESS_AUD_PREVIEW` | the AUD tag from C2 |
| Variables | `ADMIN_ALERT_EMAIL` | your own email (admin sign-in alerts go there) |
| Secrets | `CF_ACCESS_CLIENT_ID` | the Client ID from C1 |
| Secrets | `CF_ACCESS_CLIENT_SECRET` | the Client Secret from C1 |

Already set, leave as they are: `ADMIN_HOSTNAME` = `terra.fennl.app`, `ACCESS_TEAM_DOMAIN` = `terrastak.cloudflareaccess.com`.

## Part E: Put the settings to work

The sites read these settings when they're deployed, so they need one more deploy:

- **Beta site:** **Actions** › **CI** › the newest run on `main` › **Re-run all jobs**. Merging the next pull request does the same.
- **Previews:** the next preview build picks them up, on any push to an open pull request.

**Check:** open `https://terra.fennl.app/admin`.

1. Cloudflare asks you to sign in. Use your Cloudflare account.
2. Fennl's admin **Sign in** page appears.

If you see "The admin area is closed" instead, the AUD tag or the deploy is the problem. Tell me, and I can check from here.

## Part F: Your admin account on the beta site

Use a **separate account** for admin work, not your everyday one. For example, a `+admin` version of your email, if your provider supports it.

Sign-up is invite-only, and invite codes are made in the admin console, which needs this admin account first. So you open sign-up for a minute from the database.

1. **Open sign-up:**
   1. [dash.cloudflare.com](https://dash.cloudflare.com) › **Storage & Databases** › **D1 SQL Database** › **fennl** › **Console**.
   2. Run:

      ```sql
      UPDATE app_setting SET value = 'false' WHERE key = 'sign_up_requires_code';
      ```

2. **Create the account:** on `https://beta.fennl.app/sign-up`, create the admin account, and confirm it from the email.
3. **Close sign-up again** (same console):

   ```sql
   UPDATE app_setting SET value = 'true' WHERE key = 'sign_up_requires_code';
   ```

4. **Give it the admin role** (same console, with your admin email):

   ```sql
   UPDATE "user" SET role = 'admin' WHERE email = 'you+admin@example.com';
   ```

5. **Add your passkey:**
   1. Open `https://terra.fennl.app/admin`, and pass the Cloudflare sign-in.
   2. Choose **Sign in with password**, with the admin account.
   3. Choose **Add a passkey**. Your phone or computer asks you to confirm, or you use a hardware key.
6. The console opens, and the alert email arrives once `ADMIN_ALERT_EMAIL` is set.
7. Choose **Add a backup passkey** and add a second one on another device or key, so losing one doesn't lock you out.

From now on, only those passkeys open the beta site's admin console. Admin sessions end after 30 minutes without use, and after 8 hours at most.

## Part G: Your admin account on the previews

The same steps with the preview database, once a preview has been built after Part D:

1. **Open sign-up:** D1 console for **fennl-preview**, the same `UPDATE app_setting … 'false'` command.
2. **Create the account:** open the newest preview link (from the pull request's comment). Pass the Cloudflare sign-in, go to `/sign-up`, create the admin account and confirm it.
3. **Close sign-up again:** the `… 'true'` command, in **fennl-preview**.
4. **Give it the admin role:** the `UPDATE "user" SET role = 'admin' …` command, in **fennl-preview**.
5. **Add your passkey:** open the preview link plus `/admin`, choose **Sign in with password**, then **Add a passkey**.

This preview passkey works on every future preview link. It's separate from your beta-site passkey.

## If something goes wrong

- **Cloudflare says "That account does not have access"**: the email you signed in with isn't the one in the **Fennl owner** policy.
- **"The admin area is closed"** after the Cloudflare sign-in: the AUD tag in GitHub doesn't match the application, or the site hasn't been deployed since Part D.
- **A pull request's "preview" check fails at "Check the preview responds"**: GitHub's key isn't getting through. Check C2 (the Service Auth policy) and the two `CF_ACCESS_…` secrets.
- **Lost all passkeys**: see "Remove an admin's passkeys" in `docs/runbooks/grant-admin-role.md`, then add a new one (F5 or G5).
- **An alert you don't recognise**: change the admin account's password, remove its passkeys (runbook), and tell me.
