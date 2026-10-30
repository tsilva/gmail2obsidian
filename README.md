<p align="center">
  <img src="./logo.png" alt="gmail2obsidian" width="512" />
  <br />
  <!-- repo-tagline:start -->
  <strong>📬 Turn labeled Gmail threads into Obsidian tasks ✅</strong>
  <!-- repo-tagline:end -->
</p>

gmail2obsidian is a Google Apps Script that turns Gmail labels into Obsidian tasks stored in markdown files on Google Drive. Label emails while triaging your inbox, open the deployed web app URL, then confirm **Flush labeled emails**. Each matching thread is prepended to the configured vault file.

The script is deployed manually through the Google Apps Script editor, runs as your Google Apps Script user, adds a file-level `#process` tag when new entries are written, and removes each processed label after a successful write to prevent repeats once cleanup completes. No local Google OAuth login or clasp installation is required.

Labels under a configured route are also routed automatically. For example, if `obsidian` sends to `@inbox.md`, then `obsidian/parsefood` sends to `parsefood.md` when that file exists, then `git-parsefood.md` when that exists, and otherwise falls back to `@inbox.md` with `#parsefood` prefixed to the entry. If a thread has both a parent label and a child label, the child label wins and the parent route does not also receive the thread.

## Setup

For a new installation, prepare the local files:

```bash
git clone https://github.com/tsilva/gmail2obsidian.git
cd gmail2obsidian
make setup
```

Edit `config.gs` with your vault path and routes, then validate:

```bash
make check test
```

Create a Google Apps Script project at [script.google.com](https://script.google.com). Add script files named `gmail2obsidian` and `config`, and paste the contents of `gmail2obsidian.gs` and your configured `config.gs` respectively. In **Project Settings**, enable **Show appsscript.json manifest file in editor**, then copy the local `appsscript.json` into that manifest and save. Keep credentials in Script Properties, never in source files.

Create a Web app deployment with **Execute as: Me** and **Who has access: Only myself**, authorizing the requested Gmail/Drive access as the owner when prompted. Keep project sharing **Restricted**, with only your account as an editor. Bookmark its web app URL. To use it, apply a configured Gmail label, open the bookmark, then click **Flush labeled emails**. Opening or refreshing the page never flushes mail. Confirmation expires after five minutes and can be used once; reload to obtain a new one after failure or expiry.

### Updating an existing deployment manually

1. Run `make check test` locally.
2. Open the existing Apps Script project as its owner. Copy the updated `gmail2obsidian.gs` into the `gmail2obsidian` script file and save. Preserve the existing `config` and Script Properties unless intentionally changing configuration. Review any manifest changes separately, retaining the intended owner-only or opted-in webhook access policy.
3. Choose **Deploy → Manage deployments**, select the intended existing web app, then **Edit → New version → Deploy**. Preserve its URL and **Execute as: Me** setting. Keep its selected access policy; an existing webhook deployment may use **Anyone** as described below.
4. Open the existing bookmark to check the confirmation page without starting an import. A real flush modifies Gmail and Drive.

Clasp is retired for this workflow. Do not reinstall or authenticate it to update the script. Updating local files or saving editor changes alone does not update a versioned deployment.

## Native sandboxed import proxy

The agent can run the configured import through a native Infisical proxy while
receiving only `gmail2obsidian_proxy_placeholder`. No Google account login,
clasp authorization, or local signing-key retrieval is needed. The source token
is a separate, random 256-bit webhook capability held by Infisical and Google
Apps Script. It cannot authenticate to Gmail, Drive, or the Apps Script API.

`.infisical.yaml` selects the dedicated `gmail2obsidian` project, development
(`dev`), and `/agents/webhook`. The root AGENTS.md maps the client to that folder.
The separately provisioned proxied service references `WEBHOOK_PROXY_TOKEN` and
replaces its exact placeholder in POST bodies only at the selected deployment
path on `script.google.com`. Metadata alone does not configure that service.
This source is independent of Gradlab's credentials and the legacy personal
Agent Vault bundles.

The proxy substitutes a token; it does not compute HMAC. The new server mode
therefore requires exactly `action`, `timestamp`, `requestId`, and `token` in a
JSON POST. It checks `WEBHOOK_PROXY_TOKEN` in Script Properties, fixed actions,
timestamp limits and import replay IDs. `check` returns authentication status
without Gmail/Drive access or import-state changes. `flush` uses the existing
locked routing and count-only response. Legacy HMAC mode below remains separate;
its key never enables proxy-token authentication. Because the proxy mode carries
the token in the HTTPS body, do not record request bodies on either side.

### Manual main-account handoff

Main-account clasp access has been revoked. Do not log it back in. After local
preparation, the owner must do these steps in their own browser:

1. In the existing Apps Script project, replace the `gmail2obsidian` code with
   the current local `gmail2obsidian.gs` and save. Do not replace `config` or
   create another project. The deployed version already has the required
   manifest scopes and public execute-as-owner web-app settings.
2. In Infisical, open project **gmail2obsidian**, environment **Development**,
   folder **/agents/webhook**. Copy the generated **WEBHOOK_PROXY_TOKEN** directly
   into the same-named Apps Script **Project Settings → Script Properties**
   field. Do not paste it into chat, files, command arguments or logs. Remove
   `WEBHOOK_SECRET` if it was previously set and only proxy access is wanted.
3. Choose **Deploy → Manage deployments → Edit → New version → Deploy** for
   the existing web app. Keep **Execute as: Me** and **Who has access: Anyone**.
   Preserve its deployment ID/URL and keep project sharing **Restricted**.

This key transfer is trusted provisioning, not an ordinary client operation.
For rotation, replace the token in Infisical and Apps Script together; native
proxy runs read the new source on launch. No Agent Vault copy/sync is involved.

### Native client command

From this repository root, load only the workflow owner's metadata file. The
client validates its exact deployment URL, uses no Google cookies or OAuth, and
records no token, request body, email text or upstream error text in its receipts.

```sh
PATH="$PWD/scripts/no-persistent-ca:$PATH" \
infisical secrets agent-proxy run \
  --domain=https://app.infisical.com --path=/agents/webhook \
  --sandbox=true --unmatched-host=block \
  --allow-host=script.googleusercontent.com \
  --allow-write=/Users/tsilva/repos/tsilva/private-workflow/.local/repo-inbox/gmail-webhook/receipts \
  --set-env=NO_PROXY= --set-env=no_proxy= \
  -- python3 -B scripts/webhook_client.py check \
  --config /Users/tsilva/repos/tsilva/private-workflow/.local/repo-inbox/gmail-webhook/config.json
```

Validate metadata and review/remove conflicting inherited `INFISICAL_*` or proxy
overrides before this command. The client requires the exact placeholder, native
loopback proxy and local CA environment before startup. The maintained `security`
shim declines only persistent CA installation; TLS still uses the native CA in
the child environment. No global application or Keychain trust defaults change.

Only after the manual handoff and a successful `authenticated` check is the route
ready. For an authorized inbox flush, replace `check` with `flush` once. Require
`ok: true` and `status: complete`, then establish local Drive sync before filing.
Pending/partial/unknown receipts are not safe automatic retries. Stable local
file timestamps alone do not prove cloud sync. Follow the inbox-flush skill's
per-item questions and write authorization for subsequent filing and cleanup.

### Verification status

The updated server has 28 credential-free tests; the Python client has six tests
covering endpoint/redirect constraints, placeholders, response filtering and
private receipts. Nine native fake-key checks passed, including actual body
substitution, sandbox file/network denial, replay/expiry handling and rejection
of an unmapped destination path. Fake resources were removed; no persistent CA
trust was added. After the owner updated the existing deployment and transferred
the token, the native sandboxed `check` returned `authenticated` on 2026-10-30.
No Google login or real import was used for that check. Import behavior and local
Drive synchronization remain unverified until an authorized inbox-flush run.

## Optional legacy HMAC import webhook

An agent can trigger the existing configured import without receiving Google
credentials, Gmail API access, or editor access to this project. The script still
runs under the main account that owns its Gmail authorization. A Betty account is
not required for this protocol; possession of the signing secret authorizes the
fixed import operation. Imported content remains visible at its configured Drive
destinations. Keep project sharing **Restricted** and do not grant the caller
editor access.

The HMAC mode is disabled until `WEBHOOK_SECRET` is configured and the deployment
allows external requests. To enable it in the main account:

1. Upload the updated `gmail2obsidian.gs` and `appsscript.json` together. The
   additional `userinfo.email` scope protects the existing browser confirmation
   path by checking that the visitor is the deploying owner. Reauthorize as the
   owner if prompted. A missing visitor identity is rejected.
2. Generate a random 32-byte secret locally (for example, run
   `openssl rand -hex 32` in your own terminal). In Apps Script **Project Settings
   → Script Properties**, set `WEBHOOK_SECRET` to those 64 lowercase hex
   characters. Store the caller's copy in approved private credential storage;
   never put it in source, chat, URLs, command arguments, or logs. Do not set or
   manually clear `WEBHOOK_USED_REQUESTS`; the script manages replay protection.
3. For this opt-in deployment, change `webapp.access` in `appsscript.json` from
   `MYSELF` to `ANYONE_ANONYMOUS`, retaining `USER_DEPLOYING`. Update the intended
   deployment using the manual update steps above, then verify
   **Execute as: Me** and **Who has access: Anyone** in **Manage deployments**.
   This makes the URL reachable without Google login; application-level signature
   verification controls imports. The checked-in default stays owner-only.
   An organization policy may prevent anonymous deployments.
4. Give the caller the deployed `/exec` URL and provision its signing secret
   privately. The caller needs no main-account Google authorization. Use signed
   POSTs for automated imports; the browser confirmation remains owner-only.

### Request protocol

POST `application/json` with exactly these fields:

```json
{
  "action": "flush",
  "timestamp": 1793368800,
  "requestId": "0123456789abcdef0123456789abcdef",
  "signature": "<64 lowercase hexadecimal characters>"
}
```

Generate a fresh cryptographically random 16-byte request ID, encoded as 32
lowercase hex characters. `timestamp` is integer Unix seconds, accepted from
120 seconds ago to 30 seconds in the future. Compute HMAC-SHA256 over this exact
UTF-8 text (LF separators, no final newline), and encode the digest as lowercase
hex. The HMAC key is the **literal 64-character secret string**, not hex-decoded
bytes:

```text
gmail2obsidian:v1
flush
<timestamp>
<requestId>
```

The body cannot select accounts, Gmail queries, routes, destination paths, limits,
or executable code. Accepted request IDs are persisted before processing under
the same lock as browser imports. A replay is rejected even if processing failed;
rotating or removing `WEBHOOK_SECRET` revokes the previous signing key.

Apps Script Content Service redirects responses; callers must follow Google's
response redirect and read the final JSON. HTTP success alone is insufficient.
Only `ok: true` with `status: "complete"` reports a finished batch. The response
contains `imported`, `errors` and `warnings` counts, without subjects, bodies,
paths, or provider error details. The count is new entries written by completed
routes, not proof of local Obsidian synchronization or an empty Gmail label.

`unauthorized` makes no import attempt. `busy` has not consumed the request and
can be retried unchanged within its validity window. `already_used` prevents
another attempt; it does not prove the earlier import succeeded.
`partial_failure`, `more_may_remain` and `failed_or_unknown` require inspection
before another attempt with a new ID. A dropped response is also an unknown
outcome: do not automatically issue a fresh signed request. Existing interruption
and Drive concurrency limitations below still apply. The replay ledger admits
at most 100 unexpired request IDs; additional requests return `busy`.

Before starting an inbox flush, the caller must verify this import result and
that the changed Drive files have synced locally, then stop the importer while
the inbox is being filed. Merely enabling this endpoint does not change the
separate `private-skills_inbox-flush` skill or install a scheduled trigger.

## Configuration

`make setup` copies `config.example.gs` to `config.gs` if it does not exist. `config.gs` is ignored by git; copy its contents into the Apps Script `config` file during initial setup. Preserve the live configuration during routine code updates.

```javascript
const CONFIG = {
  VAULT_FOLDER: "Obsidian/YourVault",
  MAX_THREADS: 50,
  ENTRY_PREFIX: "checkbox",
  ENTRY_LINK: false,
  ENTRY_HEADER: true,
  ROUTES: [
    { label: "obsidian", file: "@inbox.md" },
    { label: "obsidian/project1", file: "project1/inbox.md" },
  ],
};
```

Use `VAULT_FOLDER_ID` instead of `VAULT_FOLDER` when the vault is in a shared or cross-account Drive folder. If you set `ENTRY_LINK: true`, set `GMAIL_ACCOUNT_INDEX` when Gmail permalinks should open a non-default Google account, such as `/u/1`.

## Output

By default, each email becomes a checkbox under a dated flush header:

```markdown
#process

## Flushed 2026-04-29
- [ ] Meeting notes from Tuesday (body: Please review the agenda before Thursday.)
- [ ] Project proposal review
```

The file-level `#process` tag is added once when needed. When the first message has body text, it is collapsed to one line and appended as `(body: ...)` after the subject, unless the normalized body is identical to the subject. Imported subjects and bodies are encoded as literal Markdown text: sender links, images, note embeds and HTML do not become active markup. Punctuation may be escaped in the raw `.md` file and displays normally when rendered. `ENTRY_PREFIX` can be `"checkbox"`, `"bullet"`, or `"none"`. `ENTRY_LINK: true` adds an app-generated Gmail link around the literal subject, and `ENTRY_HEADER` controls the dated header.

Dynamic child labels use the same formatting. When a child label falls back to the configured inbox file, the label leaf is inserted as an Obsidian tag:

```markdown
## Flushed 2026-04-29
- [ ] #parsefood Recipe follow-up
```

## Commands

```bash
make setup   # install git hooks and create config.gs if missing
make check   # validate Apps Script syntax, example config, and manifest JSON
make test    # run tests with mocked Google services
```

Local validation requires Node.js 24 or newer, Python 3 and Make, with no npm packages or Google credentials. GitHub Actions runs `make check` and `make test` on pushes and pull requests. CI uses native Git checkout and preinstalled Node.js 24 from the Ubuntu 24.04 runner tool cache, supporting the repository's local-actions-only policy without external actions or runtime downloads. Checkout verifies the tested commit and does not persist its read-only job token. Tests cover task output, failed writes, child-label routing, legacy markers, locking, inert GET, confirmation expiry/replay, hostile email markup, signed POST verification, durable replay rejection, owner checks and private RPC helpers. A live flush modifies real mail and Drive files; verify the confirmation page without pressing its button when only checking deployment.

## Notes

- Target `.md` files must already exist in the Drive vault.
- Files that receive new entries are automatically tagged with `#process` if they do not already contain that tag.
- Gmail labels must match `CONFIG.ROUTES` exactly; nested labels use `/`.
- Child Gmail labels below a configured route are discovered automatically. For `obsidian/parsefood`, the script looks next to the configured inbox file for `parsefood.md`, then `git-parsefood.md`, then falls back to the inbox file with `#parsefood`.
- More specific Gmail labels take precedence over parent labels. If a thread has both `obsidian` and `obsidian/git-aipit`, it is flushed only through `obsidian/git-aipit`; after a successful child flush, matching parent labels are removed too.
- Flush executions are serialized to prevent overlapping requests from writing the same labeled threads twice. Legacy Gmail thread markers from older versions are still recognized, but new entries do not include hidden comments.
- An interruption after a Drive write and before Gmail cleanup can duplicate entries on retry. The script lock also cannot coordinate independent Drive editors; avoid editing destination files during a flush.
- `MAX_THREADS` caps each label batch to avoid Apps Script timeouts. Run the web app again if the summary reports that the cap was reached.
- Routes fail independently. Missing labels are skipped; target file errors are reported in the HTML summary without stopping other routes.
- Manual updates must select the existing deployment to preserve its URL; recheck its intended access policy after updating (owner-only by default, or the webhook opt-in above).
- `appsscript.json` requests Gmail modify, Drive and user email identity scopes. These are broad account permissions: configured labels and a vault folder restrict this code's behavior, not the OAuth grant. No trigger-management scope is requested. Removing a requested scope does not prove previously granted access was removed from Google's connection record.
- Confirmations are owner-bound, short-lived and single-use, consumed under the same script lock as processing. All internal helpers end in `_`, preventing direct calls through `google.script.run`. Only `doGet`, `confirmFlush` and `doPost` are public handlers, with owner checks or signed-request verification.
- Only `gmail2obsidian.gs`, the intended `config.gs`, and reviewed `appsscript.json` changes belong in Apps Script; local tools and tests are not deployed.

## Architecture

![gmail2obsidian architecture diagram](./architecture.png)

The diagram illustrates routing. The web entry point now requires explicit confirmation before starting this flow.

## Brand Assets

Generated logo, icon, favicon, social, and store-size assets live in [`image-assets`](./image-assets). The README logo is synced to [`logo.png`](./logo.png).

## License

[MIT](LICENSE)
