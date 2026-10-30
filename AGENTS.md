# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail-to-Obsidian is a Google Apps Script that bulk-flushes labeled Gmail threads into Obsidian files on Google Drive. Users open a bookmarked web app and explicitly confirm the flush; imported text stays literal, with configurable task prefixes and app-generated Gmail permalinks.

## Architecture

Google Apps Script split across two files (`gmail2obsidian.gs` + `config.gs`):

- **CONFIG** (`config.gs`) — Routes mapping Gmail labels to vault file paths, entry formatting options (`ENTRY_HEADER`, `ENTRY_PREFIX`, `ENTRY_LINK`), plus optional cross-account settings (`VAULT_FOLDER_ID`, `GMAIL_ACCOUNT_INDEX`). Copied from `config.example.gs` during setup; gitignored and maintained manually in Apps Script.
- **doGet()** — Inert confirmation page; creates a five-minute, owner-bound action token without Gmail/Drive access
- **confirmFlush(token)** — Owner-only browser mutator; atomically consumes the token under the script lock and returns an escaped HTML summary
- **doPost(e) / handleWebhook_(e)** — Optional HMAC-authenticated import trigger with timestamp checks, durable replay protection and count-only JSON; disabled without `WEBHOOK_SECRET` in Script Properties
- **requireFlushOwner_()** — Rejects blank or non-owner active identities before GET confirmation issuance or browser mutation, including on externally reachable webhook deployments
- **flushToObsidian_() / flushToObsidianLocked_()** — Private processing helpers; routes labeled threads to Drive, then removes labels and archives threads
- **getVaultFolder_() / getFileByPath_()** — Google Drive navigation helpers (support both path-based and folder-ID-based access)
- **escapeMd_() / escapeHtml_()** — Utility functions

Google APIs used: `GmailApp`, `DriveApp`, `HtmlService`, `ContentService`, `Utilities`, `Session`, `CacheService`, `PropertiesService`, `LockService`. Keep owner-only web-app access by default, Restricted project sharing, and literal Markdown encoding of sender subjects/bodies. External webhook access is an explicit deployment opt-in described in README.md; never broaden it merely for testing. Do not log signing secrets, signatures, or request bodies. Keep webhook helpers private with trailing underscores and never let request fields override configured import behavior.

## Development

The script runs in Google Apps Script and is deployed manually by the owner:

1. One-time setup: `make setup`, then follow the printed instructions
2. Edit `gmail2obsidian.gs` locally
3. Validate with `make check test`; no Google credentials are required
4. Follow README.md's manual update steps in the existing Apps Script project, then update the existing deployment to a new version to preserve its URL

Do not install or authenticate clasp. Preserve the live configuration, Script
Properties and selected web-app access policy. Opening the deployed URL is
inert, but pressing Flush changes real Gmail/Drive data. Local edits and checks
do not establish that the live deployment has been updated.

## Agent webhook access

The main-account clasp authorization was revoked at the user's request. Do not
log clasp back in, restore Google OAuth credentials, or grant script editor
access to an agent to finish webhook setup. The user updates the live script
and Script Properties manually; local edits do not establish deployment.

Use the native `.infisical.yaml` project/environment and this reviewed mapping:

| Service / client | Infisical folder | Required placeholder before client startup |
| --- | --- | --- |
| Fixed import webhook (`scripts/webhook_client.py`) | `/agents/webhook` | `WEBHOOK_PROXY_TOKEN=gmail2obsidian_proxy_placeholder` |

The dedicated service substitutes that placeholder only in request bodies to
the configured `script.google.com/macros/s/DEPLOYMENT_ID/exec` path. Its source
is `WEBHOOK_PROXY_TOKEN` in this project's development folder, not a Google
credential or a local HMAC key. The proxy-compatible server independently
verifies that token from its own Script Properties. No real key reaches the
ordinary client. Unknown services, missing bindings, failed authentication and
unsupported clients must stop without another project's key, Keychain signing,
native injection, or legacy vault-tool fallback.

Run from this repository root with the mapped path, explicitly pinned
`--domain=https://app.infisical.com --sandbox=true --unmatched-host=block`.
Only `script.googleusercontent.com` is additionally allowed, for Google's
body-free response GET; never broaden that to a wildcard. The client rejects
unexpected redirects and never forwards the POST body to the response host.
Use `scripts/no-persistent-ca/security` first in the launcher's PATH to decline
persistent CA installation, retaining the native process-local `SSL_CERT_FILE`
and TLS verification. Do not disable the sandbox or certificate validation.
Validate native metadata as data and remove conflicting inherited Infisical
scope/proxy settings before launching. The native sandbox does not sandbox the
outer Codex Desktop process.

Read README.md's native-proxy section for the exact command and manual handoff.
Personal URL/configuration/receipts remain with private-workflow, outside this
repository. `check` is non-mutating; `flush` imports/archives real matching mail
and writes configured Drive notes. Setup and fake-key checks do not authorize a
live import. Do not automatically repeat an unknown or partial import outcome.

## Key Conventions

- Task format: configurable via `ENTRY_HEADER`, `ENTRY_PREFIX` and `ENTRY_LINK`; defaults to literal subjects with checkbox prefixes under dated headers. Gmail links are optional.
- Entries are **prepended** to target files (newest on top)
- Label removal after processing makes the operation idempotent
- Routes with missing labels or files fail gracefully per-route (errors reported in HTML output, other routes continue)
- README.md must be kept up to date with any significant project changes
