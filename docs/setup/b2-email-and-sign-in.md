# Phase B2: email, Google and Apple sign-in setup

These are the one-time settings that let Fennl send account emails and offer "Continue with Google" and "Continue with Apple". You do the clicking; nothing here involves code. Allow about an hour, most of it in Apple's developer site.

**Do Steps 1 to 3 before merging the B2 pull request.** Production won't deploy without email, so nobody can create an account that can't be confirmed. Steps 4 and 5 (Google and Apple) can come later: the buttons appear on their own once the settings exist.

You will end up with:

- the Cloudflare **Workers Paid** plan,
- a Resend account sending from `mail.fennl.app`, with SPF, DKIM and DMARC records,
- new GitHub secrets: `RESEND_API_KEY`, and optionally `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`,
- a new GitHub variable: `EMAIL_FROM`.

Written on 2026-10-03 from Better Auth 1.7.7, Resend's and Better Auth's docs, and Apple's and Google's usual screens. Their consoles change often. If a screen looks different, tell me what you see.

In the steps below, **your app address** means the value of the `APP_HOSTNAME` variable, currently `beta.fennl.app`. If the address ever changes, the Google and Apple steps need the new address added too.

## Where secrets go

All secrets go in GitHub, never in chat, email or a file: [github.com/terrastak/fennl](https://github.com/terrastak/fennl) › **Settings** › **Secrets and variables** › **Actions**. Use the **Secrets** tab for secrets and the **Variables** tab for variables. GitHub hands them to Cloudflare on every deploy. Nobody can read a secret back from GitHub, not even you, so keep a copy in your password manager.

## Step 1: Switch Cloudflare Workers to the Paid plan ($5/month)

Fennl hashes passwords with scrypt, a deliberately slow method that makes stolen passwords expensive to crack. It needs about 90 milliseconds of processing per sign-in. The free Workers plan stops each request after 10 milliseconds, so sign-in and sign-up would fail on it.

1. In [dash.cloudflare.com](https://dash.cloudflare.com), open **Compute (Workers)** › **Workers & Pages** › **Plans** (or **Workers plans**).
2. Choose **Workers Paid** ($5 a month, which includes far more requests and database use than the beta needs).

## Step 2: Set up Resend to send account emails

1. Create an account at [resend.com](https://resend.com) (the free tier covers 3,000 emails a month, 100 a day).
2. Open **Domains** › **Add Domain**:
   - Enter `mail.fennl.app`. A subdomain keeps the reputation of Fennl's account emails separate from anything else you send from `fennl.app`.
   - **Region**: North America (`us-east-1`), unless most testers are elsewhere.
   - **Return-Path**: leave the default (`send`).
3. Choose **Sign in to Cloudflare** (automatic setup) and allow Resend to add its records. It adds three records to `fennl.app`: an MX and an SPF record named `send.mail`, and a DKIM record named `resend._domainkey.mail`.
   - If automatic setup isn't offered, copy each record into Cloudflare by hand (**DNS** › **Records** › **Add record** for `fennl.app`). Resend shows the exact values. In the Name field, enter only the part before `.fennl.app`.
4. Wait until Resend shows the domain as **Verified** (usually a few minutes).
5. In the domain's settings, check that **Click tracking** and **Open tracking** are **off**. Tracking rewrites links, which looks suspicious to mail filters and breaks the confirmation links.
6. Add a DMARC record in Cloudflare (**DNS** › **Records** › **Add record**):

   | Type | Name | Content |
   | --- | --- | --- |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` |

   `p=none` only asks mail providers to report problems; it doesn't block anything. If a DMARC record for `fennl.app` already exists, leave it alone and tell me.

   Optional: Cloudflare's free **DMARC Management** (in the `fennl.app` zone, under **Email**) can collect the reports for you. Turning it on adds a `rua=` address to this record.
7. Open **API Keys** › **Create API key**. Name it `fennl`, choose **Sending access**, and limit it to the `mail.fennl.app` domain. Copy the key (Resend shows it only once).

## Step 3: Store the email settings in GitHub

| Where | Name | Value |
| --- | --- | --- |
| Secrets | `RESEND_API_KEY` | the key from Step 2.7 |
| Variables | `EMAIL_FROM` | `Fennl <accounts@mail.fennl.app>` |

Replies to these emails go nowhere for now. Say if you'd like replies to reach a real inbox.

Preview links use the same email settings, so you can test sign-up on the B2 preview as soon as these are saved. Push any change, or ask me to, and the preview picks them up.

## Step 4 (optional for now): Sign in with Google

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project named **Fennl** (project picker at the top › **New project**).
2. Open **Google Auth Platform** (search for "OAuth consent" if you can't find it) and click **Get started**:
   - App name **Fennl**, and your email as the support email.
   - Audience: **External**.
   - Contact email: yours. Agree to the policy and **Create**.
3. In **Branding**, add `fennl.app` under **Authorized domains** and save.
4. In **Audience**, click **Publish app**, so anyone can sign in rather than only listed test users. Fennl asks only for name and email, which needs no Google review.
5. In **Clients**, click **Create client**:
   - Application type: **Web application**, name **Fennl web**.
   - **Authorized JavaScript origins**: `https://beta.fennl.app` (your app address).
   - **Authorized redirect URIs**: `https://beta.fennl.app/api/auth/callback/google`.
   - **Create**, then copy the **Client ID** and **Client secret**.
6. Store them in GitHub **Secrets** as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

"Continue with Google" appears on the beta site after the next deploy to production. It does **not** appear on preview links: Google accepts sign-ins only at addresses registered in step 5, and every preview has a different address.

## Step 5 (optional for now): Sign in with Apple

This needs a paid **Apple Developer Program** membership ($99 a year, [developer.apple.com/programs](https://developer.apple.com/programs/)). Joining can take a day or two for Apple to approve.

All of this is under **Certificates, Identifiers & Profiles** at [developer.apple.com/account](https://developer.apple.com/account).

1. **Team ID**: on the **Membership details** page, copy the 10-character **Team ID**.
2. **App ID**: **Identifiers** › **+** › **App IDs** › **App**:
   - Description **Fennl**, Bundle ID (explicit) `app.fennl`.
   - Tick **Sign In with Apple** under Capabilities. **Continue** › **Register**.
3. **Services ID** (this becomes `APPLE_CLIENT_ID`): **Identifiers** › **+** › **Services IDs**:
   - Description **Fennl web sign-in**, identifier `app.fennl.signin`. **Register**.
   - Open it again, tick **Sign In with Apple** and click **Configure**:
     - Primary App ID: **Fennl (app.fennl)**.
     - Domains and Subdomains: `beta.fennl.app`.
     - Return URLs: `https://beta.fennl.app/api/auth/callback/apple`.
   - **Next** › **Done** › **Continue** › **Save**.
   - If Apple asks you to verify the domain by uploading a file, tell me and I'll add the file to the app.
4. **Key**: **Keys** › **+**, name it **Fennl sign-in**:
   - Tick **Sign In with Apple**, click **Configure**, choose the **Fennl** App ID, and save.
   - **Continue** › **Register** › **Download**. You can download the `.p8` file **only once**; keep it in your password manager.
   - Copy the **Key ID** shown on that page.
5. **Email relay**: people can choose "Hide My Email", and Apple then forwards mail only from senders you register.
   - Open **Services** › **Sign in with Apple for Email Communication** › **Configure**.
   - Add the domain `mail.fennl.app` and the address `accounts@mail.fennl.app`.
   - Resend's SPF and DKIM records from Step 2 are what Apple checks.
6. Store these in GitHub **Secrets**:

   | Name | Value |
   | --- | --- |
   | `APPLE_CLIENT_ID` | `app.fennl.signin` (the Services ID) |
   | `APPLE_TEAM_ID` | from step 1 |
   | `APPLE_KEY_ID` | from step 4 |
   | `APPLE_PRIVATE_KEY` | open the `.p8` file in a text editor and paste **all** of it, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines |

Fennl creates the short-lived "client secret" Apple asks for from this key by itself, so there's nothing to renew every six months. Like Google, "Continue with Apple" appears on the beta site only, not on previews.

## Checking it worked

On the B2 preview link, as soon as Step 3 is saved:

1. Create an account with your own email. The confirmation email should arrive within a minute.
2. Send test sign-ups to a Gmail, an Outlook and an iCloud address, and check each one landed in the inbox, not spam.
3. In Gmail, open the email's **⋮** menu › **Show original**. **SPF**, **DKIM** and **DMARC** should all say **PASS**.
4. During the beta, glance at Resend's **Emails** page now and then. Bounced or complained-about emails show up there.

After merging, on the beta site: try "Continue with Google" and "Continue with Apple" (once Steps 4 and 5 are done).

## What happens behind the scenes

- On every deploy, GitHub Actions writes these values to a temporary file and uploads them to Cloudflare as Worker secrets (`--secrets-file`), then deletes the file.
- `BETTER_AUTH_SECRET`, which signs sign-in sessions, is generated by GitHub Actions and never stored in GitHub. Production creates it once and keeps it; previews get a new one on every push.
- If you remove a GitHub secret, Cloudflare keeps the last value. To really remove one, delete it in the Cloudflare dashboard as well (**Workers & Pages** › **fennl** › **Settings** › **Variables and Secrets**).
