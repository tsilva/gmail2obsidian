<div align="center">
  <img src="logo.png" alt="gmail2obsidian" width="512"/>

  [![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=flat&logo=google&logoColor=white)](https://script.google.com)
  [![License](https://img.shields.io/github/license/tsilva/gmail2obsidian?style=flat)](LICENSE)
  [![Lines of Code](https://img.shields.io/badge/lines-~210-blue?style=flat)]()

  **📬 Flush labeled Gmail threads into [Obsidian](https://obsidian.md/) task files with one click ✅**

  [Setup Guide](#-setup) · [Configuration](#%EF%B8%8F-configuration) · [How It Works](#-how-it-works)
</div>

---

## 💡 Overview

**The Pain:** You triage emails all day, but action items get buried in your inbox. Copy-pasting into your task manager is tedious and breaks your flow.

**The Solution:** gmail2obsidian is a Google Apps Script that turns Gmail labels into [Obsidian](https://obsidian.md/) checkboxes. Label emails during triage, click a bookmarked URL, and they appear as tasks in your vault — complete with Gmail permalinks, sender info, and dates.

**The Result:** Zero copy-paste. One-click flush. Every actionable email lands in the right Obsidian file, ready to work.

## ✨ Features

- **Multi-label routing** — Map different Gmail labels to different vault files (e.g., `to-obsidian/reading` → `Areas/Reading/Inbox.md`)
- **Gmail permalinks** — Each task links back to the original email thread
- **Prepend mode** — Newest tasks always appear at the top of the file
- **Idempotent** — Labels are removed after processing, so re-running is safe
- **Cross-account support** — Works with shared Drive folders across Google accounts
- **Graceful error handling** — One broken route won't stop the others
- **HTML summary** — See exactly what got flushed after each run

## 📋 Task Format

Each email becomes an Obsidian checkbox under a dated header:

```markdown
## Flushed 2025-01-15
- [ ] [Meeting notes from Tuesday](https://mail.google.com/mail/u/0/#all/abc123) (from: Alice, 2025-01-15)
- [ ] [Project proposal review](https://mail.google.com/mail/u/0/#all/def456) (from: Bob, 2025-01-14)
```

## 🚀 Setup

### 1. Create the Script

1. Go to [script.google.com](https://script.google.com) → **New Project**
2. Delete the default code and paste the contents of [`gmail2obsidian.gs`](gmail2obsidian.gs)
3. In the editor, click **Project Settings** (⚙️) → check **Show "appsscript.json" manifest file in editor**
4. Open the `appsscript.json` tab and replace its contents with [`appsscript.json`](appsscript.json)

### 2. Configure Routes

Edit the `DEFAULT_CONFIG` object in the script to match your setup:

```javascript
const DEFAULT_CONFIG = {
  VAULT_FOLDER: "Obsidian/YourVault",  // Google Drive path to vault root
  ROUTES: [
    { label: "obsidian",         file: "inbox.md" },
    { label: "obsidian/project1", file: "project1/inbox.md" },
    { label: "obsidian/project2", file: "project2/inbox.md" },
  ],
};
```

On first run, this config is automatically saved to **Script Properties**. After that, you can edit the config directly in **Project Settings > Script Properties** without redeploying.

### 3. Create Gmail Labels

In Gmail, create labels matching your routes (e.g., `to-obsidian`, `to-obsidian/reading`). Nested labels work using `/` separators.

### 4. Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Type: **Web app**
3. Execute as: **Me**
4. Access: **Only myself**
5. Click **Deploy** and authorize the requested permissions
6. Copy the web app URL

### 5. Bookmark & Use

Save the web app URL as a browser bookmark. Your workflow becomes:

> **Select emails → Apply label → Click bookmark → Done**

## ⚙️ Configuration

Config is stored as a JSON string under the `CONFIG` key in **Script Properties** (`Project Settings > Script Properties`). It's auto-seeded from `DEFAULT_CONFIG` on first run. Changes to Script Properties take effect immediately — no redeployment needed.

To restore defaults, run `resetConfig()` from the Apps Script editor.

| Option | Description | Default |
|--------|-------------|---------|
| `VAULT_FOLDER` | Google Drive path to your Obsidian vault root | Required |
| `VAULT_FOLDER_ID` | Drive folder ID (for shared/cross-account folders) | — |
| `GMAIL_ACCOUNT_INDEX` | Account index for permalink URLs (`/u/0`, `/u/1`, etc.) | `0` |
| `MAX_THREADS` | Max threads processed per label per run (prevents timeout) | `50` |
| `ROUTES` | Array of `{ label, file }` mappings | Required |

### Cross-Account Setup

If your Obsidian vault lives in a different Google account's Drive:

1. Share the vault folder with your Gmail account
2. Use `VAULT_FOLDER_ID` instead of `VAULT_FOLDER`:

```javascript
const DEFAULT_CONFIG = {
  VAULT_FOLDER_ID: "1AbCdEf...",  // Folder ID from the shared folder's URL
  GMAIL_ACCOUNT_INDEX: 1,          // Your Gmail account index
  ROUTES: [
    { label: "to-obsidian", file: "Inbox.md" },
  ],
};
```

Find the folder ID in the Drive URL: `https://drive.google.com/drive/folders/THIS_PART`.

## 🔧 How It Works

```
Gmail                    Google Apps Script              Google Drive (Obsidian Vault)
┌─────────────┐         ┌──────────────────┐           ┌──────────────────────┐
│ Labeled      │  read   │                  │  prepend  │                      │
│ threads      │───────→ │  flushToObsidian │─────────→ │  Target .md files    │
│              │         │                  │           │                      │
└─────────────┘         └──────────────────┘           └──────────────────────┘
       │                         │
       └─── remove labels ◄─────┘
             & unstar
```

1. `doGet()` handles the web app request
2. `flushToObsidian()` loads config from Script Properties and iterates each route
3. For each route, reads all threads with the matching Gmail label
4. Formats each thread as a Markdown checkbox with subject, permalink, sender, and date
5. Prepends the formatted block to the target file in your vault
6. Removes the label and unstars messages to prevent reprocessing
7. Returns an HTML summary of what was flushed

## 🔒 Security

The script includes several defense-in-depth measures:

- **Explicit OAuth scopes** — `appsscript.json` locks permissions to the minimum needed (`gmail.modify`, `drive`, `script.scriptapp`), preventing silent scope escalation
- **Markdown injection protection** — Email subjects and sender names are escaped to prevent crafted emails from injecting arbitrary URLs into task links
- **Clickjacking prevention** — HTML output sets `X-Frame-Options: DENY` to block iframe embedding
- **Thread batch cap** — `MAX_THREADS` limits threads processed per run, preventing execution timeout from leaving partial state
- **Startup config validation** — Misconfigured routes or missing vault paths fail fast with clear error messages

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Vault folder not found" | Verify `VAULT_FOLDER` path matches your Drive folder structure exactly |
| "File not found" | Ensure target `.md` files exist in your vault before running |
| Wrong Gmail account in permalinks | Adjust `GMAIL_ACCOUNT_INDEX` (0 = default account, 1 = second, etc.) |
| No emails processed | Check that Gmail labels match the `ROUTES` label names in Script Properties exactly |
| Permission errors with shared folders | Use `VAULT_FOLDER_ID` instead of `VAULT_FOLDER` for cross-account access |
| "Batch cap reached" warning | Run the web app again to process remaining threads, or increase `MAX_THREADS` in Script Properties |

## 📄 License

This project is open source. See the [LICENSE](LICENSE) file for details.
