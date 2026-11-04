# Phase U14: knowing when emails don't arrive

Until U14, Fennl only knew whether Resend *took* an email. Now Resend tells Fennl what happened next (delivered, delayed, bounced, marked as spam), so "Check your email" can say when a sign-up link bounced and let the person fix a mistyped address, and a notice appears in the app when someone's address stops working. That needs two one-time settings in Resend and GitHub. You do the clicking; nothing here involves code. Allow about 15 minutes.

You will end up with:

- a **webhook** in Resend: Resend calls Fennl each time something happens to an email,
- a second Resend API key, `fennl-unblock`, with **Full access**, used only to take an address off Resend's blocked list when someone says "This address is right",
- two new GitHub secrets: `RESEND_WEBHOOK_SECRET` and `RESEND_MANAGE_KEY`.

Written on 2026-11-04 from these pages:

- Adding a webhook: [resend.com/docs/webhooks/create-webhook](https://resend.com/docs/webhooks/create-webhook.md)
- The events Resend sends: [resend.com/docs/webhooks/event-types](https://resend.com/docs/webhooks/event-types.md)
- Where the signing secret is: [resend.com/docs/webhooks/verify-webhooks-requests](https://resend.com/docs/webhooks/verify-webhooks-requests.md)
- Retries, and an endpoint Resend turns off: [resend.com/docs/webhooks/retries-and-replays](https://resend.com/docs/webhooks/retries-and-replays.md)
- Creating an API key: [resend.com/docs/create-an-api-key](https://resend.com/docs/create-an-api-key.md)
- The blocked list: [resend.com/docs/dashboard/emails/email-suppressions](https://resend.com/docs/dashboard/emails/email-suppressions.md)
- Test addresses: [resend.com/docs/dashboard/emails/send-test-emails](https://resend.com/docs/dashboard/emails/send-test-emails.md)
- GitHub secrets: [docs.github.com, "Using secrets in GitHub Actions"](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- Re-running a workflow: [docs.github.com, "Re-running workflows and jobs"](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)

If a screen looks different from these steps, tell me what you see: the page's title, the buttons on it, and which step you were on.

In the steps below, **your app address** means the value of the `APP_HOSTNAME` variable, currently `beta.fennl.app`.

## When to do it

**Best before merging the U14 pull request.** The secrets reach Cloudflare only when the beta site is deployed, and merging deploys it. If you've already merged, do the steps anyway and finish with Step 4.

Until both are done, Fennl works as before: emails still go out, but nothing is known about what happened to them, and no notices appear.

## Where secrets go

As in B2: [github.com/terrastak/fennl](https://github.com/terrastak/fennl) › **Settings** › (in the sidebar's "Security" section) **Secrets and variables** › **Actions** › the **Secrets** tab › **New repository secret**. Type the **Name** exactly as given, paste the value into **Secret**, and click **Add secret**. Nobody can read a secret back from GitHub, so keep a copy in your password manager.

## Step 1: Add the webhook in Resend

1. Sign in to [resend.com](https://resend.com) and open the [Webhooks page](https://resend.com/webhooks).
2. Click **Add Webhook**.
3. In the address box, enter your app address followed by `/api/email/events`:

   `https://beta.fennl.app/api/email/events`

4. Choose these seven events, and only these:

   | Event | What it tells Fennl |
   | --- | --- |
   | `email.delivered` | the email reached the person's mail server |
   | `email.delivery_delayed` | it's taking longer than usual |
   | `email.bounced` | the mail server refused it (a wrong address, a full mailbox...) |
   | `email.complained` | the person marked it as spam |
   | `email.failed` | Resend couldn't send it at all |
   | `email.suppressed` | Resend skipped it because the address is on its blocked list |
   | `suppression.added` | Resend put an address on its blocked list |

   Leave the others off. `email.opened` and `email.clicked` stay off in particular: Fennl doesn't track opens or clicks (B2).

5. Click **Add**.

## Step 2: Copy the signing secret into GitHub

The signing secret lets Fennl check that each call really comes from Resend; anything else is refused.

1. On the Webhooks page, click the webhook you just added to open its details page.
2. Find its **signing secret**. It starts with `whsec_`. Copy all of it, including `whsec_`.
3. In GitHub, add it as a secret (see "Where secrets go"):

   | Name | Value |
   | --- | --- |
   | `RESEND_WEBHOOK_SECRET` | the signing secret, starting with `whsec_` |

## Step 3: Create the unblocking key

When an email to an address bounces or is marked as spam, Resend adds the address to its own blocked list and skips every later email to it, password resets included. When someone says "This address is right", Fennl takes their address off that list so the next email is tried again. That needs a key with **Full access**; Fennl's sending key (`fennl`, from B2) can only send, and stays that way.

1. Open Resend's [API keys page](https://resend.com/api-keys).
2. Click **Create API Key**.
3. Name it `fennl-unblock`.
4. For the permission, choose **Full access**. (There's no domain choice for a Full access key; that's only offered for Sending access.)
5. Create it and copy the key. It starts with `re_`. **Resend shows it only once.**
6. In GitHub, add it as a secret:

   | Name | Value |
   | --- | --- |
   | `RESEND_MANAGE_KEY` | the `fennl-unblock` key |

Full access can change anything in the Resend account, so Fennl uses this key in one place only (taking one address off the blocked list), never to send, and never writes it to a log or an error. If you ever think it has leaked: on the API keys page, click the key's **More options** button › **Remove API key**, then create a new one and replace the GitHub secret.

## Step 4: Get the secrets to the beta site

- **Not merged yet:** merge the U14 pull request. Its deploy picks up both secrets.
- **Already merged:** on GitHub open **Actions** › **CI**, open the newest run on `main`, click **Re-run all jobs** (top right), then **Re-run jobs**. When it finishes, the beta site has both secrets.

Pull-request previews never get these two secrets: Resend calls only the beta address, and a preview must never take a real address off the blocked list. Try it on the beta site.

## Checking it worked

Resend gives test addresses that act out a bounce without harming Fennl's sending reputation, which a made-up address could. Each takes a label after `+`, so every try can use a fresh one.

1. In the admin console, under **Invite and promo codes**, make (or reuse) a code that **can be used to create an account (an invite)**.
2. In a private window, open the beta site and sign up with the code and the address `bounced+fennl1@resend.dev` (use `fennl2`, `fennl3`... for later tries).
3. Stay on "Check your email". Within a minute or two it should change to "We couldn't deliver the link to bounced+fennl1@resend.dev. Check the address.", with a box to type the right one.
4. Type an address of your own that has no Fennl account yet. Your usual one already has an account, so add `+test` before the `@` (for example `yourname+test@gmail.com`; Gmail, iCloud and Outlook deliver it to your usual inbox). Click **Send the link there**. The page should say "We sent a new link to" that address, and the email should arrive.
5. Opening that link finishes signing up the test account. If you'd rather not keep a test account, don't open it: an account that's never confirmed is removed by itself after 24 hours, and the code's use comes back.
6. In Resend, open the [Webhooks page](https://resend.com/webhooks) and click the webhook: the events from these emails should be listed as delivered to Fennl, not failed.

If step 3 never changes, check the webhook's list of events in Resend. If they show as failed, tell me what the event's details say Fennl answered (a number such as 401 or 404).

## If something goes wrong later

- **Resend turned the webhook off.** If Fennl's address keeps failing, Resend turns the webhook off and emails your team. Once I've fixed what's wrong, turn it back on from the [Webhooks page](https://resend.com/webhooks). Events that failed can be sent again: open the webhook, open the event, and click **Replay**.
- **A new signing secret.** If you ever make Resend replace the webhook's signing secret, put the new one in the `RESEND_WEBHOOK_SECRET` secret and re-run the deploy (Step 4).
- **An address still blocked.** Resend's blocked list is on its [Suppressions page](https://resend.com/emails/suppressions). "This address is right" in Fennl takes the person's own address off it, once a day. If that address bounces or is marked as spam again, Resend blocks it again by itself, and the notice comes back.

## What happens behind the scenes

- Fennl keeps a record of each email it sends to an account for 90 days: what kind it is (sign-up link, password reset, photo reminder...), the address, when it was sent and what happened to it, with the mail server's reason when it bounced. Never the email's words. The hourly job removes older records. The privacy policy (H2) must say so.
- Resend may send the same event twice, or out of order; Fennl keeps only the newest news for each email.
- Fennl answers every checked call from Resend, even events it doesn't use, so Resend doesn't keep retrying them. A call that isn't signed with the secret is refused.
- A notice across the app appears when an email to the account's current address bounced for good, was marked as spam, or was skipped by Resend's blocked list. A delayed email or a temporary bounce never raises it. It goes when the person changes their address, says the address is right, or the next email to it is delivered.
- "Forgot password" never says whether its email bounced, so it can't be used to find out who has an account. The admin console will show it (U15).
- As with every secret, if you remove one from GitHub, Cloudflare keeps the last value. To really remove one, delete it in the Cloudflare dashboard as well (**Workers & Pages** › **fennl** › **Settings** › **Variables and Secrets**).
