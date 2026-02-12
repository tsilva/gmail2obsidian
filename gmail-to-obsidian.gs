/**
 * Gmail-to-Obsidian Bulk Flush Script
 *
 * Reads Gmail threads from configured labels, formats them as Obsidian
 * checkbox tasks with Gmail permalinks, and appends them to target files
 * in your vault on Google Drive. Removes the label (and unstars) after
 * processing.
 *
 * Setup:
 *   1. Go to https://script.google.com → New Project
 *   2. Paste this script
 *   3. Set CONFIG.VAULT_FOLDER and CONFIG.ROUTES to match your setup
 *   4. Deploy → Web App → Execute as "Me" → Access "Only myself"
 *   5. Copy the web app URL → Bookmark it in your browser
 *   6. During triage: select emails → apply labels → click bookmark
 */

const CONFIG = {
  VAULT_FOLDER: "Obsidian/YourVault", // Google Drive path to vault root
  ROUTES: [
    { label: "to-obsidian",         file: "Inbox.md" },
    { label: "to-obsidian/reading", file: "Areas/Reading/Inbox.md" },
    { label: "to-obsidian/work",    file: "Areas/Work/Inbox.md" },
  ],
};

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
    if (r.count > 0) {
      html += "<h2>" + escapeHtml(r.file) + " (" + r.count + ")</h2><ul>";
      for (let j = 0; j < r.subjects.length; j++) {
        html += "<li>" + escapeHtml(r.subjects[j]) + "</li>";
      }
      html += "</ul>";
    }
  }

  html += "</body></html>";

  return HtmlService.createHtmlOutput(html);
}

/**
 * Core logic: iterate over routes, read labeled emails, append to target
 * files, clean up labels/stars. Returns array of per-route results.
 */
function flushToObsidian() {
  const results = [];

  for (let r = 0; r < CONFIG.ROUTES.length; r++) {
    const route = CONFIG.ROUTES[r];
    try {
      const label = GmailApp.getUserLabelByName(route.label);
      if (!label) {
        results.push({ label: route.label, file: route.file, count: 0, subjects: [] });
        continue;
      }

      const threads = label.getThreads();
      if (threads.length === 0) {
        results.push({ label: route.label, file: route.file, count: 0, subjects: [] });
        continue;
      }

      const entries = [];
      const subjects = [];

      for (let i = 0; i < threads.length; i++) {
        const thread = threads[i];
        const firstMessage = thread.getMessages()[0];

        const subject = thread.getFirstMessageSubject() || "(no subject)";
        const sender = extractSenderName(firstMessage.getFrom());
        const date = Utilities.formatDate(
          firstMessage.getDate(),
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        );
        const permalink = "https://mail.google.com/mail/u/0/#all/" + thread.getId();

        entries.push("- [ ] [" + subject + "](" + permalink + ") (from: " + sender + ", " + date + ")");
        subjects.push(subject);

        thread.removeLabel(label);

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

      const file = getFileByPath(route.file);
      const existing = file.getBlob().getDataAsString();
      file.setContent(block + existing);

      results.push({ label: route.label, file: route.file, count: threads.length, subjects: subjects });
    } catch (e) {
      results.push({ label: route.label, file: route.file, count: 0, subjects: [], error: e.message });
    }
  }

  return results;
}

/**
 * Navigates the Google Drive folder path to find a file.
 * relativePath is relative to VAULT_FOLDER (e.g., "Areas/Reading/Inbox.md").
 */
function getFileByPath(relativePath) {
  const fullPath = CONFIG.VAULT_FOLDER + "/" + relativePath;
  const parts = fullPath.split("/");
  const fileName = parts.pop();
  let folder = DriveApp.getRootFolder();

  for (let i = 0; i < parts.length; i++) {
    const folders = folder.getFoldersByName(parts[i]);
    if (!folders.hasNext()) {
      throw new Error("Folder not found: " + parts.slice(0, i + 1).join("/"));
    }
    folder = folders.next();
  }

  const files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    throw new Error(fileName + " not found in " + parts.join("/"));
  }
  return files.next();
}

/**
 * Extracts a display name from a "Name <email>" string.
 */
function extractSenderName(fromField) {
  const match = fromField.match(/^"?([^"<]+)"?\s*</);
  if (match) {
    return match[1].trim();
  }
  // Fallback: return the whole field (usually just an email address)
  return fromField.replace(/<[^>]+>/, "").trim() || fromField;
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
