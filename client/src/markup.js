import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Tracked changes and comments.
//
// mammoth returns only the body text of a .docx, with every tracked change
// already applied and all comments dropped. A redline therefore reaches the
// model looking like a clean document: the deleted wording is gone, and the
// counterparty's comments -- which carry their actual negotiating position --
// never arrive at all. Both live elsewhere in the package, so we read it
// directly and hand the model what mammoth threw away.
// ---------------------------------------------------------------------------
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function wText(el, local) {
  const nodes = el.getElementsByTagNameNS(W_NS, local);
  let s = "";
  for (let i = 0; i < nodes.length; i++) s += nodes[i].textContent || "";
  return s.replace(/\s+/g, " ").trim();
}

function wAttr(el, name) {
  return el.getAttributeNS(W_NS, name) || el.getAttribute("w:" + name) || "";
}

function paraSection(txt) {
  const m = (txt || "").match(/^\s*(\d+\.|\([a-z]\)|Paragraph\s+\d+|Section\s+\d+|§\s*\d+)/i);
  return m ? m[1].trim() : "";
}

async function extractDocxMarkup(arrayBuffer) {
  const out = { insertions: [], deletions: [], comments: [], hasMarkup: false };
  let zip;
  try { zip = await JSZip.loadAsync(arrayBuffer); } catch (e) { return out; }
  const read = async (p) => { const f = zip.file(p); return f ? await f.async("string") : null; };
  const docXml = await read("word/document.xml");
  if (!docXml) return out;

  const parser = new DOMParser();
  const doc = parser.parseFromString(docXml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return out;

  const ins = doc.getElementsByTagNameNS(W_NS, "ins");
  for (let i = 0; i < ins.length; i++) {
    const t = wText(ins[i], "t");
    if (t) out.insertions.push({ author: wAttr(ins[i], "author") || "unknown", text: t });
  }
  const del = doc.getElementsByTagNameNS(W_NS, "del");
  for (let i = 0; i < del.length; i++) {
    const t = wText(del[i], "delText");
    if (t) out.deletions.push({ author: wAttr(del[i], "author") || "unknown", text: t });
  }

  // Map each comment id to the paragraph it is anchored in, so a comment can be
  // reported against the clause it actually marks.
  const anchors = {};
  const paras = doc.getElementsByTagNameNS(W_NS, "p");
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const ids = [];
    ["commentRangeStart", "commentReference"].forEach((tag) => {
      const n = p.getElementsByTagNameNS(W_NS, tag);
      for (let j = 0; j < n.length; j++) { const id = wAttr(n[j], "id"); if (id) ids.push(id); }
    });
    if (!ids.length) continue;
    const txt = wText(p, "t");
    ids.forEach((id) => { if (anchors[id] === undefined) anchors[id] = txt; });
  }

  const commentsXml = await read("word/comments.xml");
  if (commentsXml) {
    const cdoc = parser.parseFromString(commentsXml, "application/xml");
    if (!cdoc.getElementsByTagName("parsererror").length) {
      const cs = cdoc.getElementsByTagNameNS(W_NS, "comment");
      for (let i = 0; i < cs.length; i++) {
        const body = wText(cs[i], "t");
        if (!body) continue;
        const id = wAttr(cs[i], "id");
        const anchor = anchors[id] || "";
        out.comments.push({
          id: id,
          author: wAttr(cs[i], "author") || "unknown",
          date: (wAttr(cs[i], "date") || "").slice(0, 10),
          where: paraSection(anchor),
          anchor: anchor.slice(0, 200),
          text: body,
        });
      }
    }
  }
  out.hasMarkup = !!(out.insertions.length || out.deletions.length || out.comments.length);
  return out;
}

export { extractDocxMarkup };
