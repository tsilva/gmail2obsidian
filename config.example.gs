/**
 * Configuration for Gmail-to-Obsidian.
 *
 * Copy this file to config.gs and edit to match your setup:
 *   cp config.example.gs config.gs
 *
 * config.gs is gitignored but pushed to Apps Script by clasp.
 */
const CONFIG = {
  VAULT_FOLDER: "Obsidian/YourVault", // Google Drive path to vault root
  // VAULT_FOLDER_ID: "abc123...",     // Optional: Google Drive folder ID (for shared/cross-account folders)
  // GMAIL_ACCOUNT_INDEX: 0,           // Optional: Gmail account index for permalinks (default: 0)
  MAX_THREADS: 50,                     // Max threads per label per run (prevents execution timeout)
  ENTRY_PREFIX: "checkbox",              // "checkbox" (- [ ] ), "bullet" (- ), or "none"
  ENTRY_LINK: true,                      // true: [subject](permalink), false: plain subject
  ROUTES: [
    { label: "obsidian", file: "inbox.md" },
    { label: "obsidian/project1", file: "project1/inbox.md" },
    { label: "obsidian/project2", file: "project2/inbox.md" },
  ],
};
