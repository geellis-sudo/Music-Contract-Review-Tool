# Contract Clarity

**Know what you're signing.** Contract Clarity reads music and entertainment contracts (record deals, talent agency agreements, likeness releases, management deals and similar) and explains them in plain English for artists who aren't lawyers: what each clause does, how much long-term harm it could cause, how negotiable it usually is, and where the money goes.

![Contract Clarity start screen](docs/screenshot.png)

> **This is not legal advice.** Contract Clarity is an educational tool. Talk to an attorney licensed in your contract's governing-law state before signing anything.

## What it does

- **Add one contract, several that go together, or successive drafts of one agreement.** Drop PDF or Word (.docx) files anywhere on the page, or paste text. Files are read in the browser as soon as they are added, so the tool can show who made the tracked changes and whether the files are drafts of one agreement; nothing goes to Claude until you click **Analyze**. PDFs keep their page numbers, so findings can cite pages.
- **Say who the review is for.** Pick the artist, the artist's attorney, or the agency or company. Attorney mode adds suggested counter-language to each change, open comment and clause. Mark each file as your draft or the other side's, and tap each person in the tracked changes to put them on your side or the other side. Concessions in your own draft are labeled as concessions, not as harm.
- **Stop at any time.** A **Stop** button ends the run and keeps whatever already finished; removing a file mid-run skips it. The server aborts the Claude call when the browser stops waiting.
- **Clause-by-clause breakdown** across the terms that matter in entertainment deals: commission and compensation, fees and repayment, advances, recoupment and set-off, exclusivity, publishing, ownership of the artist's materials, merchandising, name/image/likeness, term and territory, termination, confidentiality, release of claims, disputes and arbitration, assignment, drafting problems (blank lines, missing schedules, garbled text), plus a catch-all for anything else harmful. Each clause gets:
  - a plain-English explanation
  - a harm rating (low, medium, high) and how long the effect follows the artist, scored against a fixed rubric so repeated runs stay consistent
  - a negotiability rating
  - where money is lost or withheld
  - **Works in your favor:** protective language the artist benefits from
  - **Law check:** a warning when a clause appears to depart from a statute it cites
  - the contract's own section numbers and pages, plus a **Source** button that highlights the exact language the analysis relied on
- **Redlines are read as redlines, split by side and round.** When a .docx carries tracked changes or comments, the tool opens the Word package itself and reads what the text extraction throws away: every insertion and deletion with its author, date and section, every comment with its exact anchor, reply threads (`commentsExtended.xml`) and resolved flags. Word's run-by-run pieces are joined into single edits. The redline panel then has three parts:
  - **Their changes this round**: each change with what the text now says, what their comment says they want, whether the gap helps or hurts you, and flags for "rejected your proposed language" (a deletion inside your tracked insertion) and "comment asks for more than the edit." Each change is judged by the resulting text, not by who made it.
  - **Open items they raised without editing**: new comments of theirs with no edit beside them, with a suggested answer.
  - **Your earlier changes still pending**, marked where they struck them.
- **Drafts compared draft to draft.** When the files share most of their wording, the tool treats them as versions of one agreement (you can override this), orders them by the date in the filename or header, analyzes the latest draft in full, and runs a comparison pass on differences computed by code, sentence by sentence: who moved, on which points, and what is still open.
- **Documents you need before signing.** Schedules, licenses, fee schedules or earlier drafts that the contract or a comment refers to but that weren't uploaded are listed at the top.
- **Word copy with notes.** For a .docx redline, download a copy of the file with the analysis of each change and open item added as Word comments, ready for the next round.
- **Figures checked by code.** Dates, blank signature and date fields, percentages, dollar amounts, years and referenced attachments are pulled out of the document by regular expressions, not by the model, and that list is handed to the model as authoritative. The model's reply is then audited against it, and any year or percentage it mentions that is not in the document is flagged as **unverified** above the breakdown. Blank date fields are reported as blank rather than guessed at — form fields in a PDF reflow when the text is extracted, which is how a model invents an approval date that was never there.
- **Conflicts between documents.** When you analyze separate documents signed together (for example an agency agreement and a likeness release), a comparison pass flags terms that clash, such as different dispute forums. The comparison pass sees each document's clause findings and redline summary, so it cannot contradict the per-document analysis it is built on.
- **"Worth raising with an attorney"** flag on high-harm clauses.
- **Contract type, choice of law, where disputes go, and counterparty** for each document, with a closing reminder to consult an attorney licensed in that state.
- **"What other artists say" (optional, off by default).** A research pass uses web search to find how artists in that type of deal describe these terms, and the counterparty's reputation. Findings must fit the contract's actual terms, and every one carries a plain-language source tag (for example, "This is from Reddit — real people, not verified facts").
- **Copy or download** the full analysis as text.

## How it works

```
Browser (React + Vite)  ──/api──▶  Express server  ──▶  Claude API
  file reading, UI                   holds API key         1. clause analysis (per document)
  source highlighting                and prompts           2. research with web search
                                                           3. conflicts between documents
```

The API key never reaches the browser. The server holds it and makes every call.

## Run it locally

You need Node.js 18 or newer and an [Anthropic API key](https://console.anthropic.com/). Each analyzed document takes one API call, plus one per pair of drafts compared, one comparison call when you analyze separate documents together, and one research call per document if you turn research on (research uses web search, which is billed per search). Set a spend limit in the console while testing.

```bash
git clone <this repo>
cd <this repo>
npm run setup            # installs server and client dependencies
cp .env.example .env     # then put your API key in .env
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). The backend runs on port 3001.

## Project layout

```
server/server.js                 Express backend: /api/analyze, /api/research, /api/conflicts, /api/compare
server/prompts.js                The prompts sent to Claude, including the rating rubric
server/docfacts.js               Pulls dates, amounts and blanks out of the text by code; audits the reply
server/markup.js                 Renders tracked changes and comments into the prompt
client/src/markup.js             Reads tracked changes, comments and threads out of the .docx; splits them by side and round; diffs drafts; writes the Word copy with notes
client/src/ContractClarity.jsx   The whole front end
docs/BUILD-SPEC.md               Original notes for moving from a Claude artifact to a local app
```

## Known limits

- Scanned or photographed PDFs have no extractable text. Paste the text instead.
- Word files and pasted text have no fixed pages, so only PDFs get page citations.
- Section references depend on the contract's own numbering.
- Source highlighting is fuzzy-matched and can miss on badly formatted documents. The tool says so when it can't find the spot.
- Only the first 100,000 characters of each contract are analyzed, and the report says so when a document is longer.
- "Rejected your proposed language" is detected only while your language is still an unaccepted tracked insertion. Once it has been accepted, a deletion of it reads as an ordinary deletion.
- Tracked changes and comments are read from .docx files only. A PDF of a redline shows the markup as pictures, with no change data to read.
- Ratings follow a fixed rubric but come from a language model, so they can still vary slightly between runs.

## License

[GNU Affero General Public License v3.0](LICENSE). You may use, study, and modify this code. If you run a modified version as a network service, you must make your source available to its users.
