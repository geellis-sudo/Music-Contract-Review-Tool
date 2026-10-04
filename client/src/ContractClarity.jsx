import React, { useState, useRef, useCallback } from "react";
import { Upload, Loader2, AlertTriangle, ShieldAlert, TrendingDown, Scale, Search, ChevronDown, ChevronUp, Music2, FileText, X, Copy, Check, Download } from "lucide-react";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');`;

const CATEGORY_ORDER = [
  "advances",
  "recoupment",
  "publishing",
  "merchandising",
  "likeness",
  "term_territory",
];

const CATEGORY_LABEL = {
  advances: "Advances",
  recoupment: "Recoupment",
  publishing: "Publishing Rights",
  merchandising: "Merchandising",
  likeness: "Name, Image & Likeness",
  term_territory: "Term & Territory",
};

const HARM_COLOR = {
  low: "#5C8368",
  medium: "#C08A2E",
  high: "#B3402F",
};

const NEG_LABEL = {
  low: "Rarely moves",
  medium: "Sometimes moves",
  high: "Often negotiable",
};

// --- Source-locating helpers -------------------------------------------------
// Normalize text so smart quotes, dashes, and whitespace differences don't
// break the match between the model's quote and the contract text.
function normalizeForMatch(s) {
  return (s || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// Strip our injected page markers when displaying context to the reader.
function stripPageMarkers(s) {
  return (s || "").replace(/=====\s*PAGE\s+\d+\s*=====/g, "").replace(/\s+/g, " ").trim();
}

// Find every occurrence of `quote` inside `contractText`. Returns an array of
// { index, excerpt } using a normalized search but reporting original-text
// offsets so the excerpt reads naturally. Falls back to a word-window fuzzy
// search if the exact normalized string isn't found.
function locateQuote(contractText, quote) {
  if (!contractText || !quote) return [];
  const normContract = normalizeForMatch(contractText);
  const normQuote = normalizeForMatch(quote);
  if (normQuote.length < 6) return [];

  // Build a map from normalized-index back to original-index.
  const map = [];
  let acc = "";
  let prevSpace = false;
  for (let i = 0; i < contractText.length; i++) {
    const ch = contractText[i];
    let n = ch
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, "-")
      .replace(/\u00A0/g, " ")
      .toLowerCase();
    if (/\s/.test(n)) {
      if (prevSpace) continue;
      n = " ";
      prevSpace = true;
    } else {
      prevSpace = false;
    }
    acc += n;
    map.push(i);
  }
  // acc may have a leading space vs. normalized trim; align by trimming left.
  const leadTrim = acc.length - acc.replace(/^\s+/, "").length;
  const accTrimmed = acc.slice(leadTrim);
  const mapTrimmed = map.slice(leadTrim);

  const results = [];
  let from = 0;
  while (true) {
    const idx = accTrimmed.indexOf(normQuote, from);
    if (idx === -1) break;
    const origStart = mapTrimmed[idx];
    const origEnd = mapTrimmed[Math.min(idx + normQuote.length - 1, mapTrimmed.length - 1)] + 1;
    const ctxStart = Math.max(0, origStart - 90);
    const ctxEnd = Math.min(contractText.length, origEnd + 90);
    results.push({
      index: origStart,
      excerpt: stripPageMarkers(contractText.slice(ctxStart, ctxEnd)),
      core: stripPageMarkers(contractText.slice(origStart, origEnd)),
    });
    from = idx + normQuote.length;
  }
  return results;
}

function Disclaimer({ text }) {
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "'Inter', sans-serif",
      fontWeight: 600,
      fontSize: 11.5,
      letterSpacing: "0.01em",
      color: "#EDE9E0",
      background: "rgba(201,162,39,0.14)",
      border: "1px solid rgba(201,162,39,0.35)",
      borderRadius: 5,
      padding: "3px 8px",
      marginTop: 6,
    }}>
      {text}
    </div>
  );
}

function Pill({ color, children }) {
  return (
    <span style={{
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
      color: color,
      border: `1px solid ${color}`,
      borderRadius: 999,
      padding: "2px 9px",
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function ClauseCard({ clause, research, contractText }) {
  const [open, setOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [occIndex, setOccIndex] = useState(0);
  const harmColor = HARM_COLOR[clause.harmLevel] || "#9A968C";

  // Locate every occurrence of the analyzer's source quotes in the contract.
  const quotes = clause.sourceQuotes || [];
  const locations = [];
  quotes.forEach((q) => {
    const found = locateQuote(contractText || "", q);
    found.forEach((f) => locations.push({ ...f, quote: q }));
  });
  // De-duplicate by original index.
  const seen = new Set();
  const uniqueLocations = locations.filter((l) => {
    if (seen.has(l.index)) return false;
    seen.add(l.index);
    return true;
  }).sort((a, b) => a.index - b.index);

  const hasQuotes = quotes.length > 0;
  const located = uniqueLocations.length > 0;
  const multi = uniqueLocations.length > 1;
  const current = located ? uniqueLocations[occIndex % uniqueLocations.length] : null;

  return (
    <div style={{
      background: "#1B1E25",
      border: "1px solid #2A2E37",
      borderLeft: `3px solid ${harmColor}`,
      borderRadius: 8,
      padding: "18px 20px",
      marginBottom: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{
          fontFamily: "'Fraunces', serif",
          fontWeight: 600,
          fontSize: 19,
          color: "#EDE9E0",
          margin: 0,
        }}>
          {CATEGORY_LABEL[clause.category] || clause.category}
        </h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill color={harmColor}>Harm: {clause.harmLevel}</Pill>
          <Pill color="#8B93A6">{NEG_LABEL[clause.negotiability] || clause.negotiability}</Pill>
        </div>
      </div>

      <p style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 14.5,
        lineHeight: 1.6,
        color: "#C9C5BB",
        marginTop: 10,
        marginBottom: 8,
      }}>
        {clause.plainEnglish}
      </p>

      {clause.harmLevel === "high" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          background: "rgba(179,64,47,0.12)", border: "1px solid rgba(179,64,47,0.4)",
          borderRadius: 6, padding: "8px 12px", marginTop: 4, marginBottom: 10,
          fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13, color: "#E08A75",
        }}>
          <ShieldAlert size={15} style={{ flexShrink: 0 }} /> Worth raising with an attorney.
        </div>
      )}

      {clause.harmDuration && (
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#9A968C", marginBottom: 4 }}>
          <strong style={{ color: "#C9C5BB" }}>How long this follows you: </strong>{clause.harmDuration}
        </div>
      )}

      {clause.revenueImpact && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          background: "rgba(179,64,47,0.08)", border: "1px solid rgba(179,64,47,0.25)",
          borderRadius: 6, padding: "10px 12px", marginTop: 10,
        }}>
          <TrendingDown size={16} color="#B3402F" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.5 }}>
            <strong style={{ color: "#EDE9E0" }}>Where the money goes: </strong>{clause.revenueImpact}
          </div>
        </div>
      )}

      {(() => {
        const sections = clause.sections || [];
        const pages = clause.pages || [];
        const showRow = sections.length || pages.length || hasQuotes;
        if (!showRow) return null;
        return (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2A2E37" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <button
                onClick={() => { setSourceOpen(!sourceOpen); setOccIndex(0); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: sourceOpen ? "rgba(201,162,39,0.12)" : "#15171D",
                  border: `1px solid ${sourceOpen ? "rgba(201,162,39,0.4)" : "#2A2E37"}`,
                  borderRadius: 5, padding: "4px 9px", cursor: "pointer",
                  fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 12,
                  color: sourceOpen ? "#C9A227" : "#C9C5BB",
                }}
              >
                <FileText size={12} /> Source
              </button>
              {sections.map((s, i) => (
                <span key={"s" + i} style={{
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#C9C5BB",
                  background: "#15171D", border: "1px solid #2A2E37", borderRadius: 4, padding: "2px 7px",
                }}>
                  {/^\d/.test(String(s)) ? "§" + s : s}
                </span>
              ))}
              {pages.map((p, i) => (
                <span key={"p" + i} style={{
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#C9A227",
                  background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.30)", borderRadius: 4, padding: "2px 7px",
                }}>
                  p.{p}
                </span>
              ))}
            </div>

            {sourceOpen && (
              <div style={{
                marginTop: 10, background: "#12141A", border: "1px solid #2A2E37",
                borderRadius: 7, padding: "12px 14px",
              }}>
                {located ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "#8B93A6", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        From the contract{multi ? ` — ${(occIndex % uniqueLocations.length) + 1} of ${uniqueLocations.length} places` : ""}
                      </span>
                      <button
                        onClick={() => multi && setOccIndex((occIndex + 1) % uniqueLocations.length)}
                        disabled={!multi}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          background: "none", border: "none",
                          cursor: multi ? "pointer" : "default",
                          fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 12,
                          color: multi ? "#EDE9E0" : "#4A4E57",
                          padding: 0,
                        }}
                        title={multi ? "Next occurrence" : "This language appears only once"}
                      >
                        Next <ChevronDown size={13} style={{ transform: "rotate(-90deg)" }} />
                      </button>
                    </div>
                    <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, lineHeight: 1.6, color: "#C9C5BB", margin: 0 }}>
                      <span style={{ color: "#6E6A61" }}>…</span>
                      {current.excerpt.split(current.core).length === 2 ? (
                        <>
                          {current.excerpt.split(current.core)[0]}
                          <mark style={{ background: "rgba(201,162,39,0.28)", color: "#EDE9E0", padding: "1px 2px", borderRadius: 2 }}>{current.core}</mark>
                          {current.excerpt.split(current.core)[1]}
                        </>
                      ) : current.excerpt}
                      <span style={{ color: "#6E6A61" }}>…</span>
                    </p>
                  </>
                ) : (
                  <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, lineHeight: 1.6, color: "#9A968C", margin: 0 }}>
                    I did analyze this part of the contract, but because of how this document's text came through (formatting, spacing, or scanning quirks), I can't reliably point you to the exact spot. {hasQuotes ? `The language I relied on was roughly: "${quotes[0]}"` : "The contract's own section numbers above are your best guide to the source."}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {research && (
        <div style={{ marginTop: 14 }}>
          <button
            onClick={() => setOpen(!open)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "none", border: "none", cursor: "pointer",
              fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 12.5,
              color: "#C9A227", padding: 0,
            }}
          >
            <Search size={13} />
            What other artists say {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {open && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              {(research.general || []).map((item, i) => (
                <div key={"g" + i} style={{ background: "#15171D", borderRadius: 6, padding: "10px 12px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.55 }}>{item.finding}</div>
                  <Disclaimer text={item.sourceTag} />
                </div>
              ))}
              {(research.operative || []).map((item, i) => (
                <div key={"o" + i} style={{ background: "#15171D", borderRadius: 6, padding: "10px 12px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.55 }}>{item.finding}</div>
                  <Disclaimer text={item.sourceTag} />
                </div>
              ))}
              {(!research.general || research.general.length === 0) && (!research.operative || research.operative.length === 0) && (
                <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#6E6A61", fontStyle: "italic" }}>
                  No specific outside reports found for this clause. That doesn't mean it's fine — it means nothing turned up in this search.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ContractClarity() {
  const [contractText, setContractText] = useState("");
  const [stage, setStage] = useState("idle"); // idle | extracting | classifying | researching | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const [classification, setClassification] = useState(null);
  const [research, setResearch] = useState({});
  const [researchStatus, setResearchStatus] = useState("idle"); // idle | running | ok | empty | failed
  const [researchDebug, setResearchDebug] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sourceKind, setSourceKind] = useState(""); // "pdf" | "docx" | "paste" | ""
  const fileInputRef = useRef(null);

  async function extractPdf(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Insert a visible, machine-readable page marker so the analysis can cite pages.
      text += "\n===== PAGE " + p + " =====\n";
      text += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return text.trim();
  }

  async function extractDocx(file) {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return (result.value || "").trim();
  }

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setErrorMsg("");
    setClassification(null);
    setResearch({});
    const name = file.name.toLowerCase();
    const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
    const isDocx = name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    if (!isPdf && !isDocx) {
      setErrorMsg("That file type isn't supported. Please drop a PDF or a Word (.docx) file — or paste the text instead.");
      return;
    }

    setFileName(file.name);
    setStage("extracting");
    try {
      const text = isPdf ? await extractPdf(file) : await extractDocx(file);
      if (!text || text.length < 40) {
        setStage("idle");
        setErrorMsg("Couldn't pull readable text from that file. If it's a scanned or photographed contract, paste the text in manually instead.");
        return;
      }
      setContractText(text);
      setSourceKind(isPdf ? "pdf" : "docx");
      setStage("idle");
    } catch (err) {
      console.error(err);
      setStage("idle");
      setErrorMsg("Something went wrong reading that file. Try pasting the text in instead.");
    }
  }, []);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  }

  function buildAnalysisText() {
    if (!classification) return "";
    const NEG = { low: "Rarely moves", medium: "Sometimes moves", high: "Often negotiable" };
    const lines = [];
    lines.push("CONTRACT CLARITY — ANALYSIS");
    lines.push("This is not legal advice. Please consult an attorney for the most accurate legal information.");
    lines.push("");
    lines.push("Choice of law: " + (classification.choiceOfLawState || "Not stated in contract"));
    lines.push("Counterparty: " + (classification.operativeName || "Not clearly identified"));
    lines.push("");
    lines.push("========================================");
    lines.push("");

    const ordered = (classification.clauses || [])
      .slice()
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

    ordered.forEach((c) => {
      lines.push((CATEGORY_LABEL[c.category] || c.category).toUpperCase());
      const secs = (c.sections || []).map((s) => (/^\d/.test(String(s)) ? "§" + s : s));
      const pgs = (c.pages || []).map((p) => "p." + p);
      const refs = secs.concat(pgs);
      if (refs.length) {
        lines.push("In the contract: " + refs.join(", "));
      }
      lines.push("Harm level: " + c.harmLevel + "   |   Negotiability: " + (NEG[c.negotiability] || c.negotiability));
      if (c.harmLevel === "high") {
        lines.push(">> Worth raising with an attorney.");
      }
      lines.push("");
      lines.push(c.plainEnglish || "");
      if (c.harmDuration) {
        lines.push("");
        lines.push("How long this follows you: " + c.harmDuration);
      }
      if (c.revenueImpact) {
        lines.push("");
        lines.push("Where the money goes: " + c.revenueImpact);
      }
      const r = research[c.category];
      if (r && ((r.general && r.general.length) || (r.operative && r.operative.length))) {
        lines.push("");
        lines.push("What other artists say:");
        (r.general || []).forEach((it) => {
          lines.push("  - " + it.finding + "  [" + it.sourceTag + "]");
        });
        (r.operative || []).forEach((it) => {
          lines.push("  - " + it.finding + "  [" + it.sourceTag + "]");
        });
      }
      lines.push("");
      lines.push("----------------------------------------");
      lines.push("");
    });

    lines.push("As a reminder, consult an attorney" + (classification.choiceOfLawState ? " licensed in " + classification.choiceOfLawState : "") + ".");

    return lines.join("\n");
  }

  async function handleCopy() {
    const text = buildAnalysisText();
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Fallback for environments where the clipboard API is blocked
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const text = buildAnalysisText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const base = (fileName || "contract").replace(/\.[^.]+$/, "");
    a.href = url;
    a.download = base + "-analysis.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function clearFile() {
    setFileName("");
    setContractText("");
    setSourceKind("");
    setErrorMsg("");
    setClassification(null);
    setResearch({});
  }

  // Talk to the local backend, which holds the API key and the prompts.
  // Returns { text } on success or { error: { message } } on failure.
  async function callBackend(path, payload) {
    let res;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      return { error: { message: "Network request failed — the tool couldn't reach the analysis service." } };
    }
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      return { error: { message: "The service replied with something that wasn't readable (status " + res.status + ")." } };
    }
    if (data.error) return { error: { message: data.error } };
    if (!res.ok) return { error: { message: "The service returned status " + res.status + "." } };
    return data;
  }

  function parseJson(raw) {
    if (!raw) throw new Error("empty");
    let cleaned = raw.replace(/```json|```/g, "").trim();
    // Isolate the outermost JSON object/array in case the model added prose.
    const firstBrace = cleaned.search(/[{[]/);
    const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleaned);
  }

  async function handleAnalyze() {
    if (!contractText.trim()) return;
    setErrorMsg("");
    setClassification(null);
    setResearch({});
    setResearchStatus("idle");
    setResearchDebug("");
    setStage("classifying");

    try {
      const classifyData = await callBackend("/api/analyze", { contractText });
      // Surface an API-level error if the call itself was rejected.
      if (classifyData && classifyData.error) {
        const m = classifyData.error.message || JSON.stringify(classifyData.error);
        throw new Error("API error: " + m);
      }
      const classifyText = classifyData.text || "";
      if (!classifyText) {
        const shape = classifyData ? JSON.stringify(classifyData).slice(0, 300) : "no response object";
        throw new Error("The analysis step returned no readable text. Raw response: " + shape);
      }
      let parsedClassification;
      try {
        parsedClassification = parseJson(classifyText);
      } catch (e) {
        throw new Error("The analysis reply couldn't be read as data. It started with: " + classifyText.slice(0, 200));
      }
      setClassification(parsedClassification);
      setStage("researching");
      setResearchStatus("running");

      const categories = (parsedClassification.clauses || []).map((c) => c.category);
      const researchData = await callBackend("/api/research", {
        categories,
        operativeName: parsedClassification.operativeName,
      });
      const researchText = (researchData && researchData.text) || "";
      let parsedResearch = {};
      let ok = false;
      try {
        parsedResearch = parseJson(researchText);
        ok = true;
      } catch (e) {
        // Capture why it failed so it isn't a silent dead end.
        const apiErr = researchData && researchData.error
          ? (researchData.error.message || JSON.stringify(researchData.error))
          : null;
        setResearchDebug(
          apiErr
            ? "The research service returned an error: " + apiErr
            : "The research step ran but its reply couldn't be read as data. This usually means web search isn't available in this environment."
        );
      }
      setResearch(parsedResearch);

      // Did we actually get any findings?
      const hasFindings = Object.values(parsedResearch || {}).some(
        (v) => v && ((v.general && v.general.length) || (v.operative && v.operative.length))
      );
      if (!ok) setResearchStatus("failed");
      else if (hasFindings) setResearchStatus("ok");
      else setResearchStatus("empty");

      setStage("done");
    } catch (err) {
      console.error(err);
      setErrorMsg((err && err.message) ? err.message : "Something went wrong analyzing this contract. You can try again.");
      setStage("error");
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#14161B",
      padding: "32px 16px 64px",
      fontFamily: "'Inter', sans-serif",
    }}>
      <style>{FONT_IMPORT}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Music2 size={22} color="#C9A227" />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.08em", color: "#8B93A6", textTransform: "uppercase" }}>
            Contract Clarity
          </span>
        </div>
        <h1 style={{
          fontFamily: "'Fraunces', serif",
          fontWeight: 700,
          fontSize: "clamp(28px, 5vw, 40px)",
          color: "#EDE9E0",
          margin: "0 0 10px",
          lineHeight: 1.15,
        }}>
          Know what you're signing.
        </h1>
        <p style={{ color: "#9A968C", fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: "0 0 6px" }}>
          Paste a music contract below. This breaks it down in plain English — what's negotiable, what isn't, and where the money actually goes.
        </p>
        <Disclaimer text="This is not legal advice. Please consult an attorney for the most accurate legal information." />

        <div style={{ marginTop: 28 }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDrop={onDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            style={{
              border: `1.5px dashed ${dragOver ? "#C9A227" : "#3A3D45"}`,
              background: dragOver ? "rgba(201,162,39,0.06)" : "#1B1E25",
              borderRadius: 8,
              padding: "22px 20px",
              textAlign: "center",
              cursor: "pointer",
              marginBottom: 14,
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files && e.target.files[0])}
            />
            {stage === "extracting" ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#C9A227", fontSize: 14, fontWeight: 600 }}>
                <Loader2 size={16} className="spin" /> Reading {fileName || "file"}...
              </div>
            ) : fileName ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "#EDE9E0", fontSize: 14 }}>
                <FileText size={16} color="#C9A227" />
                <span style={{ fontWeight: 600 }}>{fileName}</span>
                <span style={{ color: "#5C8368", fontSize: 12.5 }}>· text loaded below</span>
                <button
                  onClick={(e) => { e.stopPropagation(); clearFile(); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#8B93A6", display: "inline-flex", padding: 2 }}
                  title="Clear"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#C9C5BB", fontSize: 14.5, fontWeight: 600 }}>
                  <Upload size={16} color="#C9A227" /> Drag a contract here, or click to choose a file
                </div>
                <div style={{ color: "#6E6A61", fontSize: 12.5, marginTop: 6 }}>
                  PDF or Word (.docx) · or paste the text below
                </div>
              </>
            )}
          </div>

          <textarea
            value={contractText}
            onChange={(e) => { setContractText(e.target.value); if (!fileName) setSourceKind("paste"); }}
            placeholder="...or paste the full text of the contract here."
            style={{
              width: "100%",
              minHeight: 200,
              background: "#1B1E25",
              border: "1px solid #2A2E37",
              borderRadius: 8,
              color: "#EDE9E0",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
              lineHeight: 1.6,
              padding: 16,
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />

          <button
            onClick={handleAnalyze}
            disabled={!contractText.trim() || stage === "extracting" || stage === "classifying" || stage === "researching"}
            style={{
              marginTop: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: contractText.trim() ? "#C9A227" : "#3A3D45",
              color: contractText.trim() ? "#14161B" : "#8B93A6",
              border: "none",
              borderRadius: 7,
              padding: "11px 20px",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 600,
              fontSize: 14,
              cursor: contractText.trim() ? "pointer" : "not-allowed",
            }}
          >
            {stage === "classifying" || stage === "researching" ? (
              <>
                <Loader2 size={16} className="spin" />
                {stage === "classifying" ? "Reading the contract..." : "Researching..."}
              </>
            ) : (
              <>
                <Upload size={16} />
                Analyze contract
              </>
            )}
          </button>
          <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>

          {errorMsg && (
            <div style={{ marginTop: 12, color: "#E08A75", fontSize: 13.5, display: "flex", gap: 8, alignItems: "center" }}>
              <AlertTriangle size={15} /> {errorMsg}
            </div>
          )}
        </div>

        {classification && (
          <div style={{ marginTop: 40 }}>
            <div style={{
              background: "#1B1E25",
              border: "1px solid #2A2E37",
              borderRadius: 8,
              padding: "18px 20px",
              marginBottom: 22,
            }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                <div style={{
                  flex: "1 1 200px",
                  background: "#15171D", border: "1px solid #2A2E37", borderRadius: 7,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#8B93A6", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Choice of law</div>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#EDE9E0", display: "flex", alignItems: "center", gap: 6 }}>
                    <Scale size={16} color="#C9A227" style={{ flexShrink: 0 }} /> {classification.choiceOfLawState || "Not stated in contract"}
                  </div>
                </div>
                <div style={{
                  flex: "1 1 200px",
                  background: "#15171D", border: "1px solid #2A2E37", borderRadius: 7,
                  padding: "12px 14px",
                }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#8B93A6", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Counterparty</div>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#EDE9E0", display: "flex", alignItems: "center", gap: 6 }}>
                    <ShieldAlert size={16} color="#C9A227" style={{ flexShrink: 0 }} /> {classification.operativeName || "Not clearly identified"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button
                  onClick={handleCopy}
                  style={{
                    flex: "1 1 0",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    background: copied ? "rgba(92,131,104,0.15)" : "#15171D",
                    border: `1px solid ${copied ? "#5C8368" : "#2A2E37"}`,
                    borderRadius: 7, padding: "10px 13px", cursor: "pointer",
                    fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13,
                    color: copied ? "#7FB08C" : "#C9C5BB",
                  }}
                >
                  {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy analysis</>}
                </button>
                <button
                  onClick={handleDownload}
                  style={{
                    flex: "1 1 0",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    background: "#15171D", border: "1px solid #2A2E37",
                    borderRadius: 7, padding: "10px 13px", cursor: "pointer",
                    fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13,
                    color: "#C9C5BB",
                  }}
                >
                  <Download size={14} /> Download
                </button>
              </div>
            </div>

            {sourceKind && sourceKind !== "pdf" && (
              <div style={{
                fontFamily: "'Inter', sans-serif", fontSize: 12.5, color: "#6E6A61",
                marginBottom: 16, lineHeight: 1.5,
              }}>
                References below use the contract's own section numbers. Page numbers aren't shown because {sourceKind === "docx" ? "Word documents" : "pasted text"} don't have fixed pages — upload the PDF version if you need page citations.
              </div>
            )}

            {researchStatus === "running" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9A968C", fontSize: 13.5, marginBottom: 18 }}>
                <Loader2 size={15} className="spin" /> Looking into how other artists have experienced these terms...
              </div>
            )}
            {researchStatus === "empty" && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 18,
                background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 6, padding: "10px 12px",
                color: "#9A968C", fontSize: 13,
              }}>
                <Search size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>The outside-research step ran but didn't return specific findings for these clauses. That's not the same as "all clear" — it just means nothing usable came back this time.</span>
              </div>
            )}
            {researchStatus === "failed" && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 18,
                background: "rgba(201,138,46,0.10)", border: "1px solid rgba(201,138,46,0.35)", borderRadius: 6, padding: "10px 12px",
                color: "#D9B060", fontSize: 13,
              }}>
                <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>
                  The "what other artists say" research didn't run successfully, so the breakdown below is based on the contract text alone.
                  {researchDebug ? " " + researchDebug : ""}
                </span>
              </div>
            )}

            {(classification.clauses || [])
              .slice()
              .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
              .map((clause, i) => (
                <ClauseCard key={i} clause={clause} research={research[clause.category]} contractText={contractText} />
              ))}

            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 8,
              padding: "14px 18px", marginTop: 8,
              fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.5,
            }}>
              <Scale size={16} color="#C9A227" style={{ flexShrink: 0 }} />
              <span>
                As a reminder, consult an attorney{classification.choiceOfLawState ? ` licensed in ${classification.choiceOfLawState}` : ""}.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
