# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail-to-Obsidian is a Google Apps Script that bulk-flushes Gmail emails into Obsidian task files on Google Drive. Users label emails during triage, click a bookmarked web app URL, and labeled threads are formatted as Obsidian checkboxes with Gmail permalinks and prepended to target `.md` files.

## Architecture

Single-file Google Apps Script (`gmail-to-obsidian.gs`, ~210 lines):

- **CONFIG** — Routes mapping Gmail labels to vault file paths, plus optional cross-account settings (`VAULT_FOLDER_ID`, `GMAIL_ACCOUNT_INDEX`)
- **doGet()** — Web app entry point; calls `flushToObsidian()` and returns an HTML summary page
- **flushToObsidian()** — Core logic: iterates routes, reads labeled threads, formats entries, prepends to target files, removes labels/unstars
- **getVaultFolder() / getFileByPath()** — Google Drive navigation helpers (support both path-based and folder-ID-based access)
- **extractSenderName() / escapeHtml()** — Utility functions

Google APIs used: `GmailApp`, `DriveApp`, `HtmlService`, `Utilities`, `Session`.

## Development

There is no local build, test, or lint toolchain. The script runs entirely in Google Apps Script:

1. Edit `gmail-to-obsidian.gs` locally
2. Paste into [script.google.com](https://script.google.com) to deploy
3. Deploy as Web App (Execute as "Me", Access "Only myself")
4. Test by clicking the deployed web app URL

## Key Conventions

- Task format: `- [ ] [subject](gmail-permalink) (from: sender, date)` under `## Flushed YYYY-MM-DD` headers
- Entries are **prepended** to target files (newest on top)
- Label removal after processing makes the operation idempotent
- Routes with missing labels or files fail gracefully per-route (errors reported in HTML output, other routes continue)
- README.md must be kept up to date with any significant project changes
