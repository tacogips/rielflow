export const BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT = 10;

export function overviewBrowserHtml(): Response {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>rielflow workflow overview</title>
<style>
  :root { font-family: system-ui, sans-serif; line-height: 1.35; color: #1a1a1a; }
  body { margin: 0; display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; }
  header { padding: 0.6rem 1rem; border-bottom: 1px solid #ddd; font-weight: 600; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 0; min-height: 0; }
  @media (max-width: 72ch) { main { grid-template-columns: 1fr; } }
  section { overflow: auto; padding: 0.75rem 1rem; border-right: 1px solid #eee; min-height: 0; }
  section:last-child { border-right: none; }
  h2 { margin: 0 0 0.5rem; font-size: 1rem; }
  ul { padding-left: 1.25rem; margin: 0; }
  .mono { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; font-size: 12px; }
  .muted { color: #555; }
  #err { padding: 0.75rem 1rem; background: #fff3cd; border-top: 1px solid #e6d29c; white-space: pre-wrap; font-size: 13px; }
  footer { padding: 0.4rem 1rem; font-size: 12px; color: #444; border-top: 1px solid #ddd; }
</style>
</head>
<body>
<header>rielflow &mdash; workflow overview</header>
<main>
  <section><h2>Workflows</h2><p id="list" class="muted">Loading...</p></section>
  <section><h2>Selected workflow</h2><p id="detail" class="muted mono">Loading...</p></section>
</main>
<div id="err" hidden></div>
<footer>JSON data: same-origin <code>/overview</code> &middot; node logs and payloads stay off this page</footer>
<script>
(function () {
  var listEl = document.getElementById("list");
  var detailEl = document.getElementById("detail");
  var errEl = document.getElementById("err");
  function showErr(msg) {
    errEl.hidden = false;
    errEl.textContent = msg;
  }
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  fetch("/overview", { headers: { Accept: "application/json" } })
    .then(function (r) {
      if (!r.ok) {
        throw new Error("overview HTTP " + r.status);
      }
      return r.json();
    })
    .then(function (payload) {
      var rows = payload.workflows || [];
      if (rows.length === 0) {
        listEl.textContent = "No workflows visible in this catalog.";
      } else {
        var html = "<ul>";
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          html += "<li><strong>" + esc(row.workflowName) + "</strong> &middot; " +
            esc(row.sourceScope || "") + " &middot; " + esc(row.aggregateStatus || "") +
            " &middot; active " + String(row.activeExecutionCount ?? 0);
          var le = row.latestExecution;
          if (le && le.startedAt) {
            html += " &middot; latest started " + esc(le.startedAt);
          }
          var d = row.description;
          if (d) {
            html += "<br/><span class=\\"muted\\">" + esc(d) + "</span>";
          }
          html += "</li>";
        }
        html += "</ul>";
        listEl.innerHTML = html;
      }
      var selected = payload.selectedWorkflow;
      if (!selected) {
        detailEl.textContent = "No workflow selected.";
        return;
      }
      var blocks = [];
      blocks.push(selected.workflowName + " (" + selected.sourceScope + ")");
      blocks.push("Directory: " + selected.workflowDirectory);
      blocks.push(selected.description ? "Description: " + selected.description : "Description: -");
      blocks.push("Aggregate status: " + selected.aggregateStatus + " \\u00b7 Active: " + String(selected.activeExecutionCount));
      if (selected.latestExecution) {
        var lx = selected.latestExecution;
        blocks.push("Latest: " + lx.sessionId + " \\u00b7 " + lx.status);
        blocks.push("Latest times: start " + (lx.startedAt || "-") + " \\u00b7 end " + (lx.endedAt || "-"));
      }
      var na = selected.newestActiveExecution;
      if (na) {
        var step =
          na.currentStepId != null ? na.currentStepId
          : (na.currentNodeId != null ? na.currentNodeId : "-");
        blocks.push("Newest active execution: " + na.workflowExecutionId + " \\u00b7 " + na.status + " \\u00b7 step " + step);
      }
      var recent = selected.recentExecutions || [];
      blocks.push("\\nRecent (" + recent.length + " shown, max ${BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT}):");
      for (var j = 0; j < recent.length; j++) {
        var ex = recent[j];
        blocks.push("  " + ex.sessionId + " \\u00b7 " + ex.status + " \\u00b7 " + (ex.startedAt || ""));
      }
      detailEl.textContent = blocks.join("\\n");
    })
    .catch(function (e) {
      listEl.textContent = "";
      detailEl.textContent = "";
      showErr(e && e.message ? e.message : String(e));
    });
})();
</script>
</body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
