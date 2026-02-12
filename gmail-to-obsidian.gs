/**
 * Gmail-to-Obsidian Bulk Flush Script
 *
 * Reads all Gmail threads with the "to-obsidian" label, formats them as
 * Obsidian checkbox tasks, and appends them to Inbox.md in your vault
 * on Google Drive. Removes the label (and unstars) after processing.
 *
 * Setup:
 *   1. Go to https://script.google.com → New Project
 *   2. Paste this script
 *   3. Set CONFIG.VAULT_FOLDER to your Obsidian vault path in Google Drive
 *   4. Deploy → Web App → Execute as "Me" → Access "Only myself"
 *   5. Copy the web app URL → Bookmark it in your browser
 *   6. During triage: select emails → apply "to-obsidian" label → click bookmark
 */

const CONFIG = {
  VAULT_FOLDER: "Obsidian/YourVault", // Google Drive path to vault root
  INBOX_FILE: "Inbox.md",             // Target file in vault root
  GMAIL_LABEL: "to-obsidian",         // Gmail label to process
};

/**
 * Web app entry point. Calls flushToObsidian and returns an HTML summary.
 */
function doGet() {
  const result = flushToObsidian();

  let html = "<html><head>"
    + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    + "<style>"
    + "body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 20px;}"
    + "h1{font-size:1.4em;} ul{padding-left:20px;} li{margin:4px 0;}"
    + "</style></head><body>";

  html += "<h1>Flushed " + result.count + " email" + (result.count !== 1 ? "s" : "") + " to Inbox.md</h1>";

  if (result.subjects.length > 0) {
    html += "<ul>";
    for (let i = 0; i < result.subjects.length; i++) {
      html += "<li>" + escapeHtml(result.subjects[i]) + "</li>";
    }
    html += "</ul>";
  }

  html += "</body></html>";

  return HtmlService.createHtmlOutput(html);
}

/**
 * Core logic: read labeled emails, append to Inbox.md, clean up labels/stars.
 */
function flushToObsidian() {
  const label = getOrCreateLabel(CONFIG.GMAIL_LABEL);
  const threads = label.getThreads();

  if (threads.length === 0) {
    return { count: 0, subjects: [] };
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

    entries.push("- [ ] " + subject + " (from: " + sender + ", " + date + ")");
    subjects.push(subject);

    // Remove the label
    thread.removeLabel(label);

    // Unstar if starred
    if (thread.hasStarredMessages()) {
      const messages = thread.getMessages();
      for (let j = 0; j < messages.length; j++) {
        if (messages[j].isStarred()) {
          messages[j].unstar();
        }
      }
    }
  }

  // Build the block to prepend
  const today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );
  const header = "## Flushed " + today;
  const block = header + "\n" + entries.join("\n") + "\n\n";

  // Write to Inbox.md
  const file = getInboxFile();
  const existing = file.getBlob().getDataAsString();
  file.setContent(block + existing);

  return { count: threads.length, subjects: subjects };
}

/**
 * Gets or creates the Gmail label used to mark emails for Obsidian.
 */
function getOrCreateLabel(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    label = GmailApp.createLabel(labelName);
  }
  return label;
}

/**
 * Navigates the Google Drive folder path to find Inbox.md.
 */
function getInboxFile() {
  const parts = CONFIG.VAULT_FOLDER.split("/");
  let folder = DriveApp.getRootFolder();

  for (let i = 0; i < parts.length; i++) {
    const folders = folder.getFoldersByName(parts[i]);
    if (!folders.hasNext()) {
      throw new Error("Folder not found: " + parts.slice(0, i + 1).join("/"));
    }
    folder = folders.next();
  }

  const files = folder.getFilesByName(CONFIG.INBOX_FILE);
  if (!files.hasNext()) {
    throw new Error(
      CONFIG.INBOX_FILE + " not found in " + CONFIG.VAULT_FOLDER
    );
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
