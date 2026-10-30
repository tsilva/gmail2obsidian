<p align="center">
  <img src="./logo.png" alt="gmail2obsidian" width="512" />
  <br />
  <!-- repo-tagline:start -->
  <strong>📬 Turn labeled Gmail threads into Obsidian tasks ✅</strong>
  <!-- repo-tagline:end -->
</p>

gmail2obsidian is a Google Apps Script that turns Gmail labels into Obsidian tasks stored in markdown files on Google Drive. Label emails while triaging your inbox, open the deployed web app URL, then confirm **Flush labeled emails**. Each matching thread is prepended to the configured vault file.

The script is deployed with `clasp`, runs as your Google Apps Script user, adds a file-level `#process` tag when new entries are written, and removes each processed label after a successful write to prevent repeats once cleanup completes.

Labels under a configured route are also routed automatically. For example, if `obsidian` sends to `@inbox.md`, then `obsidian/parsefood` sends to `parsefood.md` when that file exists, then `git-parsefood.md` when that exists, and otherwise falls back to `@inbox.md` with `#parsefood` prefixed to the entry. If a thread has both a parent label and a child label, the child label wins and the parent route does not also receive the thread.

## Setup

Create a Google Apps Script project at [script.google.com](https://script.google.com), copy its Script ID from Project Settings, then run:

```bash
git clone git@github.com:tsilva/gmail2obsidian.git
cd gmail2obsidian
npm install -g @google/clasp
make setup
make login
```

Enable the Apps Script API at [script.google.com/home/usersettings](https://script.google.com/home/usersettings), then edit `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with your Script ID.

Edit `config.gs` with your vault path and routes, then upload:

```bash
make push
```

In Apps Script, create a Web app deployment with **Execute as: Me** and **Who has access: Only myself**. Keep project sharing **Restricted**, with only your account as an editor. Bookmark its web app URL. To use it, apply a configured Gmail label, open the bookmark, then click **Flush labeled emails**. Opening or refreshing the page never flushes mail. Confirmation expires after five minutes and can be used once; reload to obtain a new one after failure or expiry.

For later updates, copy the intended active Deployment ID from **Deploy → Manage deployments**, then run `make deploy DEPLOYMENT_ID=your-deployment-id`. This updates that deployment and preserves the bookmark. The command fails before uploading if the ID is omitted.

## Optional signed import webhook

An agent can trigger the existing configured import without receiving Google
credentials, Gmail API access, or editor access to this project. The script still
runs under the main account that owns its Gmail authorization. A Betty account is
not required for this protocol; possession of the signing secret authorizes the
fixed import operation. Imported content remains visible at its configured Drive
destinations. Keep project sharing **Restricted** and do not grant the caller
editor access.

The webhook is disabled until `WEBHOOK_SECRET` is configured and the deployment
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
   deployment with `make deploy DEPLOYMENT_ID=your-deployment-id`, then verify
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

`make setup` copies `config.example.gs` to `config.gs`. `config.gs` is ignored by git but included in `clasp` uploads.

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
make setup   # install git hooks, create .clasp.json, and copy config.gs
make login   # authenticate clasp with Google
make push    # upload gmail2obsidian.gs, config.gs, and appsscript.json
make deploy DEPLOYMENT_ID=your-deployment-id # validate, push and update this exact deployment
make open    # open the Apps Script project
make check   # validate Apps Script syntax, example config, and manifest JSON
make test    # run tests with mocked Google services
```

Local validation requires Node.js 24 or newer and Make, with no npm packages or Google credentials. GitHub Actions runs `make check` and `make test` on pushes and pull requests. Tests cover task output, failed writes, child-label routing, legacy markers, locking, inert GET, confirmation expiry/replay, hostile email markup, signed POST verification, durable replay rejection, owner checks and private RPC helpers. A live flush modifies real mail and Drive files; verify the confirmation page without pressing its button when only checking deployment.

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
- `make deploy` updates only the explicitly selected deployment; recheck its intended access policy after updating (owner-only by default, or the signed webhook opt-in above).
- `appsscript.json` requests Gmail modify, Drive and user email identity scopes. These are broad account permissions: configured labels and a vault folder restrict this code's behavior, not the OAuth grant. No trigger-management scope is requested. Removing a requested scope does not prove previously granted access was removed from Google's connection record.
- Confirmations are owner-bound, short-lived and single-use, consumed under the same script lock as processing. All internal helpers end in `_`, preventing direct calls through `google.script.run`. Only `doGet`, `confirmFlush` and `doPost` are public handlers, with owner checks or signed-request verification.
- `.claspignore` uploads only `gmail2obsidian.gs`, `config.gs`, and `appsscript.json`.

## Architecture

![gmail2obsidian architecture diagram](./architecture.png)

The diagram illustrates routing. The web entry point now requires explicit confirmation before starting this flow.

## Brand Assets

Generated logo, icon, favicon, social, and store-size assets live in [`image-assets`](./image-assets). The README logo is synced to [`logo.png`](./logo.png).

## License

[MIT](LICENSE)
