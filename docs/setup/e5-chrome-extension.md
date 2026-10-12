# The Fennl extension for Chrome

How to install the Fennl extension on your computer to try it, and, later, how to put it on the Chrome Web Store for testers. There's no code to write.

Written on 2026-10-12 from Chrome's current docs:

- Loading an extension by hand: [developer.chrome.com/docs/extensions/get-started/tutorial/hello-world](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
- Publishing: [developer.chrome.com/docs/webstore/publish](https://developer.chrome.com/docs/webstore/publish), [register](https://developer.chrome.com/docs/webstore/register), [visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution), [privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [review](https://developer.chrome.com/docs/webstore/review-process)
- Downloading a file from a GitHub Actions run: [docs.github.com, "Downloading workflow artifacts"](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)

If a screen looks different from these steps, tell me what you see.

## Part A: Try it on your computer (now)

Each time a change reaches `main`, GitHub builds the extension for `beta.fennl.app`.

1. Download it:
   1. On GitHub, open the `fennl` repository and click the **Actions** tab.
   2. In the left sidebar, click **CI**.
   3. In the list of runs, click the newest run for `main` (its name is the last change's title).
   4. In the **Artifacts** section, click **fennl-chrome-extension**. Your browser downloads a .zip file.
   5. Unzip it into a folder you'll keep (for example `Documents/Fennl extension`). Chrome uses the folder from then on, so don't delete it.
2. Load it into Chrome:
   1. In a new tab, go to `chrome://extensions`.
   2. Turn on the **Developer mode** toggle.
   3. Click **Load unpacked** and choose the folder from step 1.5 (the one with `manifest.json` in it).
3. Connect it to your account:
   1. Click the puzzle-piece **Extensions** button in Chrome's toolbar, then **Fennl** (the pin icon next to it keeps it in the toolbar).
   2. Click **Connect to Fennl**. Fennl opens; sign in if it asks.
   3. Click **Connect the extension**. Fennl says "Connected."
   4. On Premium, the tab then changes to "One more step: photos". Click **Allow photos from any site**, and allow it when Chrome asks. Some sites (Food Network, for one) only let a browser download their photos, so the extension brings them itself. It only does so for the recipe you import. If you click **Not now**, the same button is in the Fennl button's panel for later.
   5. Click the Fennl button again: it shows "Connected as" and your name.
4. Import a recipe:
   1. Open a recipe on a site you use (signed in, if it's a site you sign in to).
   2. Click the Fennl button, then **Import this page**.
   3. Fennl opens the recipe's review screen. Check it, then click **Save recipe**.

Things to know:

- Chrome doesn't update an extension loaded this way. For a newer version, download it again, replace the folder's contents, and click the reload arrow on Fennl's card in `chrome://extensions`.
- **Settings › Chrome extension** in Fennl lists connected extensions, with **Disconnect**. Changing your password disconnects them, and one unused for 90 days disconnects itself.
- Updating to 0.3.0 (photos from any site) when already connected: replace the folder's contents and click the reload arrow as below. Then, on Premium, click the Fennl button, then **Allow photos from any site**, and allow it when Chrome asks.
- Updating from version 0.1.0 (before **Import this page**): replace the folder's contents with the new download, then click the reload arrow on Fennl's card in `chrome://extensions`. The new permissions it uses (reading the page you click its button on) show no warning in Chrome ([permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list), checked 2026-10-12).
- The extension reads only the page you click its button on, and only then.
- On Premium without photos allowed (you clicked **Not now**, or upgraded from Free after connecting): when a site won't let Fennl download a recipe's photos, the panel says "This site only lets a browser download its photos". Click **Allow photos from any site**, then the same button on the page that opens, and allow it when Chrome asks. The extension then brings that recipe's photos and opens it for review.

## Part B: The Chrome Web Store (later, before testers need it)

You chose an unlisted listing for the beta and a public one once the extension is finished. Both use the same developer account; visibility is a setting you can change later.

**Before you start, one thing must exist:** a privacy policy page. The store asks for its address, and the extension sends the pages you import to Fennl. The privacy policy is phase H2. Until then, the store can't be used, and testers use Part A.

When the privacy policy is ready, I'll prepare the listing text, the answers for the **Privacy** tab (its single purpose, why it needs each permission, "No, I am not using remote code", and what data it handles), and the screenshots. You then:

1. Register as a Chrome Web Store developer ([register page](https://developer.chrome.com/docs/webstore/register)): sign in with the Google account that should own the listing, accept the developer agreement, and pay the one-time registration fee (the page doesn't state the amount; it has been US$5). The email you give can't be changed later, so use one you check often.
2. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole), click **Add new item**, click **Choose file**, choose the extension's .zip, and click **Upload**.
3. Fill in the **Store Listing**, **Privacy** and **Distribution** tabs with what I prepared. On **Distribution**, choose **Unlisted** for the beta ("anyone with the direct store URL can install it"), or **Public** when it's finished.
4. Click **Submit for Review**, then confirm. Google says most reviews take a few days, and some take a few weeks.

Testers who install from the store get new versions automatically.
