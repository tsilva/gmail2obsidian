# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail-to-Obsidian is a Google Apps Script that bulk-flushes labeled Gmail threads into Obsidian files on Google Drive. Users open a bookmarked web app and explicitly confirm the flush; imported text stays literal, with configurable task prefixes and app-generated Gmail permalinks.

## Architecture

Google Apps Script split across two files (`gmail2obsidian.gs` + `config.gs`):

- **CONFIG** (`config.gs`) — Routes mapping Gmail labels to vault file paths, entry formatting options (`ENTRY_HEADER`, `ENTRY_PREFIX`, `ENTRY_LINK`), plus optional cross-account settings (`VAULT_FOLDER_ID`, `GMAIL_ACCOUNT_INDEX`). Copied from `config.example.gs` during setup; gitignored but pushed by clasp.
- **doGet()** — Inert confirmation page; creates a five-minute, owner-bound action token without Gmail/Drive access
- **confirmFlush(token)** — Owner-only browser mutator; atomically consumes the token under the script lock and returns an escaped HTML summary
- **doPost(e) / handleWebhook_(e)** — Optional HMAC-authenticated import trigger with timestamp checks, durable replay protection and count-only JSON; disabled without `WEBHOOK_SECRET` in Script Properties
- **requireFlushOwner_()** — Rejects blank or non-owner active identities before GET confirmation issuance or browser mutation, including on externally reachable webhook deployments
- **flushToObsidian_() / flushToObsidianLocked_()** — Private processing helpers; routes labeled threads to Drive, then removes labels and archives threads
- **getVaultFolder_() / getFileByPath_()** — Google Drive navigation helpers (support both path-based and folder-ID-based access)
- **escapeMd_() / escapeHtml_()** — Utility functions

Google APIs used: `GmailApp`, `DriveApp`, `HtmlService`, `ContentService`, `Utilities`, `Session`, `CacheService`, `PropertiesService`, `LockService`. Keep owner-only web-app access by default, Restricted project sharing, and literal Markdown encoding of sender subjects/bodies. External webhook access is an explicit deployment opt-in described in README.md; never broaden it merely for testing. Do not log signing secrets, signatures, or request bodies. Keep webhook helpers private with trailing underscores and never let request fields override configured import behavior.

## Development

The script runs in Google Apps Script. Deployment uses [clasp](https://github.com/google/clasp) (Google's CLI for Apps Script):

1. One-time setup: `make setup`, then follow the printed instructions
2. Edit `gmail2obsidian.gs` locally
3. `make push` to validate/upload; for an existing deployment use `make deploy DEPLOYMENT_ID=the-intended-id`
4. Test with `make check test`; opening the deployed URL is inert, but pressing Flush changes real Gmail/Drive data

Other commands: `make open` (open in browser), `make login` (re-authenticate).

## Key Conventions

- Task format: configurable via `ENTRY_HEADER`, `ENTRY_PREFIX` and `ENTRY_LINK`; defaults to literal subjects with checkbox prefixes under dated headers. Gmail links are optional.
- Entries are **prepended** to target files (newest on top)
- Label removal after processing makes the operation idempotent
- Routes with missing labels or files fail gracefully per-route (errors reported in HTML output, other routes continue)
- README.md must be kept up to date with any significant project changes
