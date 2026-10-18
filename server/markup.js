// ---------------------------------------------------------------------------
// Rendering for tracked changes and comments.
//
// Extraction runs in the browser, where the .docx package is in hand (see
// client/src/markup.js). The server only renders what it is given: mammoth
// drops deletions and comments entirely, so a redline would otherwise reach
// the model looking like a clean document.
// ---------------------------------------------------------------------------

function renderMarkup(m) {
  if (!m || !m.hasMarkup) return "";
  const L = [];
  L.push("This document is a REDLINE. The contract text further below is the result with every tracked change ALREADY APPLIED: the deleted wording is not in it, and the comments are not in it either. Both appear here and nowhere else.");
  L.push("");
  L.push("TEXT DELETED (" + m.deletions.length + "):");
  if (!m.deletions.length) L.push("  (none)");
  m.deletions.forEach((d) => L.push("  - [" + d.author + "] removed: “" + d.text + "”"));
  L.push("");
  L.push("TEXT INSERTED (" + m.insertions.length + "):");
  if (!m.insertions.length) L.push("  (none)");
  m.insertions.forEach((d) => L.push("  - [" + d.author + "] added: “" + d.text + "”"));
  L.push("");
  L.push("COMMENTS (" + m.comments.length + "):");
  if (!m.comments.length) L.push("  (none)");
  m.comments.forEach((c) => L.push("  - [" + c.author + (c.date ? " " + c.date : "") + "]"
    + (c.where ? " at " + c.where : "") + " on “" + c.anchor + "” — “" + c.text + "”"));
  L.push("");
  L.push("HOW TO USE THIS BLOCK:");
  L.push("- Analyse what CHANGED, not only how the document now reads. A clause can read harmlessly precisely because a protection was deleted from it. Rate the harm of the change, not of the surviving words.");
  L.push("- Treat every deletion as something the deleting party wanted. Do NOT report the trace of a deletion as a drafting error: a list that now starts at (ii), a cross-reference with no target, an orphaned clause, a sentence missing its subject. Check the deletions above first and say what was removed and by whom.");
  L.push("- Each comment is that party's negotiating position. Say what it demands, and whether their edit goes further than their comment admits.");
  L.push("- A comment that refers to another document, or to a markup of one, points to something you have NOT been given. Say that it is missing rather than guessing what it says.");
  return L.join("\n");
}

// Short form for the conflicts pass.
function renderMarkupBrief(m) {
  if (!m || !m.hasMarkup) return "";
  const L = ["REDLINE: " + m.deletions.length + " deletion(s), " + m.insertions.length
             + " insertion(s), " + m.comments.length + " comment(s). The text below has the changes applied."];
  m.deletions.slice(0, 12).forEach((d) => L.push("  - deleted by " + d.author + ": “" + d.text.slice(0, 220) + "”"));
  m.comments.slice(0, 12).forEach((c) => L.push("  - comment by " + c.author + (c.where ? " at " + c.where : "") + ": “" + c.text.slice(0, 220) + "”"));
  return L.join("\n");
}

export { renderMarkup, renderMarkupBrief };
