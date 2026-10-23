import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { buildClassifyPrompt, buildResearchPrompt, buildConflictPrompt, buildComparePrompt } from "./prompts.js";
import { extractDocFacts, auditClaims } from "./docfacts.js";

dotenv.config();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // contracts can be large

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

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

// Stop the Claude call when the browser goes away (the Stop button aborts the
// fetch), so a cancelled run does not keep spending tokens.
function abortOnClose(req, res) {
  const ctl = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ctl.abort(); });
  return ctl.signal;
}

function sendError(res, err, label) {
  if (err && (err.name === "AbortError" || err.constructor?.name === "APIUserAbortError")) return; // browser left
  console.error(label + " failed:", err);
  if (!res.headersSent) res.status(500).json({ error: err.message || "Request failed." });
}

// --- 1. Clause analysis (no tools) -----------------------------------------
app.post("/api/analyze", async (req, res) => {
  const { contractText, org, opts } = req.body || {};
  if (!contractText || !contractText.trim()) {
    return res.status(400).json({ error: "No contract text provided." });
  }
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: "user", content: buildClassifyPrompt(contractText, org, opts || {}) }],
    }, { signal: abortOnClose(req, res) });
    const text = extractText(msg);
    // Check the model's figures against the document before they reach the user.
    let audit = [];
    try {
      const cleaned = text.replace(/```json|```/g, "").trim();
      const a = cleaned.search(/[{[]/);
      const b = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
      if (a !== -1 && b > a) {
        audit = auditClaims(JSON.parse(cleaned.slice(a, b + 1)), contractText, extractDocFacts(contractText));
      }
    } catch (e) { audit = []; }
    res.json({ text, audit });
  } catch (err) {
    sendError(res, err, "analyze");
  }
});

// --- 2. Research agent (WITH web search) ------------------------------------
app.post("/api/research", async (req, res) => {
  const { classification } = req.body || {};
  if (!classification || !Array.isArray(classification.clauses)) {
    return res.status(400).json({ error: "No analysis provided to research." });
  }
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        { role: "user", content: buildResearchPrompt(classification) },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 8,
        },
      ],
    }, { signal: abortOnClose(req, res) });
    res.json({ text: extractText(msg) });
  } catch (err) {
    sendError(res, err, "research");
  }
});

// --- 3. Conflicts between related documents (no tools) ---------------------
app.post("/api/conflicts", async (req, res) => {
  const { documents, opts } = req.body || {};
  if (!Array.isArray(documents) || documents.length < 2) {
    return res.status(400).json({ error: "At least two analyzed documents are needed." });
  }
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: buildConflictPrompt(documents, opts || {}) }],
    }, { signal: abortOnClose(req, res) });
    res.json({ text: extractText(msg) });
  } catch (err) {
    sendError(res, err, "conflicts");
  }
});

// --- 4. Two drafts of one agreement (no tools) -------------------------------
// The differences are computed in the browser (diffVersions); this call only
// reads them.
app.post("/api/compare", async (req, res) => {
  const { older, newer, hunks, opts } = req.body || {};
  if (!older || !newer || !Array.isArray(hunks)) {
    return res.status(400).json({ error: "Two drafts and their differences are needed." });
  }
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: buildComparePrompt(older, newer, hunks, opts || {}) }],
    }, { signal: abortOnClose(req, res) });
    res.json({ text: extractText(msg) });
  } catch (err) {
    sendError(res, err, "compare");
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Contract Clarity backend on http://localhost:${port}`);
});
