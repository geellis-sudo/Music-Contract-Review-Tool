// ---------------------------------------------------------------------------
// Rendering for tracked changes and comments.
//
// Extraction runs in the browser, where the .docx package is in hand (see
// client/src/markup.js). The browser also splits the markup by side and round
// (organizeMarkup), because only it knows which author the user marked as
// their own side. The server only renders what it is given.
// ---------------------------------------------------------------------------

function q(s, n) { s = (s || "").replace(/\s+/g, " ").trim(); return "“" + (n && s.length > n ? s.slice(0, n) + "…" : s) + "”"; }

function renderMarkup(org) {
  if (!org) return "";
  const L = [];
  L.push("This document is a REDLINE. The contract text further below is the result with every tracked change ALREADY APPLIED: deleted wording is not in it and comments are not in it. Both appear here and nowhere else.");
  L.push("Current round = items dated " + (org.cutoff ? org.cutoff + " or later (newest item " + org.latest + ")" : "(no dates in file)") + ".");
  if (org.unknownAuthors.length) L.push("The user has NOT said which side these authors are on: " + org.unknownAuthors.join(", ") + ". Treat their items as the other side's, but say in the entry that the side is unconfirmed.");
  L.push("");
  L.push("A. THEIR CHANGES THIS ROUND (" + org.theirChanges.length + ") — cover every one in markupReview, using its ref:");
  if (!org.theirChanges.length) L.push("  (none — they made no tracked edits this round)");
  org.theirChanges.forEach((c) => L.push("  - " + c.ref + " [" + c.author + " " + (c.date || "undated") + "] at §" + c.where + ": "
    + (c.type === "ins" ? "INSERTED " : "DELETED ") + q(c.text, 900)
    + (c.rejects ? "  <<< this deletion strikes language that " + c.rejects + " had proposed (rejected their proposed language)" : "")
    + (c.explainedBy && c.explainedBy.length ? "  (see comment " + c.explainedBy.join(", ") + ")" : "  (no comment of theirs covers this change)")
    + "\n      paragraph now reads: " + q(c.context, 260)));
  L.push("");
  L.push("B. THEIR NEW COMMENTS WITH NO EDIT NEXT TO THEM (" + org.openItems.length + ") — cover every one in openItems, using its ref:");
  if (!org.openItems.length) L.push("  (none)");
  org.openItems.forEach((c) => L.push("  - " + c.ref + " [" + c.author + " " + (c.date || "undated") + "] at §" + c.where + " on " + q(c.anchor, 200) + ": " + q(c.text)));
  L.push("");
  L.push("C. COMMENT THREADS (oldest first; [NEW] = this round; [RESOLVED] = marked done). Use these for context and to find what each side said before:");
  Object.values(org.threads).forEach((t) => {
    const r = t[0];
    L.push("  Thread at §" + r.where + " on " + q(r.anchor, 160) + (r.done ? " [RESOLVED]" : "") + ":");
    t.forEach((c) => L.push("    " + (c.parentId ? "↳ reply " : "") + c.ref + " " + (c.current ? "[NEW] " : "") + "[" + c.author + ", " + (c.side === "mine" ? "user's side" : c.side === "theirs" ? "other side" : "side unknown") + ", " + (c.date || "undated") + "]: " + q(c.text)));
  });
  L.push("");
  L.push("D. THE USER'S OWN TRACKED CHANGES STILL PENDING (" + org.yourPending.length + ") — these are the USER'S proposals, not the other side's. Never rate them as the other side's changes:");
  if (!org.yourPending.length) L.push("  (none)");
  org.yourPending.forEach((c) => L.push("  - " + c.ref + " [" + c.author + " " + (c.date || "") + "] at §" + c.where + ": " + (c.type === "ins" ? "proposed adding " : "proposed deleting ") + q(c.text, 400) + (c.rejectedBy ? "  <<< " + c.rejectedBy + " struck this proposed language" : "")));
  if (org.theirEarlierChanges.length) {
    L.push("");
    L.push("E. OTHER-SIDE CHANGES FROM EARLIER ROUNDS still tracked (" + org.theirEarlierChanges.length + "), context only:");
    org.theirEarlierChanges.forEach((c) => L.push("  - " + c.ref + " [" + c.author + " " + c.date + "] at §" + c.where + ": " + (c.type === "ins" ? "inserted " : "deleted ") + q(c.text, 300)));
  }
  L.push("");
  L.push("HOW TO USE THIS BLOCK:");
  L.push("- Judge every change by the TEXT AS IT NOW STANDS compared with the text before it, from the user's side. A deletion is not harmful just because the other side made it: if the clause that remains is better for the user than both sides' wording, say so and rate it low.");
  L.push("- Keep apart three things for each change: what the text now says, what their comment says they want, and whether the gap between those helps or hurts the user. When their comment asks for more than their edit does, set askMoreThanEdit to true.");
  L.push("- When a deletion strikes the user's own proposed language, say plainly that they rejected the user's proposal and whether they offered anything in its place.");
  L.push("- Do NOT report the trace of a deletion as a drafting error (a list that now starts at (ii), a cross-reference with no target). Say what was removed and by whom, and note any dangling reference it leaves.");
  L.push("- Pair a change only with a comment whose ref is listed next to it. If none is listed, theirReason is null.");
  L.push("- A comment that refers to another document, or to a markup of one, points to something you have NOT been given. Name it in neededDocuments.");
  return L.join("\n");
}

// Short form for the conflicts pass. Nothing is dropped silently.
function renderMarkupBrief(org) {
  if (!org) return "";
  const LIMIT = 40;
  const L = ["REDLINE: " + org.theirChanges.length + " change(s) by the other side this round, " + org.theirNewComments.length + " new comment(s) from them, " + org.yourPending.length + " pending change(s) by the user. The text below has the changes applied."];
  org.theirChanges.slice(0, LIMIT).forEach((c) => L.push("  - " + c.author + (c.type === "ins" ? " inserted" : " deleted") + " at §" + c.where + ": " + q(c.text, 220)));
  if (org.theirChanges.length > LIMIT) L.push("  (" + (org.theirChanges.length - LIMIT) + " more changes not listed here)");
  org.theirNewComments.slice(0, LIMIT).forEach((c) => L.push("  - comment by " + c.author + " at §" + c.where + ": " + q(c.text, 220)));
  if (org.theirNewComments.length > LIMIT) L.push("  (" + (org.theirNewComments.length - LIMIT) + " more comments not listed here)");
  return L.join("\n");
}

export { q, renderMarkup, renderMarkupBrief };
