// ---------------------------------------------------------------------------
// Deterministic document facts.
//
// PDF and DOCX text extraction reflows form fields: underscores disappear and
// a value can land next to a label it does not belong to. Left to itself the
// model reads "...approved by the Labor Commissioner on the day of 20 Date:
// October 18, 2022" and reports a 2022 approval date that the document does
// not contain. Everything below is computed from the text by code and handed
// to the model as authoritative, so dates, blanks and execution status are
// never inferred from reflowed layout.
// ---------------------------------------------------------------------------

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

const RE_DATE_FULL = new RegExp(
  "(?:" + MONTHS + ")\\s+\\d{1,2}(?:st|nd|rd|th)?\\s*,?\\s*(?:19|20)\\d{2}" +
  "|\\d{1,2}(?:st|nd|rd|th)?\\s+day\\s+of\\s+(?:" + MONTHS + ")\\s*,?\\s*(?:19|20)\\d{2}" +
  "|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:" + MONTHS + ")\\s*,?\\s*(?:19|20)\\d{2}" +
  "|\\d{1,2}/\\d{1,2}/(?:\\d{2}|\\d{4})", "gi");

// A date template whose day/month/year were never filled in. Underscores often
// vanish in extraction, so "the ___ day of ______ 20__" can arrive as
// "the day of 20".
const RE_DATE_BLANK = new RegExp(
  "(?:this|on\\s+the|the)\\s+_*\\s*day\\s+of\\s+_*\\s*(?:(?:" + MONTHS + ")\\s*)?_*\\s*(?:20\\s*_*)?(?![\\s,]*\\d)" +
  "|this\\s+_{1,}\\s*(?:day\\s+)?of\\s+(?:" + MONTHS + ")" +
  "|\\b(?:19|20)\\s*_{2,}", "gi");

const RE_BLANK_RUN = /_{3,}/g;
const RE_YEAR = /\b(?:19|20)\d{2}\b/g;
const RE_PCT = /\b\d{1,3}(?:\.\d+)?\s*(?:%|percent)/gi;
const RE_LABEL = /\b(By|Date|Name|Address|Title|Email|Signature|Signed|Print(?:ed)?\s+Name)\s*:/gi;
const RE_ATTACH = /\b(?:the\s+)?((?:[A-Z][A-Za-z]*\s+){0,3}(?:Schedule|Exhibit|Attachment|Addendum|Appendix|Annex)(?:\s+[A-Z0-9])?)\b/g;

function ctx(text, i, len, pad) {
  const a = Math.max(0, i - pad);
  const b = Math.min(text.length, i + len + pad);
  return (a > 0 ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ").trim() + (b < text.length ? "…" : "");
}

function pageOf(text, i) {
  const before = text.slice(0, i);
  const m = before.match(/=====\s*PAGE\s+(\d+)\s*=====/g);
  if (!m || !m.length) return null;
  const last = m[m.length - 1].match(/\d+/);
  return last ? parseInt(last[0], 10) : null;
}

function uniqBy(arr, key) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function findAll(text, re, pad) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ value: m[0].replace(/\s+/g, " ").trim(), index: m.index, page: pageOf(text, m.index), context: ctx(text, m.index, m[0].length, pad || 70) });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

// A signature is ink or an image and never appears in extracted text, so
// execution status is not knowable here. The only checkable claim is whether a
// recognisable date immediately follows a "Date:" label in the extracted
// stream — and even that is adjacency, not layout, so it is reported as such.
function dateFieldStatus(text) {
  const out = [];
  RE_LABEL.lastIndex = 0;
  let m;
  while ((m = RE_LABEL.exec(text)) !== null) {
    const label = m[1].replace(/\s+/g, " ");
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60).replace(/^[\s\u00A0]+/, "");
    if (/^date$/i.test(label)) {
      const d = after.match(new RegExp("^(?:" + RE_DATE_FULL.source + ")", "i"));
      out.push({ kind: "date", page: pageOf(text, m.index),
                 follows: d ? d[0].replace(/\s+/g, " ").trim() : null });
    } else {
      out.push({ kind: "signature", label: label, page: pageOf(text, m.index) });
    }
  }
  return out;
}

function detectReflow(text) {
  const pages = {};
  findAll(text, RE_LABEL, 0).forEach((h) => { if (h.page != null) pages[h.page] = (pages[h.page] || 0) + 1; });
  return Object.keys(pages).filter((p) => pages[p] >= 3).map(Number);
}

function missingAttachments(text) {
  const named = uniqBy(findAll(text, RE_ATTACH, 50), (x) => x.value.toLowerCase());
  return named.map((n) => {
    // Referenced more than once, or appearing as its own heading, suggests it is present.
    const bare = n.value.replace(/\s+/g, "\\s+");
    const count = (text.match(new RegExp(bare, "gi")) || []).length;
    return { name: n.value, mentions: count, context: n.context };
  });
}

function extractDocFacts(text) {
  const t = text || "";
  const dates = uniqBy(findAll(t, RE_DATE_FULL, 70), (x) => x.value.toLowerCase() + "|" + x.index);
  const blankDates = findAll(t, RE_DATE_BLANK, 70);
  const blanks = findAll(t, RE_BLANK_RUN, 50);
  const years = uniqBy(findAll(t, RE_YEAR, 0), (x) => x.value);
  const pcts = uniqBy(findAll(t, RE_PCT, 60), (x) => x.value.toLowerCase());
  return {
    dates, blankDates, blanks,
    years: years.map((y) => y.value),
    percentages: pcts,
    dateFields: dateFieldStatus(t),
    reflowPages: detectReflow(t),
    attachments: missingAttachments(t),
    hasPageMarkers: /=====\s*PAGE\s+\d+\s*=====/.test(t),
  };
}

// Render the facts for the prompt.
function renderDocFacts(f) {
  const L = [];
  L.push("DATES ACTUALLY PRESENT (every complete date in the text, with its surrounding words):");
  if (!f.dates.length) L.push("  (none)");
  f.dates.forEach((d) => L.push(`  - "${d.value}"${d.page ? ` [page ${d.page}]` : ""} — context: ${d.context}`));

  L.push("");
  L.push("UNFILLED DATE TEMPLATES (a date line that was never completed):");
  if (!f.blankDates.length) L.push("  (none)");
  f.blankDates.forEach((d) => L.push(`  - "${d.value}"${d.page ? ` [page ${d.page}]` : ""} — context: ${d.context}`));

  if (f.blanks.length) {
    L.push("");
    L.push(`OTHER UNFILLED BLANKS: ${f.blanks.length} run(s) of underscores.`);
    f.blanks.slice(0, 8).forEach((b) => L.push(`  - context: ${b.context}`));
  }

  L.push("");
  L.push("DATE FIELDS \u2014 whether a recognisable date immediately follows each \"Date:\" label:");
  const dfs = f.dateFields.filter((x) => x.kind === "date");
  if (!dfs.length) L.push("  (no date fields found)");
  dfs.forEach((x, i) => L.push(`  - Date field ${i + 1}${x.page ? ` [page ${x.page}]` : ""}: ${x.follows ? `"${x.follows}" follows it` : "NO DATE FOLLOWS IT"}`));
  const sigs = f.dateFields.filter((x) => x.kind === "signature").length;
  L.push(`  Signature-type labels found: ${sigs}. A signature is ink or an image and does NOT appear in extracted text, so whether anyone signed CANNOT be determined here.`);

  if (f.attachments.length) {
    L.push("");
    L.push("REFERENCED SCHEDULES / EXHIBITS (mention count across the text):");
    f.attachments.forEach((a) => L.push(`  - ${a.name}: mentioned ${a.mentions}×${a.mentions <= 1 ? " — referenced but no separate section of that name appears" : ""}`));
  }

  if (f.percentages.length) {
    L.push("");
    L.push("PERCENTAGES PRESENT: " + f.percentages.map((p) => `"${p.value}"`).join(", "));
  }
  L.push("YEARS PRESENT: " + (f.years.length ? f.years.join(", ") : "(none)"));

  L.push("");
  L.push("HOW TO USE THIS BLOCK — it is produced by code from the document text and OVERRIDES your own reading:");
  L.push("- Never state a date the DATES list does not contain, and never report a date as filled in when it appears only in UNFILLED DATE TEMPLATES.");
  L.push("- NEVER state that this document is signed, executed, countersigned or unsigned, and never describe signature blocks as blank or completed. That is not visible in the text. Describe only the date fields listed above.");
  L.push("- A \"Date:\" label that a date follows is adjacency in the extracted stream, not proof the date belongs to that field.");
  L.push("- Do not state any percentage or year that is not listed above.");
  if (f.reflowPages.length) {
    L.push(`- WARNING — REFLOWED LAYOUT on page(s) ${f.reflowPages.join(", ")}: this page holds several form fields, and extraction does not preserve their visual positions. A date appearing next to a label in the raw text may belong to a different field, or to none. Do NOT attribute a date to a label, or to the approval line, on the strength of where it sits in the extracted text. Say which dates appear on the page and that their placement cannot be determined from the text.`);
  }
  return L.join("\n");
}

// --- Post-hoc audit --------------------------------------------------------
// Catch a year or percentage the model asserts that is absent from the source.
function auditClaims(classification, text, facts) {
  const warnings = [];
  const years = new Set(facts.years);
  const pcts = new Set(facts.percentages.map((p) => p.value.replace(/\s+/g, "").toLowerCase().replace("percent", "%")));
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(classification);
  strings.forEach((s) => {
    (s.match(RE_YEAR) || []).forEach((y) => {
      if (!years.has(y)) warnings.push(`The analysis mentions the year ${y}, which does not appear in the document text.`);
    });
    (s.match(RE_PCT) || []).forEach((p) => {
      const norm = p.replace(/\s+/g, "").toLowerCase().replace("percent", "%");
      if (!pcts.has(norm)) warnings.push(`The analysis mentions ${p}, which does not appear in the document text.`);
    });
  });
  return uniqBy(warnings.map((w) => ({ w })), (x) => x.w).map((x) => x.w);
}


export { extractDocFacts, renderDocFacts, auditClaims };
