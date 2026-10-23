import JSZip from "jszip";

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

// Normalize text so smart quotes, dashes, and whitespace differences don't
// break a match between two pieces of contract text.
export function normalizeForMatch(s) {
  return (s || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// Strip our injected page markers when displaying context to the reader.
export function stripPageMarkers(s) {
  return (s || "").replace(/=====\s*PAGE\s+\d+\s*=====/g, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Tracked changes and comments.
//
// mammoth returns only the body text of a .docx, with every tracked change
// already applied and all comments dropped. A redline therefore reaches the
// model looking like a clean document: the deleted wording is gone, and the
// counterparty's comments -- which carry their actual negotiating position --
// never arrive at all. Both live elsewhere in the package, so we read it
// directly and hand the model what mammoth threw away.
//
// A redline is usually several rounds stacked on top of each other: our
// earlier changes that the other side never accepted, their new changes, old
// comment threads and new replies. Everything below therefore keeps the
// author, date, location and thread of each item, so the analysis can tell
// "their changes this round" from "your own changes still pending".
// ---------------------------------------------------------------------------
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";
const W15_NS = "http://schemas.microsoft.com/office/word/2012/wordml";

function wText(el, local) {
  const nodes = el.getElementsByTagNameNS(W_NS, local);
  let s = "";
  for (let i = 0; i < nodes.length; i++) s += nodes[i].textContent || "";
  return s.replace(/\s+/g, " ").trim();
}

function wAttr(el, name) {
  return el.getAttributeNS(W_NS, name) || el.getAttribute("w:" + name) || "";
}

// Track the section label ("6", "6(b)", "6(b)(ii)") from the paragraph labels
// as they appear in the text, so every change and comment gets a location.
function makeLabeler() {
  const st = { top: "", sub: "", rom: "" };
  return function label(txt) {
    const t = (txt || "").replace(/^\s+/, "");
    let m = t.match(/^(?:Section\s+|§\s*|Paragraph\s+)?(\d+(?:\.\d+)*)[.)]?\s/i);
    if (m) { st.top = m[1]; st.sub = ""; st.rom = ""; }
    else if ((m = t.match(/^\(([ivx]{1,4})\)/)) && st.sub && !(m[1] === "i" && st.sub === "h") && !(m[1] === "v" && st.sub === "u") && !(m[1] === "x" && st.sub === "w")) { st.rom = m[1]; }
    else if ((m = t.match(/^\(([a-z]{1,2})\)/))) { st.sub = m[1]; st.rom = ""; }
    if (!st.top) return "Opening text";
    return st.top + (st.sub ? "(" + st.sub + ")" : "") + (st.rom ? "(" + st.rom + ")" : "");
  };
}

function isW(el, local) { return el && el.nodeType === 1 && el.namespaceURI === W_NS && el.localName === local; }

async function extractDocxMarkup(arrayBuffer) {
  const out = { changes: [], comments: [], paragraphs: [], authors: {}, hasMarkup: false };
  let zip;
  try { zip = await JSZip.loadAsync(arrayBuffer); } catch (e) { return out; }
  const read = async (p) => { const f = zip.file(p); return f ? await f.async("string") : null; };
  const docXml = await read("word/document.xml");
  if (!docXml) return out;

  const parser = new DOMParser();
  const doc = parser.parseFromString(docXml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return out;
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) return out;

  // Paragraph labels and current text, in document order.
  const paras = doc.getElementsByTagNameNS(W_NS, "p");
  const label = makeLabeler();
  const pIndex = new Map();
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    pIndex.set(p, i);
    let orig = "", cur = "";
    const walkP = (n, inDel) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (isW(c, "t")) { orig += c.textContent; if (!inDel) cur += c.textContent; }
        else if (isW(c, "delText")) { orig += c.textContent; }
        else if (isW(c, "tab")) { orig += " "; cur += " "; }
        else if (isW(c, "p")) { /* nested paragraph (text box) is its own entry */ }
        else walkP(c, inDel || isW(c, "del"));
      }
    };
    walkP(p, false);
    out.paragraphs.push({ label: label(orig), text: cur.replace(/\s+/g, " ").trim(), orig: orig.replace(/\s+/g, " ").trim() });
  }

  // One pass in document order: changes, with the comment ranges open around them.
  const open = new Set();
  const rangeStart = {}, rangeEnd = {}, rangeText = {};
  const raw = [];
  let curP = -1;
  const walk = (n, insAncestor) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (isW(c, "p")) { const prev = curP; curP = pIndex.get(c); walk(c, insAncestor); curP = prev; continue; }
      if (isW(c, "commentRangeStart")) { const id = wAttr(c, "id"); open.add(id); rangeStart[id] = curP; rangeText[id] = ""; continue; }
      if (isW(c, "commentRangeEnd")) { const id = wAttr(c, "id"); open.delete(id); rangeEnd[id] = curP; continue; }
      if (isW(c, "commentReference")) { const id = wAttr(c, "id"); if (rangeStart[id] === undefined) rangeStart[id] = curP; if (rangeEnd[id] === undefined) rangeEnd[id] = curP; continue; }
      if (isW(c, "t")) { open.forEach((id) => { if (rangeText[id].length < 600) rangeText[id] += c.textContent; }); continue; }
      if (isW(c, "pPr") || isW(c, "rPr")) continue; // paragraph-mark revisions carry no text
      if (isW(c, "ins") || isW(c, "del")) {
        const type = isW(c, "ins") ? "ins" : "del";
        let text = (type === "ins" ? wText(c, "t") : wText(c, "delText"));
        let struckBy = null;
        if (!text && type === "ins") {
          // An insertion the other side then deleted in full: keep it as a
          // proposal of its author, marked as struck.
          const inner = c.getElementsByTagNameNS(W_NS, "del")[0];
          text = wText(c, "delText");
          if (text && inner) struckBy = wAttr(inner, "author") || "unknown";
        }
        if (text) {
          raw.push({
            type, text, pi: curP,
            author: wAttr(c, "author") || "unknown",
            date: (wAttr(c, "date") || "").slice(0, 10),
            comments: Array.from(open),
            struckBy,
            // Deleting text that sits inside someone else's tracked insertion
            // means rejecting the language they proposed.
            rejects: (type === "del" && insAncestor && insAncestor.author !== (wAttr(c, "author") || "unknown")) ? insAncestor.author : null,
          });
        }
        walk(c, type === "ins" ? { author: wAttr(c, "author") || "unknown" } : insAncestor);
        continue;
      }
      walk(c, insAncestor);
    }
  };
  walk(body, null);

  // Word splits one edit into many runs. Merge consecutive pieces of the same
  // kind by the same author in the same paragraph into one edit.
  raw.forEach((r) => {
    const last = out.changes[out.changes.length - 1];
    if (last && last.pi === r.pi && last.type === r.type && last.author === r.author && last.rejects === r.rejects && last.struckBy === r.struckBy && last.date === r.date) {
      last.text += " " + r.text;
      r.comments.forEach((id) => { if (!last.comments.includes(id)) last.comments.push(id); });
    } else {
      out.changes.push({ ...r, comments: r.comments.slice() });
    }
  });
  out.changes.forEach((ch, i) => {
    ch.ref = "T" + (i + 1);
    const p = out.paragraphs[ch.pi] || { label: "", text: "" };
    ch.where = p.label;
    ch.context = p.text.slice(0, 260);
  });

  // Comments, with reply threading (commentsExtended) and resolved flags.
  const commentsXml = await read("word/comments.xml");
  const extXml = await read("word/commentsExtended.xml");
  const ext = {};
  if (extXml) {
    const edoc = parser.parseFromString(extXml, "application/xml");
    const exs = edoc.getElementsByTagNameNS(W15_NS, "commentEx");
    for (let i = 0; i < exs.length; i++) {
      const e = exs[i];
      const pid = e.getAttributeNS(W15_NS, "paraId") || e.getAttribute("w15:paraId");
      ext[pid] = {
        parent: e.getAttributeNS(W15_NS, "paraIdParent") || e.getAttribute("w15:paraIdParent") || "",
        done: (e.getAttributeNS(W15_NS, "done") || e.getAttribute("w15:done")) === "1",
      };
    }
  }
  if (commentsXml) {
    const cdoc = parser.parseFromString(commentsXml, "application/xml");
    if (!cdoc.getElementsByTagName("parsererror").length) {
      const cs = cdoc.getElementsByTagNameNS(W_NS, "comment");
      const byPara = {};
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const body = wText(c, "t");
        const id = wAttr(c, "id");
        const ps = c.getElementsByTagNameNS(W_NS, "p");
        let lastPid = "";
        for (let j = 0; j < ps.length; j++) { const pid = ps[j].getAttributeNS(W14_NS, "paraId") || ps[j].getAttribute("w14:paraId"); if (pid) lastPid = pid; }
        const startP = rangeStart[id] !== undefined ? rangeStart[id] : -1;
        const endP = rangeEnd[id] !== undefined ? rangeEnd[id] : startP;
        const pinfo = out.paragraphs[startP] || { label: "", text: "" };
        const cm = {
          id, ref: "C" + id,
          author: wAttr(c, "author") || "unknown",
          date: (wAttr(c, "date") || "").slice(0, 10),
          text: body,
          startP, endP,
          where: pinfo.label,
          anchor: ((rangeText[id] || "").replace(/\s+/g, " ").trim() || pinfo.text).slice(0, 260),
          paraId: lastPid,
          done: !!(ext[lastPid] && ext[lastPid].done),
          parentPid: (ext[lastPid] && ext[lastPid].parent) || "",
        };
        if (lastPid) byPara[lastPid] = cm;
        if (body) out.comments.push(cm);
      }
      out.comments.forEach((cm) => {
        const parent = cm.parentPid ? byPara[cm.parentPid] : null;
        cm.parentId = parent ? parent.id : null;
      });
      // Root of each thread, and its location for replies that lack a range.
      const byId = {};
      out.comments.forEach((cm) => { byId[cm.id] = cm; });
      out.comments.forEach((cm) => {
        let r = cm, guard = 0;
        while (r.parentId && byId[r.parentId] && guard++ < 50) r = byId[r.parentId];
        cm.rootId = r.id;
        if (cm.startP < 0 && r.startP >= 0) { cm.startP = r.startP; cm.endP = r.endP; cm.where = r.where; cm.anchor = r.anchor; }
        if (r.done) cm.done = true;
      });
    }
  }

  out.changes.forEach((c) => { const a = out.authors[c.author] || (out.authors[c.author] = { changes: 0, comments: 0 }); a.changes++; });
  out.comments.forEach((c) => { const a = out.authors[c.author] || (out.authors[c.author] = { changes: 0, comments: 0 }); a.comments++; });
  out.hasMarkup = !!(out.changes.length || out.comments.length);
  return out;
}

// Split the markup by side and round. `sides` maps author name to "mine" or
// "theirs"; anyone not assigned is "unknown". The current round is everything
// dated within two days of the newest item in the file.
function organizeMarkup(m, sides) {
  if (!m || !m.hasMarkup) return null;
  const side = (a) => (sides && sides[a]) || "unknown";
  const dates = m.changes.map((c) => c.date).concat(m.comments.map((c) => c.date)).filter(Boolean).sort();
  const latest = dates.length ? dates[dates.length - 1] : "";
  let cutoff = "";
  if (latest) { const d = new Date(latest + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 2); cutoff = d.toISOString().slice(0, 10); }
  const isCurrent = (date) => !date || !cutoff || date >= cutoff;

  const changes = m.changes.map((c) => ({ ...c, side: side(c.author), current: isCurrent(c.date) }));
  const comments = m.comments.map((c) => ({ ...c, side: side(c.author), current: isCurrent(c.date) }));
  const theirChanges = changes.filter((c) => c.side !== "mine" && c.current);
  const theirEarlierChanges = changes.filter((c) => c.side !== "mine" && !c.current);
  const yourPending = changes.filter((c) => c.side === "mine");
  const theirNewComments = comments.filter((c) => c.side !== "mine" && c.current);

  // A new comment from them with no edit of theirs inside or next to its range
  // is a position they raised without drafting anything.
  const openItems = theirNewComments.filter((cm) => {
    if (cm.done) return false;
    const lo = Math.min(cm.startP, cm.endP), hi = Math.max(cm.startP, cm.endP);
    return !theirChanges.some((ch) => ch.comments.includes(cm.id) || (cm.startP >= 0 && ch.pi >= lo && ch.pi <= hi));
  });

  // Which of their new comments explain which of their changes.
  theirChanges.forEach((ch) => {
    ch.explainedBy = theirNewComments.filter((cm) => ch.comments.includes(cm.id) || (cm.startP >= 0 && ch.pi >= Math.min(cm.startP, cm.endP) && ch.pi <= Math.max(cm.startP, cm.endP))).map((cm) => cm.ref);
  });
  // Your pending changes that they struck.
  yourPending.forEach((ch) => {
    ch.rejectedBy = (ch.struckBy && side(ch.struckBy) !== "mine" ? ch.struckBy : null) || changes.filter((d) => d.type === "del" && d.rejects === ch.author && d.pi === ch.pi && d.side !== "mine").map((d) => d.author)[0] || null;
  });

  // Threads, oldest first within each.
  const threads = {};
  comments.forEach((c) => { (threads[c.rootId || c.id] = threads[c.rootId || c.id] || []).push(c); });
  Object.values(threads).forEach((t) => t.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.parentId ? 1 : -1)));

  const byAuthor = {};
  changes.forEach((c) => {
    const a = byAuthor[c.author] || (byAuthor[c.author] = { side: c.side, ins: 0, del: 0, newComments: 0, oldComments: 0 });
    a[c.type]++;
  });
  comments.forEach((c) => {
    const a = byAuthor[c.author] || (byAuthor[c.author] = { side: c.side, ins: 0, del: 0, newComments: 0, oldComments: 0 });
    if (c.current) a.newComments++; else a.oldComments++;
  });

  return { latest, cutoff, changes, comments, theirChanges, theirEarlierChanges, yourPending, theirNewComments, openItems, threads, byAuthor,
    unknownAuthors: Object.keys(byAuthor).filter((a) => byAuthor[a].side === "unknown") };
}

// ---------------------------------------------------------------------------
// Versions of one agreement: detection, ordering and a code-computed diff.
// ---------------------------------------------------------------------------
function shingles(text) {
  const w = normalizeForMatch(stripPageMarkers(text)).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const s = new Set();
  for (let i = 0; i + 4 < w.length; i++) s.add(w.slice(i, i + 5).join(" "));
  return s;
}

function overlap(a, b) {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((x) => { if (B.has(x)) n++; });
  return n / Math.min(A.size, B.size);
}

// Date for ordering versions: from the filename, then from the document's
// first lines, then the file's modified time.
function versionDate(name, text, lastModified) {
  let m = (name || "").match(/(20\d{2})[.\-_](\d{1,2})[.\-_](\d{1,2})/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = (name || "").match(/\b(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})\b/);
  if (m) return (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
  const head = (text || "").slice(0, 1500);
  const d = head.match(new RegExp("(" + MONTHS + ")\\s+(\\d{1,2}),?\\s+(20\\d{2})", "i"));
  if (d) {
    const mo = MONTHS.split("|").findIndex((x) => x.toLowerCase() === d[1].toLowerCase()) + 1;
    return d[3] + "-" + String(mo).padStart(2, "0") + "-" + d[2].padStart(2, "0");
  }
  return lastModified ? new Date(lastModified).toISOString().slice(0, 10) : "";
}

// Sentence-sized units carry a section label so each difference has a place.
function units(text) {
  const label = makeLabeler();
  const out = [];
  stripPageMarkersKeepBreaks(text).split(/\n+/).forEach((para) => {
    const p = para.replace(/\s+/g, " ").trim();
    if (!p) return;
    const lab = label(p);
    p.split(/(?<=[.;:!?])\s+(?=[A-Z(“"\[])/).forEach((s) => {
      // A label like "(c)" mid-paragraph starts a new sub-section.
      const inner = s.match(/^\(([a-z]{1,2}|[ivx]{1,4})\)\s/);
      out.push({ text: s, key: normalizeForMatch(s).replace(/[^a-z0-9]/g, ""), where: inner ? label(s) : lab });
    });
  });
  return out;
}

function stripPageMarkersKeepBreaks(s) {
  return (s || "").replace(/=====\s*PAGE\s+\d+\s*=====/g, "\n");
}

function diffVersions(oldText, newText) {
  const a = units(oldText), b = units(newText);
  const n = a.length, m = b.length;
  // LCS over sentence units. Sizes stay in the hundreds, so a full table is fine.
  const W = m + 1;
  const T = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    T[i * W + j] = a[i].key === b[j].key ? T[(i + 1) * W + j + 1] + 1 : Math.max(T[(i + 1) * W + j], T[i * W + j + 1]);
  }
  const hunks = [];
  let i = 0, j = 0, cur = null;
  // A run of changed units can span several sections. Split it by section and
  // pair the old and new wording of each, so every difference has one place.
  const flush = () => {
    if (!cur) return;
    const order = [];
    cur.forEach((u) => { if (!order.includes(u.where)) order.push(u.where); });
    order.forEach((w) => hunks.push({
      where: w,
      before: cur.filter((u) => u.where === w && u.side === "a").map((u) => u.text),
      after: cur.filter((u) => u.where === w && u.side === "b").map((u) => u.text),
    }));
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i].key === b[j].key) { flush(); i++; j++; continue; }
    if (!cur) cur = [];
    if (j < m && (i >= n || T[i * W + j + 1] >= T[(i + 1) * W + j])) { cur.push({ ...b[j], side: "b" }); j++; }
    else { cur.push({ ...a[i], side: "a" }); i++; }
  }
  flush();
  // Trim the words both sides share so each hunk shows only what moved,
  // with a few words of context.
  return hunks.map((h) => {
    const bw = h.before.join(" ").split(/\s+/).filter(Boolean), aw = h.after.join(" ").split(/\s+/).filter(Boolean);
    let p = 0; while (p < bw.length && p < aw.length && bw[p] === aw[p]) p++;
    let s = 0; while (s < bw.length - p && s < aw.length - p && bw[bw.length - 1 - s] === aw[aw.length - 1 - s]) s++;
    const C = 10;
    const pre = Math.max(0, p - C), postB = Math.min(bw.length, bw.length - s + C), postA = Math.min(aw.length, aw.length - s + C);
    return {
      where: h.where,
      before: (pre > 0 ? "… " : "") + bw.slice(pre, postB).join(" ") + (postB < bw.length ? " …" : ""),
      after: (pre > 0 ? "… " : "") + aw.slice(pre, postA).join(" ") + (postA < aw.length ? " …" : ""),
      removed: bw.slice(p, bw.length - s).join(" "),
      added: aw.slice(p, aw.length - s).join(" "),
    };
  }).filter((h) => (h.removed || h.added).replace(/[^A-Za-z0-9]/g, "").length > 0);
}

// ---------------------------------------------------------------------------
// Word copy with the analysis added as comments, for a negotiation round.
// ---------------------------------------------------------------------------
async function buildResponseDocx(arrayBuffer, notes, author) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const parser = new DOMParser(), ser = new XMLSerializer();
  const doc = parser.parseFromString(await zip.file("word/document.xml").async("string"), "application/xml");
  const paras = doc.getElementsByTagNameNS(W_NS, "p");
  let cxml = zip.file("word/comments.xml") ? await zip.file("word/comments.xml").async("string") : null;
  const fresh = !cxml;
  if (fresh) cxml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="' + W_NS + '"></w:comments>';
  const cdoc = parser.parseFromString(cxml, "application/xml");
  const root = cdoc.documentElement;
  let next = 0;
  const bump = (els) => { for (let i = 0; i < els.length; i++) next = Math.max(next, parseInt(wAttr(els[i], "id"), 10) + 1 || 0); };
  bump(cdoc.getElementsByTagNameNS(W_NS, "comment"));
  bump(doc.getElementsByTagNameNS(W_NS, "commentRangeStart"));
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const mk = (d, name, attrs) => { const e = d.createElementNS(W_NS, "w:" + name); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttributeNS(W_NS, "w:" + k, v)); return e; };
  let added = 0;
  notes.forEach((nt) => {
    const p = paras[nt.pi];
    if (!p || !nt.text) return;
    const id = String(next++);
    const start = mk(doc, "commentRangeStart", { id });
    const pPr = p.getElementsByTagNameNS(W_NS, "pPr")[0];
    if (pPr && pPr.parentNode === p) p.insertBefore(start, pPr.nextSibling); else p.insertBefore(start, p.firstChild);
    p.appendChild(mk(doc, "commentRangeEnd", { id }));
    const r = mk(doc, "r"); r.appendChild(mk(doc, "commentReference", { id })); p.appendChild(r);
    const c = mk(cdoc, "comment", { id, author: author, date: now, initials: "CC" });
    nt.text.split(/\n+/).forEach((line) => {
      const cp = mk(cdoc, "p"), cr = mk(cdoc, "r"), ct = mk(cdoc, "t");
      ct.setAttribute("xml:space", "preserve"); ct.textContent = line; cr.appendChild(ct); cp.appendChild(cr); c.appendChild(cp);
    });
    root.appendChild(c);
    added++;
  });
  zip.file("word/document.xml", ser.serializeToString(doc));
  zip.file("word/comments.xml", ser.serializeToString(cdoc));
  if (fresh) {
    const relsPath = "word/_rels/document.xml.rels";
    let rels = await zip.file(relsPath).async("string");
    rels = rels.replace("</Relationships>", '<Relationship Id="rIdCC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>');
    zip.file(relsPath, rels);
    let ct = await zip.file("[Content_Types].xml").async("string");
    if (!/\/word\/comments\.xml/.test(ct)) ct = ct.replace("</Types>", '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>');
    zip.file("[Content_Types].xml", ct);
  }
  return { blob: await zip.generateAsync({ type: "blob" }), added };
}

export { extractDocxMarkup, organizeMarkup, overlap, versionDate, diffVersions, buildResponseDocx };
