# Private test samples

Some of the import test set can't be public: whole printed web pages, with the sites' stories,
photos, readers' comments and paywalled pages (owner's choice, 2026-10-21). Their correct answers
stay in this repository (`import-quality/expected/`), but the files live in a separate **private**
repository. The AI model comparison (Actions › AI model comparison) reads them from there; every
other check leaves them out.

In this repository, `test-pdfs/` is ignored by git, so the files can sit on your computer without
being uploaded here by mistake.

These steps were written from GitHub's own documentation, checked on 2026-10-21:

- [Creating a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)
- [Adding a file to a repository](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)
- [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

If a screen looks different from what's described, send a screenshot of it rather than guessing.

## 1. Create the private repository

1. On github.com, in the upper-right corner of any page, click **+**, then **New repository**.
2. **Owner**: `terrastak`.
3. **Repository name**: `fennl-test-samples`.
4. Choose **Private**.
5. Leave the README, .gitignore and license options off.
6. Click **Create repository**.

## 2. Put the files in it

Either ask Claude to upload them (in a Claude Code session, say "upload the private samples to
terrastak/fennl-test-samples"; it will ask to add that repository to the session), or upload them
yourself:

1. Open the new repository's page.
2. Click **Add file**, then **Upload files**. (On a brand-new empty repository, the page has an
   "uploading an existing file" link that does the same.)
3. Drag in the **files** from your `test-pdfs` folder: all the PDFs and `Short Rib Veg Soup -
   Mom.jpg`. Drag the files, not the folder, so they sit at the top of the repository. GitHub takes
   up to 100 files at a time, each up to 25 MB; the largest here is about 7 MB.
4. In **Commit message**, type `Test samples`.
5. Choose to commit to the `main` branch, then click the green button at the bottom.

## 3. Let the comparison read them

The comparison needs a key that can only read this one repository.

1. Click your **profile picture** (upper-right), then **Settings**.
2. In the left sidebar, click **Developer settings**.
3. Under **Personal access tokens**, click **Fine-grained tokens**, then **Generate new token**.
4. **Token name**: `Fennl test samples (read only)`.
5. **Expiration**: the longest your account allows (when it runs out, the comparison simply skips
   the private samples and says so; make a new token then).
6. **Resource owner**: `terrastak`.
7. **Repository access**: **Only select repositories**, then choose `fennl-test-samples` in
   **Selected repositories**.
8. **Permissions**: open **Repository permissions**, find **Contents**, and set it to
   **Read-only**. Leave everything else as it is.
9. Click **Generate token**, and copy the token straight away (GitHub shows it once).

Then save it in the Fennl repository:

1. Open `terrastak/fennl` on github.com and click **Settings** (under the repository name).
2. In the sidebar's **Security** section, open **Secrets and variables**, then click **Actions**.
3. On the **Secrets** tab, click **New repository secret**.
4. **Name**: `TEST_SAMPLES_TOKEN`. **Secret**: paste the token. Click **Add secret**.

That's all. The next comparison run reads the private samples too; its summary page says when it
couldn't.

If you named the repository something other than `terrastak/fennl-test-samples`, also add a
repository **variable** (same page, **Variables** tab) named `TEST_SAMPLES_REPO` with the full
name, such as `terrastak/my-samples`.

## The Paprika library

The repository also holds the owner's whole Paprika library with its photos, in `paprika/`
(moved there on 2026-10-22: a few of its photos were personal documents attached to a recipe by
mistake). This public repository keeps a copy with the text only, in `test_recipes/`.
