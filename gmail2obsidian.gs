/**
 * Gmail-to-Obsidian Bulk Flush Script
 *
 * Reads Gmail threads from configured labels, formats them as Obsidian
 * checkbox tasks with Gmail permalinks, and prepends them to target files
 * in your vault on Google Drive. Removes the label (and unstars) after
 * processing. Supports cross-account setups via shared Drive folders.
 *
 * Setup:
 *   1. Go to https://script.google.com → New Project
 *   2. Paste this script
 *   3. Enable the manifest: Project Settings → Show "appsscript.json" manifest file
 *   4. Replace appsscript.json contents with the provided manifest
 *   5. Edit DEFAULT_CONFIG to match your setup (VAULT_FOLDER, ROUTES)
 *   6. Deploy → Web App → Execute as "Me" → Access "Only myself"
 *   7. Click the web app URL once — this seeds your config into Script Properties
 *   8. To change config later: Project Settings → Script Properties → edit CONFIG JSON
 *   9. Copy the web app URL → Bookmark it in your browser
 *  10. During triage: select emails → apply labels → click bookmark
 */

const DEFAULT_CONFIG = {
  VAULT_FOLDER: "Obsidian/YourVault", // Google Drive path to vault root
  // VAULT_FOLDER_ID: "abc123...",     // Optional: Google Drive folder ID (for shared/cross-account folders)
  // GMAIL_ACCOUNT_INDEX: 0,           // Optional: Gmail account index for permalinks (default: 0)
  MAX_THREADS: 50,                     // Max threads per label per run (prevents execution timeout)
  ROUTES: [
    { label: "obsidian", file: "inbox.md" },
    { label: "obsidian/project1", file: "project1/inbox.md" },
    { label: "obsidian/project2", file: "project2/inbox.md" },
  ],
};

/**
 * Reads config from Script Properties. On first run, seeds from DEFAULT_CONFIG.
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty("CONFIG");
  if (stored) {
    return JSON.parse(stored);
  }
  // First run: seed Script Properties from defaults
  props.setProperty("CONFIG", JSON.stringify(DEFAULT_CONFIG));
  return DEFAULT_CONFIG;
}

/**
 * Resets Script Properties config back to DEFAULT_CONFIG.
 * Run from the Apps Script editor to restore defaults.
 */
function resetConfig() {
  PropertiesService.getScriptProperties().setProperty("CONFIG", JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Web app entry point. Calls flushToObsidian and returns an HTML summary.
 */
function doGet() {
  const results = flushToObsidian();
  const totalCount = results.reduce(function(sum, r) { return sum + (r.count || 0); }, 0);

  let html = "<html><head>"
    + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    + "<style>"
    + "body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px;}"
    + "h1{font-size:1.4em;} h2{font-size:1.1em;margin-top:1.5em;} ul{padding-left:20px;} li{margin:4px 0;}"
    + ".error{color:#c00;margin:8px 0;}"
    + "</style></head><body>";

  html += "<h1>Flushed " + totalCount + " email" + (totalCount !== 1 ? "s" : "") + " to Obsidian</h1>";

  if (totalCount === 0 && !results.some(function(r) { return r.error; })) {
    html += "<p>No labeled emails found.</p>";
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.error) {
      html += "<div class='error'>Error [" + escapeHtml(r.label) + " → " + escapeHtml(r.file) + "]: " + escapeHtml(r.error) + "</div>";
    }
    if (r.warning) {
      html += "<div class='error'>" + escapeHtml(r.warning) + "</div>";
    }
    if (r.count > 0) {
      html += "<h2>" + escapeHtml(r.file) + " (" + r.count + ")</h2><ul>";
      for (let j = 0; j < r.subjects.length; j++) {
        html += "<li>" + escapeHtml(r.subjects[j]) + "</li>";
      }
      html += "</ul>";
    }
  }

  html += "</body></html>";

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Validates config at startup. Throws with a clear message if misconfigured.
 */
function validateConfig(config) {
  if (!config.ROUTES || !Array.isArray(config.ROUTES) || config.ROUTES.length === 0) {
    throw new Error("CONFIG.ROUTES must be a non-empty array of { label, file } objects.");
  }
  for (let i = 0; i < config.ROUTES.length; i++) {
    const route = config.ROUTES[i];
    if (!route.label) throw new Error("CONFIG.ROUTES[" + i + "] is missing 'label'.");
    if (!route.file) throw new Error("CONFIG.ROUTES[" + i + "] is missing 'file'.");
  }
  if (!config.VAULT_FOLDER && !config.VAULT_FOLDER_ID) {
    throw new Error("CONFIG must set either VAULT_FOLDER or VAULT_FOLDER_ID.");
  }
}

/**
 * Core logic: iterate over routes, read labeled emails, append to target
 * files, clean up labels/stars. Returns array of per-route results.
 */
function flushToObsidian() {
  const config = getConfig();
  validateConfig(config);
  const results = [];
  const gmailAccountIndex = config.GMAIL_ACCOUNT_INDEX || 0;

  for (let r = 0; r < config.ROUTES.length; r++) {
    const route = config.ROUTES[r];
    try {
      const label = GmailApp.getUserLabelByName(route.label);
      if (!label) {
        results.push({ label: route.label, file: route.file, count: 0, subjects: [] });
        continue;
      }

      const maxThreads = config.MAX_THREADS || 50;
      const threads = label.getThreads(0, maxThreads);
      if (threads.length === 0) {
        results.push({ label: route.label, file: route.file, count: 0, subjects: [] });
        continue;
      }

      const entries = [];
      const subjects = [];

      for (let i = 0; i < threads.length; i++) {
        const thread = threads[i];
        const subject = thread.getFirstMessageSubject() || "(no subject)";
        const permalink = "https://mail.google.com/mail/u/" + gmailAccountIndex + "/#all/" + thread.getId();

        entries.push("- [ ] [" + escapeMd(subject) + "](" + permalink + ")");
        subjects.push(subject);

        thread.removeLabel(label);
        thread.moveToArchive();

        if (thread.hasStarredMessages()) {
          const messages = thread.getMessages();
          for (let j = 0; j < messages.length; j++) {
            if (messages[j].isStarred()) {
              messages[j].unstar();
            }
          }
        }
      }

      const today = Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );
      const header = "## Flushed " + today;
      const block = header + "\n" + entries.join("\n") + "\n\n";

      const file = getFileByPath(route.file, config);
      const existing = file.getBlob().getDataAsString();
      file.setContent(block + existing);

      const result = { label: route.label, file: route.file, count: threads.length, subjects: subjects };
      if (threads.length >= maxThreads) {
        result.warning = "Batch cap reached (" + maxThreads + "). More threads may remain — run again to continue.";
      }
      results.push(result);
    } catch (e) {
      results.push({ label: route.label, file: route.file, count: 0, subjects: [], error: e.message });
    }
  }

  return results;
}

/**
 * Resolves the vault root folder from Google Drive.
 * Uses VAULT_FOLDER_ID (direct access, works with shared folders) if set,
 * otherwise navigates the VAULT_FOLDER path from the Drive root.
 */
function getVaultFolder(config) {
  if (config.VAULT_FOLDER_ID) {
    return DriveApp.getFolderById(config.VAULT_FOLDER_ID);
  }
  const parts = config.VAULT_FOLDER.split("/");
  let folder = DriveApp.getRootFolder();
  for (let i = 0; i < parts.length; i++) {
    const folders = folder.getFoldersByName(parts[i]);
    if (!folders.hasNext()) throw new Error("Vault folder not found: " + parts.slice(0, i + 1).join("/"));
    folder = folders.next();
  }
  return folder;
}

/**
 * Navigates the Google Drive folder path to find a file.
 * relativePath is relative to the vault root (e.g., "Areas/Reading/Inbox.md").
 */
function getFileByPath(relativePath, config) {
  const parts = relativePath.split("/");
  const fileName = parts.pop();
  let folder = getVaultFolder(config);

  for (let i = 0; i < parts.length; i++) {
    const folders = folder.getFoldersByName(parts[i]);
    if (!folders.hasNext()) {
      throw new Error("Folder not found: " + parts[i] + " in " + relativePath);
    }
    folder = folders.next();
  }

  const files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    throw new Error(fileName + " not found in " + relativePath);
  }
  return files.next();
}

/**
 * Escapes characters that have special meaning in Markdown link syntax.
 * Prevents crafted email subjects from injecting arbitrary URLs.
 */
function escapeMd(text) {
  return text
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Escapes HTML special characters for safe display.
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
