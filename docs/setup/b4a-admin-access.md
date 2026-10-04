# Phase B4a: admin area setup (Cloudflare Access and your admin account)

These are the one-time settings that open the admin console, and only to you. Allow about 30 minutes. Nothing here involves code.

The admin console has three locks, one after another:

1. **Cloudflare Access**: Cloudflare asks for your identity before any Fennl code runs.
2. **A passkey** (or hardware security key) on a dedicated admin account. Passwords alone never open it.
3. **The admin role**: given only by a database command you run yourself (`docs/runbooks/grant-admin-role.md`). Nothing in the app can grant it.

Every admin sign-in and every new passkey is emailed to you and written to an audit log that can't be changed or deleted.

Until you finish these steps the admin area simply stays closed. Merging B4a without them is safe.

Written on 2026-10-03 from Cloudflare's docs. Cloudflare's Zero Trust screens change often; if something looks different, tell me what you see.

## Step 1: Choose the admin address

Pick an address on your domain that's different from the app's, for example **`admin.fennl.app`**. In Cloudflare, check that no DNS record already uses it (**fennl.app** › **DNS** › **Records**). Fennl creates it when it deploys.

## Step 2: Set up Cloudflare Zero Trust (free for up to 50 people)

1. In [dash.cloudflare.com](https://dash.cloudflare.com), open **Zero Trust** in the left sidebar.
2. If it's your first time, pick a **team name** (for example `fennl`) and the **Free** plan. Your team domain becomes **`<team name>.cloudflareaccess.com`**. You'll need it in Step 6.
3. Sign-in method: **One-time PIN** (Cloudflare emails you a code) is on by default and is enough. You can add Google later under **Settings** › **Authentication**.

## Step 3: Protect the admin address

1. **Zero Trust** › **Access controls** › **Applications** › **Create new application** › **Self-hosted and private** › **Add public hostname**.
2. Name: **Fennl admin**. Public hostname: your admin address from Step 1.
3. Add a policy: name **Owner only**, action **Allow**, include **Emails** = your own email address. (Add others only if they should ever reach the admin area.)
4. Session duration: **8 hours** (matches Fennl's own admin session limit).
5. Save. Then open the application again and copy its **Application Audience (AUD) Tag** (a long string of letters and numbers, on the application's overview page).

## Step 4: Protect the preview links

Preview links now hold real sign-ups, so they go behind Access too (decided for B4a).

1. **Workers & Pages** › **fennl-preview** › the **Access** tab › **Protect this Worker behind Access**.
2. Choose **All traffic**, and for the policy, allow your own email (as in Step 3). Select **Apply Access**.
3. This creates an Access application for the preview Worker. Find it under **Zero Trust** › **Access controls** › **Applications** and copy its **AUD Tag**.

## Step 5: Let GitHub's checks through the preview lock

GitHub checks each preview after building it, so it needs a key of its own.

1. **Zero Trust** › **Access controls** › **Service credentials** › **Service Tokens** › **Create Service Token**. Name it **fennl-ci** and choose a long duration (and a calendar reminder to renew it).
2. Copy the **Client ID** and the **Client Secret** (shown only once).
3. Open the preview Worker's Access application (Step 4) and add a second policy: action **Service Auth**, include **Service Token** = **fennl-ci**.

## Step 6: Store the settings in GitHub

[github.com/terrastak/fennl](https://github.com/terrastak/fennl) › **Settings** › **Secrets and variables** › **Actions**:

| Where | Name | Value |
| --- | --- | --- |
| Variables | `ADMIN_HOSTNAME` | your admin address, e.g. `admin.fennl.app` |
| Variables | `ACCESS_TEAM_DOMAIN` | `<team name>.cloudflareaccess.com` |
| Variables | `ACCESS_AUD_ADMIN` | the AUD tag from Step 3 |
| Variables | `ACCESS_AUD_PREVIEW` | the AUD tag from Step 4 |
| Variables | `ADMIN_ALERT_EMAIL` | where sign-in alerts go (your own email) |
| Secrets | `CF_ACCESS_CLIENT_ID` | from Step 5 |
| Secrets | `CF_ACCESS_CLIENT_SECRET` | from Step 5 |

The next deploy to production picks these up and creates the admin address.

## Step 7: Create your admin account and passkey

Use a **separate account** for admin work, not your everyday one.

1. On the app (beta.fennl.app), create an account with an email address used for nothing else (for example a `+admin` version of yours, if your email provider supports that). Confirm it.
2. Give it the admin role with the database command in `docs/runbooks/grant-admin-role.md`.
3. Open your admin address. Cloudflare Access asks for your email and sends you a code.
4. Fennl's admin sign-in appears. Choose **Sign in with password** with the admin account, then **Add a passkey**. Your phone or computer asks you to confirm (Face ID, fingerprint or PIN), or use a hardware security key.
5. The console opens, and you get an email about the sign-in and the new passkey.
6. Choose **Add a backup passkey** and add a second one on another device or security key, so losing one doesn't lock you out.

From now on, the admin area only opens with one of those passkeys. Admin sessions end after 30 minutes without use, and after 8 hours at most.

For previews, do Step 7 on the preview link's `/admin` page. Previews have their own database, so the role is granted there separately (the runbook covers both).

## If something goes wrong

- **Lost all passkeys**: see "Remove an admin's passkeys" in the runbook, then repeat Step 7.4.
- **An alert you don't recognise**: change the admin account's password, remove its passkeys (runbook), and tell me.
