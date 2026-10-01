# Phase A1: Cloudflare and GitHub setup

These are the one-time settings that let GitHub deploy Fennl to your Cloudflare account. You do the clicking; nothing here involves code. It takes about 15 minutes.

You will end up with:

- a `workers.dev` subdomain (where preview links will live),
- a Cloudflare API token that can deploy Fennl and nothing else of importance,
- three settings stored in GitHub: two secrets and one variable,
- a passing "Cloudflare access check" on GitHub.

Checked against Cloudflare's docs on 2026-10-01. If a screen looks different from what is described here, tell me what you see.

## Step 1: Turn on Workers and choose a workers.dev subdomain

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the left sidebar, open **Compute (Workers)** then **Workers & Pages**. (On some accounts the sidebar just says **Workers & Pages**.)
3. If Cloudflare asks you to choose a `workers.dev` subdomain, pick something short and neutral, such as `terrastak` or `fennl`. Preview links will look like `pr-12-fennl.<your-subdomain>.workers.dev`. Testers may see it, so avoid anything you'd mind them seeing.
4. If it doesn't ask, the subdomain already exists. You can see it on the right side of the **Workers & Pages** overview page (look for "Subdomain").
5. The free Workers plan is fine for now. We'll talk about the $5/month paid plan only if a later phase needs it.

## Step 2: Copy your Account ID

1. Still on the **Workers & Pages** page, find the **Account Details** section and click the copy button next to **Account ID**.
   (Shortcut from any page: press `Ctrl+K`, or `Cmd+K` on a Mac, type `Copy account ID`, and pick the result.)
2. Paste it somewhere temporary (a note). You'll use it in Step 4.

## Step 3: Create the API token

1. Click your profile icon (top right) then **My Profile**, then **API Tokens** in the left menu.
2. Click **Create Token**.
3. Next to the **Edit Cloudflare Workers** template, click **Use template**.
4. The template already includes Workers, KV, R2, and route permissions. **Add one more row** for the database:
   - Click **+ Add more** under Permissions.
   - Choose **Account**, then **D1**, then **Edit**.
5. Under **Account Resources**, choose **Include** and select **your account** (not "All accounts").
6. Under **Zone Resources**, choose **Include**, **Specific zone**, **fennl.app**.
7. Leave **Client IP Address Filtering** empty. Optionally set **TTL** (an expiry date). If you set one, put a reminder in your calendar to replace the token before it expires.
8. Click **Continue to summary**, check that it lists your account and `fennl.app`, then **Create Token**.
9. **Copy the token now.** Cloudflare shows it only once. Don't paste it into chat, email, or any file. If you lose it, just delete it and make a new one.

## Step 4: Store the settings in GitHub

1. Open [github.com/terrastak/fennl](https://github.com/terrastak/fennl), then **Settings** (top bar), then in the left menu **Secrets and variables**, then **Actions**.
2. On the **Secrets** tab, click **New repository secret** twice:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the token from Step 3 |
   | `CLOUDFLARE_ACCOUNT_ID` | the Account ID from Step 2 |

3. Switch to the **Variables** tab and click **New repository variable**:

   | Name | Value |
   | --- | --- |
   | `APP_HOSTNAME` | `beta.fennl.app` |

   This is the **only** place the app's web address is stored. To move Fennl to another address later, you change this variable (and the new address must be on a domain in your Cloudflare account). No code changes.

## Step 5: Check that nothing is already using beta.fennl.app

Cloudflare can't attach Fennl to `beta.fennl.app` if that name already has a CNAME record.

1. In the Cloudflare dashboard, open **fennl.app**, then **DNS**, then **Records**.
2. Look for a record whose **Name** is `beta`. If there is one, tell me what it points to before deleting anything. If there isn't, you're done; Cloudflare creates the record itself on the first production deploy (phase A3).

The access check in Step 6 also looks for this.

## Step 6: Run the access check

1. Tell me you've finished Steps 1 to 5.
2. I re-run the **Cloudflare access check** on GitHub. (Or you can: on GitHub open **Actions**, pick **Cloudflare access check**, open its latest run, and click **Re-run all jobs**.)
3. It confirms, without deploying anything:
   - the token is valid and active,
   - it can see your account and its `workers.dev` subdomain,
   - it can manage D1 databases,
   - it can reach R2 (a warning only for now; R2 isn't needed until Stage D),
   - `APP_HOSTNAME` is set and its domain is one the token can manage,
   - no CNAME record is already sitting on that name.

When it's green with no errors, A1 is done.

## What's not in this phase

- No Worker is deployed yet and nothing appears at `beta.fennl.app`. That happens in A3.
- No Anthropic key or email service yet. Those come in E7 and B2.
- R2 may need to be switched on in the dashboard (Cloudflare can ask for a payment method even on the free allowance). That's dealt with in Stage D.
