# AI import: the Anthropic key, spending limits and the model comparison

Phase E7 builds the AI layer that later phases use to read handwritten cards, cookbook pages, screenshots, PDFs and web pages without recipe data. It needs an Anthropic API key, which only the Worker ever holds. There's no code to write.

Written on 2026-10-13 from these pages:

- Creating a key: [platform.claude.com/docs/en/get-api-key](https://platform.claude.com/docs/en/get-api-key)
- Spend limits: [platform.claude.com/docs/en/api/rate-limits](https://platform.claude.com/docs/en/api/rate-limits) ("Setting your own spend limit")
- Prices: [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- GitHub secrets: [docs.github.com, "Using secrets in GitHub Actions"](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- Running a workflow by hand: [docs.github.com, "Manually running a workflow"](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

If a screen looks different from these steps, tell me what you see.

## What it costs, and what stops it running away

Decided 2026-10-12. Every import is read by Claude Haiku first. If its answer looks wrong (it marks something unsure, a part is missing, or amounts don't add up), Claude Sonnet reads it once more, automatically. On the review screen, **Read again more carefully** has the next stronger model read it once more, once per import.

Estimated cost: about 0.5 cents per recipe read by Haiku alone, about 14 cents by Sonnet, so about 2 to 9 cents a recipe depending on how often Sonnet is needed. The model comparison (Part D) measures the real figures.

| Limit | Applies to | Starting value | Where it's changed |
| --- | --- | --- | --- |
| AI imports per month | Each household | 300 (Premium), 0 (Free) | Admin console › Plan limits |
| Hidden cost backstop per month | Each household | $15 (Premium) | Admin console › Plan limits (in cents) |
| Email alert to you | All of Fennl | $50 a month | Admin console › AI imports |
| Pause AI imports for everyone | All of Fennl | $150 a month | Admin console › AI imports |
| Anthropic's own spend limit | Your Anthropic account | Set in Part B | Claude Console |

Months are calendar months, in UTC. The alert and pause emails go to the address in the `ADMIN_ALERT_EMAIL` variable, once a month each.

## Part A: Create the API key

1. Go to [platform.claude.com](https://platform.claude.com/) and sign in, or create an account.
2. Go to **Settings → API keys** ([platform.claude.com/settings/keys](https://platform.claude.com/settings/keys)).
3. Click **Create key**, then:
   - Name it `fennl`.
   - Choose an expiration. If you choose one, put a reminder in your calendar a week before it ends; I'll help you swap in a new key.
   - Set **Linked account**. Anthropic recommends a service account for anything that runs on its own, so choose one if the menu offers it. Otherwise choose yourself.
   - Leave the workspace as it is.
4. Copy the key. It starts with `sk-ant-`, and the Console shows it only once. Put it in your password manager.

If **Create key** is greyed out, your account's role can't create keys; tell me what the page says.

## Part B: Set Anthropic's own spend limit (a last backstop)

Fennl pauses AI imports at $150 a month on its own estimate. Anthropic can also stop the key at a monthly amount you choose, in case Fennl's estimate were ever wrong.

1. Go to **Settings > Billing** ([platform.claude.com/settings/billing](https://platform.claude.com/settings/billing)).
2. In the **Spend limits** section, click **Set limit** (or **Adjust limit** if one is already set).
3. Enter **200** (dollars a month), a little above Fennl's pause, and save.

The Billing page is also where Anthropic takes payment for API use. If it asks you to add a payment method or buy credits before the key works, do that there.

## Part C: Give the key to Fennl

1. On GitHub, open [github.com/terrastak/fennl](https://github.com/terrastak/fennl) and click **Settings**.
2. In the sidebar's **Security** section, click **Secrets and variables**, then **Actions**.
3. On the **Secrets** tab, click **New repository secret**.
4. **Name**: `ANTHROPIC_API_KEY`. **Secret**: paste the key. Click **Add secret**.

The next deploy hands it to the Worker. Previews get it too: they have their own database, so their own monthly limits and their own pause.

## Part D: Run the model comparison

This reads the quality test set three ways (Haiku alone, Sonnet alone, and Haiku with Sonnet when needed) and reports accuracy and cost side by side. It calls the real API, so each run costs money. It runs only when you start it, never on its own or for a pull request.

The form has a box for what to read:

- `photos` (the default): the cards, cookbook pages, screenshots and PDFs. About a dollar.
- `web`: the web pages with their recipe data left out, read from the page's text as Fennl reads a blog without recipe data (phase E8). About another dollar.
- `all`: both, about two dollars.

1. On GitHub, click the **Actions** tab.
2. In the left sidebar, click **AI model comparison**.
3. Click **Run workflow**, leave the branch as `main` and the models blank, pick what to read, and click **Run workflow**.
4. When the run finishes (a few minutes), open it. The report is on its summary page.

The more handwritten cards the test set has, the more the comparison says. Today it has two (`import-quality/README.md` has the checklist for adding more).

## Part E: See the cost

The admin console has a new section, **AI imports**: this month's estimated cost, by model and by the households that cost most, how often a second look was needed, and the alert, pause, model and second-look settings. Changes there ask for your passkey again, like plan limits.

## For the privacy policy (phase H2)

Photos and pages sent to read go to Anthropic. Checked 2026-10-13 on Anthropic's privacy pages:

- **Retention**: "we automatically delete inputs and outputs on our backend within 30 days of receipt or generation", except inputs and outputs flagged by their trust and safety systems, which are kept for up to 2 years ([privacy.claude.com, "How long do you store my organization's data?"](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)).
- **Training**: "we will not use your inputs or outputs from our commercial products" to train models by default ([privacy.claude.com, "Is my data used for model training?"](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)).

## Local development

Locally (and in the tests) Fennl reads with a stand-in AI that costs nothing (`AI_PROVIDER=fake` in `.dev.vars`). To try the real one locally, remove that line and add `ANTHROPIC_API_KEY=` with your key to `.dev.vars`, which git ignores.
