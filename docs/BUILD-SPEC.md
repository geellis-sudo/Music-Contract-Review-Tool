# Contract Clarity — Local Build Spec (VS Code)

**Goal:** Run the existing Contract Clarity analyzer locally, with a small backend so the
"what other artists say" research agent actually works (it cannot work inside a Claude artifact).

**Scope for this build:** local only. No database, no user accounts, no deployment.

---

## 0. Before you start

You need:

- **Node.js 18 or newer** — check with `node -v`. If missing, install from nodejs.org.
- **An Anthropic API key** from console.anthropic.com (Settings → API keys).
  This is billed separately from a Claude subscription. Set a spend limit in the console
  while developing.
- **The existing artifact file** `ContractClarity.jsx` — this is the front end and gets ported
  almost as-is.

**Cost note:** each analysis makes two API calls. The second uses the web search tool, which is
billed per search (roughly $10 per 1,000 searches) on top of normal token cost. Testing a handful
of contracts is cents, not dollars — but it is real money and it is metered.

---

## 1. Project structure to create

```
contract-clarity/
├── .env                  <- API key lives here. NEVER commit.
├── .gitignore
├── package.json
├── server/
│   └── server.js         <- Express backend (holds the key, calls Anthropic)
└── client/               <- Vite + React front end
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        └── ContractClarity.jsx   <- ported from the artifact
```

**Why a backend at all:** the API key must never sit in front-end code, because anything in the
browser is readable by the user. The backend holds the key and the browser talks only to the
backend.

---

## 2. Setup commands

```bash
mkdir contract-clarity && cd contract-clarity
npm init -y
npm install express cors dotenv @anthropic-ai/sdk

npm create vite@latest client -- --template react
cd client
npm install lucide-react mammoth pdfjs-dist
cd ..
```

---

## 3. `.env` (project root)

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
PORT=3001
```

## 4. `.gitignore` (project root)

```
node_modules
.env
dist
.DS_Store
```

**Verify before any commit:** run `git status` and confirm `.env` does not appear.
If the key ever leaks, revoke it in the console immediately and issue a new one.

---

## 5. `server/server.js`

This is the critical new piece. Two endpoints mirroring the artifact's two calls — the second
one carries the web search tool, which is the whole reason for this build.

```js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // contracts can be large

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

// Pull just the model's text blocks out of a response. With web search the
// response also contains server_tool_use and web_search_tool_result blocks,
// which we do not want in the JSON we parse.
function extractText(msg) {
  if (!msg || !msg.content) return "";
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// --- 1. Clause analysis (no tools) -----------------------------------------
app.post("/api/analyze", async (req, res) => {
  const { contractText } = req.body;
  if (!contractText || !contractText.trim()) {
    return res.status(400).json({ error: "No contract text provided." });
  }
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: buildClassifyPrompt(contractText) }],
    });
    res.json({ text: extractText(msg) });
  } catch (err) {
    console.error("analyze failed:", err);
    res.status(500).json({ error: err.message || "Analysis failed." });
  }
});

// --- 2. Research agent (WITH web search) ------------------------------------
app.post("/api/research", async (req, res) => {
  const { categories, operativeName } = req.body;
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        { role: "user", content: buildResearchPrompt(categories, operativeName) },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 8,
        },
      ],
    });
    res.json({ text: extractText(msg) });
  } catch (err) {
    console.error("research failed:", err);
    res.status(500).json({ error: err.message || "Research failed." });
  }
});

app.listen(process.env.PORT || 3001, () => {
  console.log(`Contract Clarity backend on http://localhost:${process.env.PORT || 3001}`);
});
```

**Port the two prompt builders** (`buildClassifyPrompt`, `buildResearchPrompt`) directly from
`ContractClarity.jsx` — they already exist there as inline template strings inside
`handleAnalyze`. Move them into `server.js` as functions, unchanged. Keep every field:
`choiceOfLawState`, `operativeName`, and per clause `category`, `plainEnglish`, `negotiability`,
`harmLevel`, `harmDuration`, `revenueImpact`, `sections`, `pages`, `sourceQuotes`.

The research prompt keeps both tracks: general clause-type findings, and the counterparty-specific
reputation lookup. Keep the instruction that each finding carries a plain-language `sourceTag`
disclaimer ("This is from Reddit — real people, not verified facts." / "Industry reporting is not
a legal finding.").

---

## 6. `package.json` scripts (project root)

Add to the root `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "server": "node server/server.js",
    "client": "npm --prefix client run dev",
    "dev": "npm run server & npm run client"
  }
}
```

---

## 7. `client/vite.config.js` — proxy the API

So the front end can call `/api/...` without CORS friction:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

---

## 8. Porting `ContractClarity.jsx`

Copy the artifact file into `client/src/`. It works nearly unchanged. Required edits:

1. **Replace the `callClaude` function.** It currently POSTs to
   `https://api.anthropic.com/v1/messages` directly from the browser. Delete that. Replace the two
   call sites with fetches to the local backend:

   ```js
   // classification
   const r = await fetch("/api/analyze", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ contractText }),
   });
   const { text, error } = await r.json();
   ```

   ```js
   // research
   const r = await fetch("/api/research", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ categories, operativeName: parsedClassification.operativeName }),
   });
   const { text, error } = await r.json();
   ```

2. **Move the prompt strings to the server** (per section 5) and delete them from the client.

3. **Keep everything else as-is** — the fuzzy source-locating helpers (`normalizeForMatch`,
   `locateQuote`, `stripPageMarkers`), the Source button and bubble with the Next control, the
   harm/negotiability flags, the "Worth raising with an attorney" marker on high-harm clauses,
   the top and bottom disclaimers, PDF page markers, mammoth/docx extraction, copy and download.

4. **pdf.js:** the artifact loads pdf.js from a CDN at runtime. Locally, prefer the installed
   package instead:

   ```js
   import * as pdfjsLib from "pdfjs-dist";
   import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
   pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
   ```

   Keep the `===== PAGE n =====` markers being inserted during extraction — the page citations
   depend on them.

5. `client/src/main.jsx` should render `<ContractClarity />`.

---

## 9. Run it

```bash
npm run dev
```

Backend on `localhost:3001`, front end on the Vite URL it prints (usually `localhost:5173`).

---

## 10. What to verify once it runs

In priority order — the first item is the entire reason for this build:

1. **Does the research agent actually work now?** Upload a contract and confirm the
   "what other artists say" section populates instead of showing the failure notice.
2. **Is the counterparty track real?** This is the piece that could never work in the artifact.
   Check whether searching a named label/manager returns anything genuinely specific, or just
   generic filler. If it is thin, the prompt needs work — or the idea needs rethinking.
3. **Are the source tags attached correctly?** Every finding should carry its plain-language
   disclaimer naming the source type.
4. **Do the Source bubbles still locate language correctly** after the port?
5. **Does `.env` stay out of git?**

---

## Known limits carried over from the artifact

- **Scanned/image PDFs** produce no extractable text. The tool tells the user to paste instead.
- **Word and pasted text have no page numbers** — page citations are PDF-only, by design.
- **Section references depend on the contract's own numbering.** Unnumbered contracts get no
  section chips.
- **Source locating is fuzzy-matched** and can occasionally miss on badly formatted documents;
  the honest fallback message covers this.
- **Nothing here is legal advice**, and the disclaimers throughout are load-bearing. Keep them.
