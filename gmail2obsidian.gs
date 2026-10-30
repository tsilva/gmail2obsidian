/**
 * Gmail-to-Obsidian Bulk Flush Script
 *
 * Reads Gmail threads from configured labels, formats them as configurable
 * Obsidian entries (checkbox/bullet/plain, with or without Gmail permalinks),
 * and prepends them to target files
 * in your vault on Google Drive. Removes the label after processing.
 * Supports cross-account setups via shared Drive folders.
 *
 * Setup: see README.md or run `make setup` for instructions.
 * Configuration lives in config.gs (not committed — copy from config.example.gs).
 */
const PROCESS_TAG = "#process";
const LEGACY_THREAD_MARKER_PREFIX = "gmail2obsidian-thread:";
const FLUSH_LOCK_TIMEOUT_MS = 30000;
const FLUSH_INTENT_TTL_SECONDS = 300;

/**
 * Opening the bookmark only prepares an owner-confirmed, single-use action.
 */
function doGet() {
  requireFlushOwner_();
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  CacheService.getUserCache().put("flush-intent:" + token,
    String(Date.now() + FLUSH_INTENT_TTL_SECONDS * 1000), FLUSH_INTENT_TTL_SECONDS);
  const html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
    + "</head><body><h1>Gmail to Obsidian</h1>"
    + "<p>Flush labeled threads to your configured Drive files, then remove their labels and archive them.</p>"
    + "<button id='flush' type='button'>Flush labeled emails</button><p id='status' role='status'></p>"
    + "<script>document.getElementById('flush').addEventListener('click',function(){"
    + "this.disabled=true;document.getElementById('status').textContent='Flushing…';"
    + "google.script.run.withSuccessHandler(function(summary){document.open();document.write(summary);document.close();})"
    + ".withFailureHandler(function(){document.getElementById('status').textContent='Flush failed or confirmation expired. Reload to confirm again.';})"
    + ".confirmFlush(" + JSON.stringify(token) + ");});</script></body></html>";
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Owner-only browser mutator. Consume intent while holding the flush lock.
 */
function confirmFlush(token) {
  requireFlushOwner_();
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("Invalid flush confirmation.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(FLUSH_LOCK_TIMEOUT_MS);
  try {
    const cache = CacheService.getUserCache();
    const key = "flush-intent:" + token;
    const expiry = Number(cache.get(key));
    cache.remove(key);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      throw new Error("Flush confirmation expired or already used. Reload to confirm again.");
    }
    return renderFlushSummary_(flushToObsidianLocked_());
  } finally {
    lock.releaseLock();
  }
}

/**
 * Public webhook deployments must not expose the browser confirmation path.
 * An unavailable visitor identity fails closed; effective user alone is unsafe
 * because an execute-as-owner deployment uses the owner for every caller.
 */
function requireFlushOwner_() {
  const visitor = Session.getActiveUser().getEmail();
  const owner = Session.getEffectiveUser().getEmail();
  if (!visitor || !owner || visitor !== owner) {
    throw new Error("Open this page while signed in as the deployment owner.");
  }
}

/**
 * Optional authenticated trigger. Secrets stay in Script Properties; requests
 * cannot override routes, files, account, or processing limits.
 */
function doPost(e) {
  try {
    return webhookJson_(handleWebhook_(e));
  } catch (error) {
    // Never expose Google errors, paths, message content, or credentials.
    return webhookJson_({ ok: false, status: "failed_or_unknown" });
  }
}

function handleWebhook_(e) {
  const denied = { ok: false, status: "unauthorized" };
  if (!e || !e.postData || typeof e.postData.contents !== "string"
      || e.postData.contents.length > 1024
      || String(e.postData.type).split(";")[0].trim() !== "application/json") return denied;
  let request;
  try { request = JSON.parse(e.postData.contents); } catch (error) { return denied; }
  if (!request || Array.isArray(request) || typeof request !== "object"
      || !Number.isSafeInteger(request.timestamp)
      || typeof request.requestId !== "string" || !/^[a-f0-9]{32}$/.test(request.requestId)) return denied;
  const fields = Object.keys(request).sort().join(",");
  const proxyMode = fields === "action,requestId,timestamp,token";
  if (proxyMode) {
    if ((request.action !== "flush" && request.action !== "check")
        || typeof request.token !== "string" || !/^[a-f0-9]{64}$/.test(request.token)) return denied;
  } else if (fields !== "action,requestId,signature,timestamp" || request.action !== "flush"
      || typeof request.signature !== "string" || !/^[a-f0-9]{64}$/.test(request.signature)) return denied;
  const now = Math.floor(Date.now() / 1000);
  if (request.timestamp < now - 120 || request.timestamp > now + 30) return denied;
  const properties = PropertiesService.getScriptProperties();
  const secretProperty = proxyMode ? "WEBHOOK_PROXY_TOKEN" : "WEBHOOK_SECRET";
  const secret = properties.getProperty(secretProperty);
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return denied;
  let expected = secret;
  if (!proxyMode) {
    const payload = "gmail2obsidian:v1\nflush\n" + request.timestamp + "\n" + request.requestId;
    const bytes = Utilities.computeHmacSha256Signature(payload, secret, Utilities.Charset.UTF_8);
    expected = bytes.map(function(b) { return (b & 255).toString(16).padStart(2, "0"); }).join("");
  }
  const supplied = proxyMode ? request.token : request.signature;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  if (difference !== 0) return denied;
  // Authenticated smoke test: no Gmail, Drive, replay-state or lock operations.
  if (request.action === "check") return { ok: true, status: "authenticated" };

  const lock = LockService.getScriptLock();
  // A busy import has not consumed this request and may be retried unchanged.
  if (!lock.tryLock(1000)) return { ok: false, status: "busy" };
  try {
    // Recheck after waiting and reject signatures made with a rotated key.
    const lockedNow = Math.floor(Date.now() / 1000);
    if (request.timestamp < lockedNow - 120 || request.timestamp > lockedNow + 30
        || properties.getProperty(secretProperty) !== secret) return denied;
    // Durable replay protection: CacheService may evict unexpired entries.
    const used = JSON.parse(properties.getProperty("WEBHOOK_USED_REQUESTS") || "{}");
    if (!used || Array.isArray(used) || typeof used !== "object") throw new Error("Invalid replay state.");
    Object.keys(used).forEach(function(id) {
      if (!Number.isSafeInteger(used[id])) throw new Error("Invalid replay state.");
      if (used[id] < lockedNow) delete used[id];
    });
    if (Object.prototype.hasOwnProperty.call(used, request.requestId)) {
      return { ok: false, status: "already_used" };
    }
    // Stay below the 9 KB per-property quota even during unexpected bursts.
    if (Object.keys(used).length >= 100) return { ok: false, status: "busy" };
    used[request.requestId] = request.timestamp + 120;
    properties.setProperty("WEBHOOK_USED_REQUESTS", JSON.stringify(used));
    const results = flushToObsidianLocked_();
    const errors = results.filter(function(r) { return r.error; }).length;
    const warnings = results.filter(function(r) { return r.warning; }).length;
    return {
      ok: errors === 0 && warnings === 0,
      status: errors ? "partial_failure" : warnings ? "more_may_remain" : "complete",
      imported: results.reduce(function(sum, r) { return sum + (r.count || 0); }, 0),
      errors: errors,
      warnings: warnings
    };
  } finally {
    lock.releaseLock();
  }
}

function webhookJson_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Render only server-generated summaries; all imported strings are escaped.
 */
function renderFlushSummary_(results) {
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
      html += "<div class='error'>Error [" + escapeHtml_(r.label) + " → " + escapeHtml_(r.file) + "]: " + escapeHtml_(r.error) + "</div>";
    }
    if (r.warning) {
      html += "<div class='error'>" + escapeHtml_(r.warning) + "</div>";
    }
    if (r.count > 0) {
      html += "<h2>" + escapeHtml_(r.file) + " (" + r.count + ")</h2><ul>";
      for (let j = 0; j < r.subjects.length; j++) {
        html += "<li>" + escapeHtml_(r.subjects[j]) + "</li>";
      }
      html += "</ul>";
    }
  }

  html += "</body></html>";

  return html;
}

/**
 * Validates config at startup. Throws with a clear message if misconfigured.
 */
function validateConfig_(config) {
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
 * Expands configured routes with discovered child Gmail labels.
 * A base route like { label: "obsidian", file: "@inbox.md" } also handles
 * labels such as "obsidian/parsefood" by resolving parsefood.md,
 * git-parsefood.md, or falling back to the base inbox file.
 */
function expandRoutes_(config) {
  const configuredRoutes = config.ROUTES.slice();
  const explicitLabels = {};
  for (let i = 0; i < configuredRoutes.length; i++) {
    explicitLabels[configuredRoutes[i].label] = true;
  }

  const expanded = configuredRoutes.slice();
  const userLabels = GmailApp.getUserLabels();

  for (let l = 0; l < userLabels.length; l++) {
    const labelName = userLabels[l].getName();
    if (explicitLabels[labelName]) continue;

    const baseRoute = getDynamicBaseRoute_(labelName, configuredRoutes);
    if (!baseRoute) continue;

    const suffix = labelName.slice(baseRoute.label.length + 1);
    if (!suffix) continue;

    expanded.push({
      label: labelName,
      file: baseRoute.file,
      dynamicSuffix: suffix
    });
  }

  return expanded;
}

/**
 * Orders more specific labels before their parents so child routes can clean up
 * parent labels before parent routes are evaluated.
 */
function sortRoutesBySpecificity_(routes) {
  return routes
    .map(function(route, index) {
      return { route: route, index: index };
    })
    .sort(function(a, b) {
      const depthDiff = getLabelDepth_(b.route.label) - getLabelDepth_(a.route.label);
      if (depthDiff !== 0) return depthDiff;
      const lengthDiff = b.route.label.length - a.route.label.length;
      if (lengthDiff !== 0) return lengthDiff;
      return a.index - b.index;
    })
    .map(function(item) {
      return item.route;
    });
}

/**
 * Returns the number of segments in a Gmail label path.
 */
function getLabelDepth_(labelName) {
  return labelName.split("/").length;
}

/**
 * Finds the longest configured route that can act as the parent for a child label.
 */
function getDynamicBaseRoute_(labelName, routes) {
  let match = null;
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const prefix = route.label + "/";
    if (labelName.indexOf(prefix) !== 0) continue;
    if (!match || route.label.length > match.label.length) {
      match = route;
    }
  }
  return match;
}

/**
 * Resolves a dynamic label suffix to a target file next to the base inbox file.
 */
function resolveDynamicTarget_(baseFile, suffix, config) {
  const folderPath = getFolderPath_(baseFile);
  const slug = suffix.replace(/\//g, "-");
  const candidates = [
    appendPath_(folderPath, slug + ".md"),
    appendPath_(folderPath, "git-" + slug + ".md")
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (fileExistsByPath_(candidates[i], config)) {
      return { file: candidates[i], fallback: false };
    }
  }

  return { file: baseFile, fallback: true };
}

/**
 * Keeps a parent route from processing a thread that also has a child label.
 */
function filterThreadsForMostSpecificLabel_(threads, routeLabel) {
  const filtered = [];
  for (let i = 0; i < threads.length; i++) {
    if (!threadHasChildLabel_(threads[i], routeLabel)) {
      filtered.push(threads[i]);
    }
  }
  return filtered;
}

/**
 * Returns whether a thread has any Gmail label below routeLabel.
 */
function threadHasChildLabel_(thread, routeLabel) {
  const prefix = routeLabel + "/";
  const labels = thread.getLabels();
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].getName().indexOf(prefix) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Looks up the route label and its ancestors so child flushes also clear parent labels.
 */
function getRouteLabelObjects_(labelName) {
  const names = getRouteLabelNames_(labelName);
  const labels = [];
  for (let i = 0; i < names.length; i++) {
    const label = GmailApp.getUserLabelByName(names[i]);
    if (label) {
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Returns a route label followed by each ancestor label.
 */
function getRouteLabelNames_(labelName) {
  const parts = labelName.split("/");
  const names = [];
  for (let i = parts.length; i > 0; i--) {
    names.push(parts.slice(0, i).join("/"));
  }
  return names;
}

/**
 * Returns the first message body as one line, or an empty string when absent.
 */
function getThreadBodyText_(thread) {
  const messages = thread.getMessages();
  if (!messages || messages.length === 0) {
    return "";
  }
  return normalizeEntryBody_(messages[0].getPlainBody() || "");
}

/**
 * Collapses email body whitespace so each Obsidian entry stays on one line.
 */
function normalizeEntryBody_(body) {
  return body.replace(/\s+/g, " ").trim();
}

/**
 * Returns the legacy Markdown marker used by older flushed entries.
 */
function getLegacyThreadMarker_(threadId) {
  return "<!-- " + LEGACY_THREAD_MARKER_PREFIX + threadId + " -->";
}

/**
 * Returns whether a target file contains a legacy entry for a Gmail thread.
 */
function hasLegacyThreadMarker_(content, threadId) {
  return content.indexOf(getLegacyThreadMarker_(threadId)) !== -1;
}

/**
 * Serializes flushes so overlapping web requests cannot process the same labels.
 */
function flushToObsidian_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(FLUSH_LOCK_TIMEOUT_MS);
  try {
    return flushToObsidianLocked_();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Core logic: iterate over routes, read labeled emails, prepend to target
 * files, clean up labels. Must be called while holding the script lock.
 * Returns array of per-route results.
 */
function flushToObsidianLocked_() {
  const config = CONFIG;
  validateConfig_(config);
  const results = [];
  const gmailAccountIndex = config.GMAIL_ACCOUNT_INDEX || 0;
  const routes = sortRoutesBySpecificity_(expandRoutes_(config));

  for (let r = 0; r < routes.length; r++) {
    const route = routes[r];
    try {
      const label = GmailApp.getUserLabelByName(route.label);
      if (!label) {
        results.push({ label: route.label, file: route.file, count: 0, subjects: [] });
        continue;
      }

      const maxThreads = config.MAX_THREADS || 50;
      const fetchedThreads = label.getThreads(0, maxThreads);
      const threads = filterThreadsForMostSpecificLabel_(fetchedThreads, route.label);
      if (threads.length === 0) {
        results.push({ label: route.label, file: route.file, count: 0, subjects: [] });
        continue;
      }

      let targetFile = route.file;
      let fallbackPrefix = route.fallbackPrefix || "";
      if (route.dynamicSuffix) {
        const target = resolveDynamicTarget_(route.file, route.dynamicSuffix, config);
        targetFile = target.file;
        fallbackPrefix = target.fallback ? "#" + getLabelLeaf_(route.dynamicSuffix) : "";
      }

      const file = getFileByPath_(targetFile, config);
      const existing = file.getBlob().getDataAsString();
      const entries = [];
      const subjects = [];
      const pendingThreadIds = Object.create(null);
      const prefixMap = { "checkbox": "- [ ] ", "bullet": "- ", "none": "" };
      const prefix = config.ENTRY_PREFIX in prefixMap ? prefixMap[config.ENTRY_PREFIX] : "- [ ] ";
      const entryLink = config.ENTRY_LINK === true;

      for (let i = 0; i < threads.length; i++) {
        const thread = threads[i];
        const threadId = thread.getId();
        if (hasLegacyThreadMarker_(existing, threadId) || pendingThreadIds[threadId]) {
          continue;
        }
        pendingThreadIds[threadId] = true;

        const subject = thread.getFirstMessageSubject() || "(no subject)";
        const bodyText = getThreadBodyText_(thread);
        const permalink = "https://mail.google.com/mail/u/" + gmailAccountIndex + "/#all/" + threadId;

        const subjectText = escapeMd_(subject);
        let text = entryLink ? "[" + subjectText + "](" + permalink + ")" : subjectText;
        if (bodyText && bodyText !== normalizeEntryBody_(subject)) {
          text += " (body: " + escapeMd_(bodyText) + ")";
        }
        if (fallbackPrefix) {
          text = fallbackPrefix + " " + text;
        }
        entries.push(prefix + text);
        subjects.push(subject);
      }

      if (entries.length > 0) {
        const entryHeader = config.ENTRY_HEADER !== false;
        let block;
        if (entryHeader) {
          const today = Utilities.formatDate(
            new Date(),
            Session.getScriptTimeZone(),
            "yyyy-MM-dd"
          );
          block = "## Flushed " + today + "\n" + entries.join("\n") + "\n\n";
        } else {
          block = entries.join("\n") + "\n\n";
        }

        file.setContent(ensureProcessTag_(block + existing));
      }

      // Only remove labels after successful flush.
      const labelsToRemove = getRouteLabelObjects_(route.label);
      for (let i = 0; i < threads.length; i++) {
        for (let j = 0; j < labelsToRemove.length; j++) {
          threads[i].removeLabel(labelsToRemove[j]);
        }
        threads[i].moveToArchive();
      }

      const result = { label: route.label, file: targetFile, count: entries.length, subjects: subjects };
      if (fetchedThreads.length >= maxThreads) {
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
function getVaultFolder_(config) {
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
 * Navigates to a folder path relative to the vault root.
 */
function getFolderByPath_(relativePath, config) {
  const parts = relativePath ? relativePath.split("/") : [];
  let folder = getVaultFolder_(config);

  for (let i = 0; i < parts.length; i++) {
    const folders = folder.getFoldersByName(parts[i]);
    if (!folders.hasNext()) {
      throw new Error("Folder not found: " + parts[i] + " in " + relativePath);
    }
    folder = folders.next();
  }

  return folder;
}

/**
 * Navigates the Google Drive folder path to find a file.
 * relativePath is relative to the vault root (e.g., "Areas/Reading/Inbox.md").
 */
function getFileByPath_(relativePath, config) {
  const parts = relativePath.split("/");
  const fileName = parts.pop();
  const folder = getFolderByPath_(parts.join("/"), config);

  const files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    throw new Error(fileName + " not found in " + relativePath);
  }
  return files.next();
}

/**
 * Returns whether a file exists at a vault-relative path.
 */
function fileExistsByPath_(relativePath, config) {
  try {
    getFileByPath_(relativePath, config);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Returns the folder portion of a vault-relative file path.
 */
function getFolderPath_(relativePath) {
  const parts = relativePath.split("/");
  parts.pop();
  return parts.join("/");
}

/**
 * Appends a file name to a vault-relative folder path.
 */
function appendPath_(folderPath, fileName) {
  return folderPath ? folderPath + "/" + fileName : fileName;
}

/**
 * Returns the last segment of a nested Gmail label suffix.
 */
function getLabelLeaf_(suffix) {
  const parts = suffix.split("/");
  return parts[parts.length - 1];
}

/**
 * Ensures a markdown file that receives entries is tagged for Obsidian processing.
 */
function ensureProcessTag_(content) {
  if (hasObsidianTag_(content, "process")) {
    return content;
  }
  return PROCESS_TAG + "\n\n" + content;
}

/**
 * Checks for a standalone Obsidian tag without matching longer tags like #processing.
 */
function hasObsidianTag_(content, tagName) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("(^|[^A-Za-z0-9_/-])#" + escapedTag + "(?=$|[^A-Za-z0-9_/-])");
  return pattern.test(content);
}

/**
 * Keep imported text literal, including links, embeds, HTML and backslashes.
 * Markdown permits escaping all ASCII punctuation with a backslash.
 */
function escapeMd_(text) {
  return normalizeEntryBody_(text).replace(/[!-/:-@\[-`{-~]/g, function(character) {
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === "&") return "&amp;";
    return "\\" + character;
  });
}

/**
 * Escapes HTML special characters for safe display.
 */
function escapeHtml_(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
