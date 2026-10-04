// Prompt builders for the two Claude calls. Moved here from the original
// artifact so the API key and prompts stay on the server.

export function buildClassifyPrompt(contractText) {
  return `You are analyzing a music industry contract for an artist who is not a lawyer. Read the contract text below and respond ONLY with valid JSON, no preamble, no markdown fences.

Extract:
- "choiceOfLawState": the state named in the choice-of-law / governing-law clause (full name, e.g. "New York"), or null if none is stated
- "operativeName": the name of the company, label, publisher, or manager who is the counterparty offering the contract, or null if unclear
- "clauses": an array covering whichever of these categories are actually present in the contract: advances, recoupment, publishing, merchandising, likeness, term_territory. For each present category include:
  - "category": one of the category keys above
  - "plainEnglish": 2-3 plain-English sentences explaining what this clause actually does for a music artist with no legal background
  - "negotiability": "low" | "medium" | "high" — how flexible a music company typically is on this type of term
  - "harmLevel": "low" | "medium" | "high" — how much long-term harm this term could cause the artist
  - "harmDuration": a short phrase on how long this term's effects follow the artist (e.g. "life of copyright", "duration of contract plus 2 years")
  - "revenueImpact": a short plain-English note on where money is lost or withheld because of this clause, or null if not applicable
  - "sections": an array of the section/clause/paragraph identifiers in the contract that this analysis is based on, exactly as they appear (e.g. ["4.2", "4.3"] or ["Paragraph 7"]). Empty array if the contract has no numbering.
  - "pages": an array of page numbers this analysis is based on, as integers. The contract text may contain markers like "===== PAGE 3 =====" — use those to determine page numbers. If there are NO such page markers in the text, return an empty array (do not guess page numbers).
  - "sourceQuotes": an array of 1-3 SHORT verbatim quotes (each roughly 8-25 words) copied EXACTLY from the contract text — the specific language this analysis is based on. Copy the words as they literally appear; do not paraphrase, clean up, or shorten mid-phrase. These are used to locate the passage in the original document. If nothing can be quoted, return an empty array.

IMPORTANT: base "sections" and "pages" only on what is actually in the contract text. Never invent a section number or page that isn't there.

Keep every string concise. Contract text:
---
${contractText.slice(0, 12000)}
---`;
}

export function buildResearchPrompt(categories, operativeName) {
  return `You are researching real-world artist experiences relevant to a music contract. Use web search. Respond ONLY with valid JSON, no preamble, no markdown fences.

Clause categories present: ${(categories || []).join(", ")}
Counterparty name (label/publisher/manager), if known: ${operativeName || "unknown"}

For each category, search for how musicians commonly describe their real experience with that type of clause (forums, artist interviews, industry press, Reddit, etc). Separately, if a counterparty name is known, search for that specific company or person's reputation, disputes, or artist complaints.

Return JSON shaped like:
{
  "<category>": {
    "general": [ { "finding": "short plain-English finding", "sourceTag": "short bolded-style disclaimer naming the source type, e.g. 'This is from Reddit — real people, not verified facts.' or 'Industry reporting is not a legal finding.'" } ],
    "operative": [ { "finding": "short plain-English finding specific to the named counterparty, or omit if nothing found", "sourceTag": "short source disclaimer as above" } ]
  }
}
Include at most 2 findings per array per category. If nothing specific was found for "operative", return an empty array for it rather than guessing.`;
}
