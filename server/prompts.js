import { extractDocFacts, renderDocFacts } from "./docfacts.js";
import { renderMarkup, renderMarkupBrief } from "./markup.js";

// Prompt builders for the Claude calls. They live on the server so the API key
// and prompts never reach the browser.

// ---------------------------------------------------------------------------
const RUBRIC = `RATING RUBRIC — apply it strictly and literally so that repeated runs on the same contract give the same ratings:
harmLevel:
- "high" = could cost the artist a significant share of income; gives away ownership or rights permanently or for an undefined period; blocks the artist from working with others; waives important legal rights (right to sue, injury claims); makes leaving very difficult; or appears to conflict with a statute.
- "medium" = a real but limited or time-bound cost or restriction, or a one-sided term that is unusual but survivable.
- "low" = standard boilerplate found in most contracts of this type (entire agreement, no-reliance, written amendments, notices, severability, counterparts, effectiveness on signature), or a term that mainly protects the artist.
negotiability:
- "low" = companies almost never change this (statutory requirements, standard boilerplate, regulator-mandated forum).
- "medium" = changes are possible with pushback or leverage.
- "high" = commonly changed on request (commission rate, term length, exclusivity scope, approval rights, confidentiality carve-outs, ownership vs. license of the artist's own materials).`;

export function buildClassifyPrompt(text, markup) {
  const facts = renderDocFacts(extractDocFacts(text));
  const markupBlock = renderMarkup(markup);
  return `You are analyzing an entertainment-industry contract (music, talent agency, management, likeness release, or similar) for an artist who is not a lawyer. Read the contract text below and respond ONLY with valid JSON, no preamble, no markdown fences.

Extract:
- "contractType": a short plain-English label for what kind of contract this is (e.g. "Talent agency agreement", "Record deal", "Likeness release", "Management agreement")
- "choiceOfLawState": the state named in the choice-of-law / governing-law clause (full name). If there is no governing-law clause but the contract clearly operates under one state's statutes (e.g. it cites the California Labor Code), give that state and add " (implied, no governing-law clause)". Otherwise null.
- "disputeForum": one short sentence on where and how disputes are decided (court, arbitration body and city, a state agency such as a Labor Commissioner) and who pays, or null if not stated
- "operativeName": the name of the company, label, agency, publisher, or manager who is the counterparty offering the contract, or null if unclear
- "clauses": an array covering EVERY one of these categories that is actually present in the contract. Do not skip a present category, and do not include categories that are absent:
  - compensation: commissions, fee percentages, royalty rates, how "gross" is defined, who sets the rate, missing fee schedules, or the absence of any payment to the artist
  - fees_repayment: fees or expenses the artist pays or must repay, penalties, deadlines
  - advances: upfront payments to the artist
  - recoupment: costs taken back from the artist's earnings, deductions, set-offs against other agreements, money held in trust
  - exclusivity: whether the artist may work with others (other agents, labels, managers), including a "non-exclusive" label contradicted by the text
  - publishing: songwriting and publishing rights
  - ownership: who owns recordings, photos, reels, or other materials the artist makes or provides, and whether that ownership ends
  - merchandising: merch rights
  - likeness: use of name, image, voice, biography
  - term_territory: how long the deal lasts and where it applies
  - termination: how and when the artist can get out, notice requirements, conditions that make leaving hard
  - confidentiality: secrecy duties, how long they last, who can end them, and whether there are exceptions for the artist's lawyer, advisors, family, or legal requirements
  - release_of_claims: claims the artist gives up, promises not to sue, what kinds of harm are covered
  - dispute_resolution: arbitration, venue, who pays, confidentiality of proceedings
  - assignment: whether the company can transfer the contract to someone else
  - drafting: drafting problems that matter — blank lines that should be filled in (approval dates, license numbers), referenced schedules or attachments that are missing, garbled or incomplete sentences, cross-references that point to the wrong section. Combine them into one entry.
  - other: any other term that could materially harm the artist and fits none of the above (include a short "title" for it)
  For each present category include:
  - "category": one of the category keys above
  - "title": only for "other" — a short plain-English heading
  - "plainEnglish": 2-3 plain-English sentences explaining what this clause actually does for an artist with no legal background
  - "negotiability": "low" | "medium" | "high" — per the rubric below
  - "harmLevel": "low" | "medium" | "high" — per the rubric below
  - "harmDuration": a short phrase on how long this term's effects follow the artist
  - "revenueImpact": a short plain-English note on where money is lost, taken, or withheld because of this clause, or null if not applicable
  - "worksInYourFavor": if any wording in this clause protects or benefits the artist (for example, language preserving claims the artist doesn't yet know about, a statutory forum that is free for the artist, a cap, a notice right), one plain-English sentence saying so; otherwise null. Do not present protective language as a limitation. This field must never contradict this clause's own "plainEnglish". Rely only on wording that plainly does protect the artist: if "plainEnglish" says the term is unclear, undefined, ambiguous, or contradicted elsewhere in the contract, do NOT state the favorable reading here as settled — either return null, or say in the sentence that it is only one of two possible readings. A favorable reading that depends on winning an argument about what the clause means is not something that works in the artist's favor.
  - "statuteFlag": if this clause cites or plainly relies on a statute and its wording appears to depart from what that statute provides (for example, reversing who must repay whom), one plain-English sentence saying so, starting with "This appears to"; otherwise null. Only flag what you are confident about.
  - "sections": the section/clause/paragraph identifiers WHERE THE LANGUAGE YOU RELY ON ACTUALLY APPEARS, exactly as numbered in the contract (e.g. ["4.2"] or ["Paragraph 7"]). If the language is in unnumbered text such as the opening paragraph or a signature page, use "Opening paragraph" or "Signature page". Never cite a section just because it is related. Empty array if the contract has no numbering at all.
  - "pages": an array of page numbers this analysis is based on, as integers. The contract text may contain markers like "===== PAGE 3 =====" — use those. If there are NO such page markers in the text, return an empty array (do not guess page numbers).
  - "sourceQuotes": an array of 1-3 SHORT verbatim quotes (each roughly 8-25 words) copied EXACTLY from the contract text — the specific language this analysis is based on. Copy the words as they literally appear. If nothing can be quoted, return an empty array.
- "markupReview": an array. If the TRACKED CHANGES AND COMMENTS block is present below, cover EVERY material change in it; otherwise return an empty array. Each entry has: "what" (a short heading for the change), "before" (what the wording was before — quote the deleted text), "after" (what it says now, or "nothing" if text was simply removed), "effect" (2-3 plain-English sentences on what the change does to the artist), "harmLevel" ("low"|"medium"|"high" per the rubric, rating the CHANGE itself), and "theirReason" (the counterparty's comment explaining it, verbatim, or null). Judge each change by what it removes or adds, never by how the surviving text happens to read.

${RUBRIC}

IMPORTANT: base "sections" and "pages" only on what is actually in the contract text. Never invent a section number or page that isn't there. Money terms (compensation, fees_repayment) are the most important — never omit them when present.

===== DOCUMENT FACTS (computed from the text by code — authoritative) =====
${facts}
===== END DOCUMENT FACTS =====
${markupBlock ? "\n===== TRACKED CHANGES AND COMMENTS (read from the file by code) =====\n" + markupBlock + "\n===== END TRACKED CHANGES AND COMMENTS =====\n" : ""}
Contract text:
---
${text.slice(0, 60000)}
---`;
}

export function buildResearchPrompt(cls) {
  const clauses = ((cls && cls.clauses) || []).filter((c) => c.category !== "drafting");
  const lines = clauses.map((c) => `- ${c.category}: ${c.plainEnglish}`).join("\n");
  return `You are researching real-world experiences of artists with the kinds of terms in a contract. Use web search. Respond ONLY with valid JSON, no preamble, no markdown fences.

Contract type: ${(cls && cls.contractType) || "unknown"}
Counterparty name, if known: ${(cls && cls.operativeName) || "unknown"}
What each clause in THIS contract actually says:
${lines}

For each category above, search for how artists in THIS type of contract (e.g. talent agency clients, not record-label artists, when it is an agency agreement) describe their real experience with that kind of term (forums, artist interviews, industry press, Reddit, etc). Every finding MUST fit the actual terms listed above: never warn about something the contract already handles differently (for example, do not warn about paying the other side's legal fees if the contract says each side pays its own). Separately, if a counterparty name is known, search for that specific company or person's reputation, disputes, or artist complaints.

Return JSON shaped like:
{
  "<category>": {
    "general": [ { "finding": "short plain-English finding", "sourceTag": "short disclaimer naming the source type, e.g. 'This is from Reddit — real people, not verified facts.' or 'Industry reporting is not a legal finding.'" } ],
    "operative": [ { "finding": "short plain-English finding specific to the named counterparty", "sourceTag": "short source disclaimer as above" } ]
  }
}
Include at most 2 findings per array per category. If nothing specific was found for "operative", return an empty array for it rather than guessing.`;
}

// Render the findings the per-document pass already reached, so the conflicts
// pass is not a second, independent reading of the same clauses. Without this
// the two passes can state opposite conclusions about one clause in the same
// report (e.g. "the restriction is broader" vs "it only covers engaged
// Projects"), because neither can see what the other concluded.
function renderFindings(cls) {
  const clauses = (cls && cls.clauses) || [];
  if (!clauses.length) return "  (no clause findings available for this document)";
  return clauses.map((cl) => {
    const where = (cl.sections || []).length ? ` (${cl.sections.join(", ")})` : "";
    const label = cl.title ? `${cl.category} — ${cl.title}` : cl.category;
    const out = [`  - ${label}${where} [harm: ${cl.harmLevel || "?"}]`,
                 `    reading: ${cl.plainEnglish || ""}`];
    if (cl.worksInYourFavor) out.push(`    works in the artist's favor: ${cl.worksInYourFavor}`);
    if (cl.statuteFlag) out.push(`    statute flag: ${cl.statuteFlag}`);
    return out.join("\n");
  }).join("\n");
}

export function buildConflictPrompt(entries) {
  const n = Math.max(1, entries.length);
  const findings = entries.map((e) => renderFindings(e.classification));
  const used = findings.reduce((t, f) => t + f.length, 0);
  // Leave room for the findings blocks inside the same overall budget.
  const per = Math.max(10000, Math.floor((200000 - used) / n));
  const blocks = entries.map((e, i) => {
    const c = e.classification || {};
    return `===== DOCUMENT ${i + 1}: "${e.name}" (${c.contractType || "contract"}) =====
Governing law: ${c.choiceOfLawState || "not stated"}
Disputes: ${c.disputeForum || "not stated"}
ESTABLISHED FINDINGS for this document read on its own:
${findings[i]}
DOCUMENT FACTS (computed from the text by code — authoritative, overrides your own reading):
${renderDocFacts(extractDocFacts(e.text))}
${renderMarkupBrief(e.markup) ? renderMarkupBrief(e.markup) + "\n" : ""}Full text:
${e.text.slice(0, per)}`;
  }).join("\n\n");
  return `These documents are being signed together by the same artist with the same company. Compare them and find CONFLICTS or INTERACTIONS between them that matter to the artist: for example, different dispute forums or costs, different governing law, one document's duration depending on an undefined term in another, inconsistent definitions, rights granted in one that undercut protections in the other, or obligations that stack. Only report real conflicts that are supported by the text. Respond ONLY with valid JSON, no preamble, no markdown fences:
{ "conflicts": [ { "title": "short plain-English heading", "explanation": "2-3 plain-English sentences on the conflict and why it matters to the artist", "harmLevel": "low" | "medium" | "high", "references": [ { "document": "exact document name as given above", "sections": ["section ids as numbered in that document"] } ], "revises": { "document": "exact document name", "category": "the category key of the established finding you are departing from", "note": "one plain-English sentence on why reading the documents together changes that finding" } } ] }
"revises" is null unless the rule below requires it. Return { "conflicts": [] } if there are none.

CONSISTENCY REQUIREMENT — the artist reads your conflicts and the ESTABLISHED FINDINGS above in a single report, so the two must never state opposite conclusions about the same clause:
- The ESTABLISHED FINDINGS are the settled reading of each document standing alone, produced by the earlier pass of this same analysis. Treat them as given.
- Do not repeat a finding as if it were a conflict. A conflict must arise from the documents' interaction, not from one document alone.
- Before reporting a conflict, check it against every finding for the documents it references. If your conflict would contradict one — for example by calling a restriction broader where the finding records it as limited — you must fill in "revises" naming that document and category and saying why the combined reading differs. Never contradict an established finding with "revises" left null; if you cannot justify the departure, drop the conflict.
- Where a finding already records that a term is undefined, unclear or disputed in scope, do not resolve that ambiguity in either direction. Describe the conflict in terms of the ambiguity itself and what each reading would mean.
- Keep harmLevel consistent with the rubric and with the harm levels of the findings you reference; if you depart from them, that is a departure requiring "revises".

${RUBRIC}

${blocks}`;
}
