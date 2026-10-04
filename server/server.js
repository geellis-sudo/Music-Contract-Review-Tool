import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { buildClassifyPrompt, buildResearchPrompt } from "./prompts.js";

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

// --- 1. Clause analysis (no tools) -----------------------------------------
app.post("/api/analyze", async (req, res) => {
  const { contractText } = req.body || {};
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
  const { categories, operativeName } = req.body || {};
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

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Contract Clarity backend on http://localhost:${port}`);
});
