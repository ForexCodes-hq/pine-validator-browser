import { validate, looksLikePine } from "./validator.js";

const $ = (id) => document.getElementById(id);
const codeEl = $("code");
const out = $("out");

const sevColor = (s) => (s === "critical" ? "var(--crit)" : s === "high" ? "#e8590c" : s === "medium" ? "var(--amber)" : "var(--muted)");
const label = (code) =>
  code === "L1" ? "Look-ahead bias" : code === "R1" ? "Repaint" : code === "L3" ? "Backtest/live divergence" : code === "IN" ? "Intent mismatch" : "Hygiene";

function scoreFrom(c) {
  return Math.max(0, Math.min(100, 100 - (c.critical * 35 + c.high * 18 + c.medium * 8 + c.info * 2)));
}

function render() {
  const code = codeEl.value;
  out.innerHTML = "";
  if (code.trim().length < 10) { out.innerHTML = `<div class="err">Paste a Pine Script first.</div>`; return; }
  if (!looksLikePine(code)) {
    out.innerHTML = `<div class="err">That doesn't look like Pine Script — it should contain //@version=6, indicator(), plot()…</div>`;
    return;
  }
  const { findings, counts } = validate(code);
  const score = scoreFrom(counts);
  const ringColor = counts.critical ? "var(--crit)" : counts.high || score < 90 ? "var(--amber)" : "var(--green)";

  const head = document.createElement("div");
  head.className = "score";
  head.innerHTML = `<div class="ring" style="border-color:${ringColor}">${score}</div>
    <div><div class="lab">Strategy Health Score™</div>
    <div style="font-size:12.5px;margin-top:2px">${findings.length === 0 ? "Clean — no issues found" : `${findings.length} issue${findings.length > 1 ? "s" : ""} · ${counts.critical} critical · ${counts.high} high`}</div></div>`;
  out.appendChild(head);

  for (const f of findings) {
    const d = document.createElement("div");
    d.className = "f";
    d.style.borderLeftColor = sevColor(f.severity);
    d.innerHTML = `<span class="sev" style="color:${sevColor(f.severity)}">${f.severity}</span>
      <b> ${label(f.code)}</b> <span style="color:var(--muted)">line ${f.line}</span>
      <div class="msg">${escapeHtml(f.message)}</div>
      <div class="msg" style="color:var(--text);margin-top:4px"><b style="color:var(--green)">Fix:</b> ${escapeHtml(f.fix)}</div>`;
    out.appendChild(d);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("check").addEventListener("click", render);
$("paste").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { codeEl.value = text; render(); }
  } catch {
    out.innerHTML = `<div class="err">Couldn't read the clipboard — paste manually (Cmd/Ctrl+V) and hit Check.</div>`;
  }
});
codeEl.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") render(); });
