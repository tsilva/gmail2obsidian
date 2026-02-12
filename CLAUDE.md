# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail-to-Obsidian is a Google Apps Script that bulk-flushes Gmail emails into Obsidian task files on Google Drive. Users label emails during triage, click a bookmarked web app URL, and labeled threads are formatted as Obsidian checkboxes with Gmail permalinks and prepended to target `.md` files.

## Architecture

Google Apps Script split across two files (`gmail2obsidian.gs` + `config.gs`):

- **CONFIG** (`config.gs`) — Routes mapping Gmail labels to vault file paths, plus optional cross-account settings (`VAULT_FOLDER_ID`, `GMAIL_ACCOUNT_INDEX`). Copied from `config.example.gs` during setup; gitignored but pushed by clasp.
- **doGet()** — Web app entry point; calls `flushToObsidian()` and returns an HTML summary page
- **flushToObsidian()** — Core logic: iterates routes, reads labeled threads, formats entries, prepends to target files, removes labels/unstars
- **getVaultFolder() / getFileByPath()** — Google Drive navigation helpers (support both path-based and folder-ID-based access)
- **escapeMd() / escapeHtml()** — Utility functions

Google APIs used: `GmailApp`, `DriveApp`, `HtmlService`, `Utilities`, `Session`.

## Development

The script runs in Google Apps Script. Deployment uses [clasp](https://github.com/google/clasp) (Google's CLI for Apps Script):

1. One-time setup: `make setup`, then follow the printed instructions
2. Edit `gmail2obsidian.gs` locally
3. `make push` to upload, or `make deploy` to upload and create a versioned deployment
4. Test by clicking the deployed web app URL

Other commands: `make open` (open in browser), `make login` (re-authenticate).

## Key Conventions

- Task format: `- [ ] [subject](gmail-permalink)` under `## Flushed YYYY-MM-DD` headers
- Entries are **prepended** to target files (newest on top)
- Label removal after processing makes the operation idempotent
- Routes with missing labels or files fail gracefully per-route (errors reported in HTML output, other routes continue)
- README.md must be kept up to date with any significant project changes
