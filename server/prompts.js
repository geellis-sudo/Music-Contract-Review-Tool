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

export function buildClassifyPrompt(text) {
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
  - "worksInYourFavor": if any wording in this clause protects or benefits the artist (for example, language preserving claims the artist doesn't yet know about, a statutory forum that is free for the artist, a cap, a notice right), one plain-English sentence saying so; otherwise null. Do not present protective language as a limitation.
  - "statuteFlag": if this clause cites or plainly relies on a statute and its wording appears to depart from what that statute provides (for example, reversing who must repay whom), one plain-English sentence saying so, starting with "This appears to"; otherwise null. Only flag what you are confident about.
  - "sections": the section/clause/paragraph identifiers WHERE THE LANGUAGE YOU RELY ON ACTUALLY APPEARS, exactly as numbered in the contract (e.g. ["4.2"] or ["Paragraph 7"]). If the language is in unnumbered text such as the opening paragraph or a signature page, use "Opening paragraph" or "Signature page". Never cite a section just because it is related. Empty array if the contract has no numbering at all.
  - "pages": an array of page numbers this analysis is based on, as integers. The contract text may contain markers like "===== PAGE 3 =====" — use those. If there are NO such page markers in the text, return an empty array (do not guess page numbers).
  - "sourceQuotes": an array of 1-3 SHORT verbatim quotes (each roughly 8-25 words) copied EXACTLY from the contract text — the specific language this analysis is based on. Copy the words as they literally appear. If nothing can be quoted, return an empty array.

${RUBRIC}

IMPORTANT: base "sections" and "pages" only on what is actually in the contract text. Never invent a section number or page that isn't there. Money terms (compensation, fees_repayment) are the most important — never omit them when present.

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

export function buildConflictPrompt(entries) {
  const per = Math.floor(200000 / Math.max(1, entries.length));
  const blocks = entries.map((e, i) => {
    const c = e.classification || {};
    return `===== DOCUMENT ${i + 1}: "${e.name}" (${c.contractType || "contract"}) =====
Governing law: ${c.choiceOfLawState || "not stated"}
Disputes: ${c.disputeForum || "not stated"}
Full text:
${e.text.slice(0, per)}`;
  }).join("\n\n");
  return `These documents are being signed together by the same artist with the same company. Compare them and find CONFLICTS or INTERACTIONS between them that matter to the artist: for example, different dispute forums or costs, different governing law, one document's duration depending on an undefined term in another, inconsistent definitions, rights granted in one that undercut protections in the other, or obligations that stack. Only report real conflicts that are supported by the text. Respond ONLY with valid JSON, no preamble, no markdown fences:
{ "conflicts": [ { "title": "short plain-English heading", "explanation": "2-3 plain-English sentences on the conflict and why it matters to the artist", "harmLevel": "low" | "medium" | "high", "references": [ { "document": "exact document name as given above", "sections": ["section ids as numbered in that document"] } ] } ] }
Return { "conflicts": [] } if there are none.

${RUBRIC}

${blocks}`;
}
