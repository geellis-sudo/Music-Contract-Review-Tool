import React, { useState, useRef, useCallback } from "react";
import { Upload, Loader2, AlertTriangle, ShieldAlert, TrendingDown, Scale, Search, ChevronDown, ChevronUp, Music2, FileText, X, Copy, Check, Download } from "lucide-react";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');`;

const CATEGORY_ORDER = [
  "compensation",
  "fees_repayment",
  "advances",
  "recoupment",
  "exclusivity",
  "publishing",
  "ownership",
  "merchandising",
  "likeness",
  "term_territory",
  "termination",
  "confidentiality",
  "release_of_claims",
  "dispute_resolution",
  "assignment",
  "drafting",
  "other",
];

const CATEGORY_LABEL = {
  compensation: "Commission & Compensation",
  fees_repayment: "Fees & Repayment",
  advances: "Advances",
  recoupment: "Recoupment",
  exclusivity: "Exclusivity",
  publishing: "Publishing Rights",
  ownership: "Ownership of Your Work & Materials",
  merchandising: "Merchandising",
  likeness: "Name, Image & Likeness",
  term_territory: "Term & Territory",
  termination: "Getting Out (Termination)",
  confidentiality: "Confidentiality",
  release_of_claims: "Giving Up Your Right to Sue",
  dispute_resolution: "Disputes & Arbitration",
  assignment: "Transfer to Someone Else",
  drafting: "Drafting Problems",
  other: "Other Important Term",
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
          {clause.category === "other" && clause.title ? clause.title : (CATEGORY_LABEL[clause.category] || clause.category)}
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

      {clause.statuteFlag && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 7,
          background: "rgba(179,64,47,0.12)", border: "1px solid rgba(179,64,47,0.4)",
          borderRadius: 6, padding: "8px 12px", marginBottom: 10,
          fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#E08A75", lineHeight: 1.5,
        }}>
          <Scale size={15} style={{ flexShrink: 0, marginTop: 2 }} /> <span><strong>Law check: </strong>{clause.statuteFlag} Have an attorney confirm.</span>
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

      {clause.worksInYourFavor && (
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-start",
          background: "rgba(92,131,104,0.10)", border: "1px solid rgba(92,131,104,0.35)",
          borderRadius: 6, padding: "10px 12px", marginTop: 10,
        }}>
          <Check size={16} color="#7FB08C" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.5 }}>
            <strong style={{ color: "#EDE9E0" }}>Works in your favor: </strong>{clause.worksInYourFavor}
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

// ---------------------------------------------------------------------------
// Results for one document
// ---------------------------------------------------------------------------
function DocResult({ entry, multi }) {
  const c = entry.classification;
  const tile = (label, value, Icon) => (
    <div style={{ flex: "1 1 200px", minWidth: 0, background: "#15171D", border: "1px solid #2A2E37", borderRadius: 7, padding: "12px 14px" }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#8B93A6", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#EDE9E0", display: "flex", alignItems: "center", gap: 6 }}>
        <Icon size={16} color="#C9A227" style={{ flexShrink: 0 }} /> {value}
      </div>
    </div>
  );
  return (
    <div style={{ marginTop: 34 }}>
      {multi && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <FileText size={16} color="#C9A227" />
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 22, color: "#EDE9E0", margin: 0, overflowWrap: "anywhere" }}>{entry.name}</h2>
        </div>
      )}
      {entry.error ? (
        <div style={{ color: "#E08A75", fontSize: 13.5, display: "flex", gap: 8, alignItems: "center" }}>
          <AlertTriangle size={15} /> {entry.error}
        </div>
      ) : (
        <>
          <div style={{ background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 8, padding: "18px 20px", marginBottom: 22 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
              {tile("Choice of law", c.choiceOfLawState || "Not stated in contract", Scale)}
              {tile("Counterparty", c.operativeName || "Not clearly identified", ShieldAlert)}
            </div>
            {(c.contractType || c.disputeForum) && (
              <div style={{ marginTop: 12, fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.6 }}>
                {c.contractType && <div><strong style={{ color: "#EDE9E0" }}>Contract type: </strong>{c.contractType}</div>}
                {c.disputeForum && <div><strong style={{ color: "#EDE9E0" }}>Where disputes go: </strong>{c.disputeForum}</div>}
              </div>
            )}
          </div>

          {entry.kind && entry.kind !== "pdf" && (
            <div style={{ fontSize: 12.5, color: "#6E6A61", marginBottom: 16, lineHeight: 1.5 }}>
              References below use the contract's own section numbers. Page numbers aren't shown because {entry.kind === "docx" ? "Word documents" : "pasted text"} don't have fixed pages.
            </div>
          )}

          {entry.researchStatus === "running" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9A968C", fontSize: 13.5, marginBottom: 18 }}>
              <Loader2 size={15} className="spin" /> Researching how other artists experience these terms...
            </div>
          )}
          {entry.researchStatus === "failed" && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 18, background: "rgba(201,138,46,0.10)", border: "1px solid rgba(201,138,46,0.35)", borderRadius: 6, padding: "10px 12px", color: "#D9B060", fontSize: 13 }}>
              <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>The "what other artists say" research didn't run, so the breakdown below is based on the contract text alone. Run the analysis again to retry.</span>
            </div>
          )}

          {(c.clauses || []).slice()
            .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
            .map((clause, i) => (
              <ClauseCard key={i} clause={clause} research={(entry.research || {})[clause.category]} contractText={entry.text} />
            ))}
        </>
      )}
    </div>
  );
}

function ConflictsPanel({ conflicts }) {
  if (!conflicts) return null;
  const box = { background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 8, padding: "18px 20px", marginTop: 34 };
  return (
    <div style={box}>
      <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 21, color: "#EDE9E0", margin: "0 0 4px" }}>Conflicts between these documents</h2>
      <div style={{ fontSize: 13, color: "#9A968C", marginBottom: 12 }}>Terms in one document that clash with, or change the effect of, terms in another.</div>
      {conflicts.status === "running" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9A968C", fontSize: 13.5 }}>
          <Loader2 size={15} className="spin" /> Comparing the documents...
        </div>
      )}
      {conflicts.status === "failed" && (
        <div style={{ color: "#D9B060", fontSize: 13.5 }}>The comparison didn't complete. Run the analysis again to retry.</div>
      )}
      {conflicts.status === "ok" && conflicts.items.length === 0 && (
        <div style={{ color: "#9A968C", fontSize: 13.5 }}>No conflicts found between these documents.</div>
      )}
      {conflicts.status === "ok" && conflicts.items.map((cf, i) => {
        const color = HARM_COLOR[cf.harmLevel] || "#9A968C";
        return (
          <div key={i} style={{ borderLeft: `3px solid ${color}`, background: "#15171D", borderRadius: 6, padding: "12px 14px", marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <strong style={{ fontFamily: "'Inter', sans-serif", fontSize: 14.5, color: "#EDE9E0" }}>{cf.title}</strong>
              <Pill color={color}>Harm: {cf.harmLevel}</Pill>
            </div>
            <p style={{ fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.55, margin: "8px 0 6px" }}>{cf.explanation}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(cf.references || []).map((r, j) => (
                <span key={j} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#C9C5BB", background: "#12141A", border: "1px solid #2A2E37", borderRadius: 4, padding: "2px 7px", overflowWrap: "anywhere" }}>
                  {r.document}{(r.sections || []).length ? " · " + r.sections.map((x) => (/^\d/.test(String(x)) ? "§" + x : x)).join(", ") : ""}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------
export default function ContractClarity() {
  const [docs, setDocs] = useState([]); // [{id, name, kind, text}]
  const [pasted, setPasted] = useState("");
  const [stage, setStage] = useState("idle"); // idle | extracting | analyzing | done
  const [progress, setProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [results, setResults] = useState([]);
  const [conflicts, setConflicts] = useState(null);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const busy = stage === "extracting" || stage === "analyzing";

  async function extractPdf(file) {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      text += "\n===== PAGE " + p + " =====\n" + content.items.map((it) => it.str).join(" ") + "\n";
    }
    return text.trim();
  }

  async function extractDocx(file) {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return (result.value || "").trim();
  }

  const handleFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setErrorMsg("");
    const problems = [];
    const added = [];
    files.forEach((file) => {
      const name = file.name.toLowerCase();
      const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";
      const isDocx = name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (!isPdf && !isDocx) { problems.push(file.name + ": only PDF or Word (.docx) files work"); return; }
      added.push({ id: Date.now() + Math.random(), name: file.name, kind: isPdf ? "pdf" : "docx", file });
    });
    setDocs((d) => d.concat(added.filter((a) => !d.some((x) => x.name === a.name && x.file.size === a.file.size))));
    if (problems.length) setErrorMsg(problems.join(" · "));
  }, []);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (!busy) handleFiles(e.dataTransfer.files);
  }

  function removeDoc(id) {
    setDocs((d) => d.filter((x) => x.id !== id));
  }

  function clearAll() {
    setDocs([]); setPasted(""); setResults([]); setConflicts(null); setErrorMsg("");
  }

  async function callBackend(path, payload) {
    let res;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      return { error: "Couldn't reach the Contract Clarity server. Is it running (npm run dev)?" };
    }
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      return { error: "The server replied with something unreadable (status " + res.status + ")." };
    }
    if (!res.ok || data.error) return { error: data.error || "The server returned status " + res.status + "." };
    return { text: data.text };
  }

  function parseJson(raw) {
    if (!raw) throw new Error("empty");
    let cleaned = raw.replace(/```json|```/g, "").trim();
    const first = cleaned.search(/[{[]/);
    const last = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
    return JSON.parse(cleaned);
  }

  async function handleAnalyze() {
    const list = docs.map((d) => ({ name: d.name, kind: d.kind, file: d.file }));
    if (pasted.trim()) list.push({ name: "Pasted text", kind: "paste", text: pasted.trim() });
    if (!list.length) return;
    setErrorMsg(""); setResults([]); setConflicts(null); setStage("analyzing");

    const acc = [];
    const push = () => setResults(acc.map(({ file, ...x }) => ({ ...x })));
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const tag = list.length > 1 ? ` (${i + 1} of ${list.length})` : "";
      setProgress(`Reading ${d.name}${tag}...`);
      const entry = { ...d };
      acc.push(entry);
      if (d.file) {
        try {
          entry.text = d.kind === "pdf" ? await extractPdf(d.file) : await extractDocx(d.file);
        } catch (err) {
          console.error(err);
          entry.error = "This file couldn't be read. Try pasting its text instead.";
          push(); continue;
        }
        if (!entry.text || entry.text.replace(/=====\s*PAGE\s+\d+\s*=====/g, "").trim().length < 40) {
          entry.error = "No readable text in this file. If it's a scanned contract, paste the text instead.";
          push(); continue;
        }
      }
      const r = await callBackend("/api/analyze", { contractText: entry.text });
      if (r.error) { entry.error = r.error; push(); continue; }
      try { entry.classification = parseJson(r.text); }
      catch (e) { entry.error = "The analysis reply couldn't be read. Try again."; push(); continue; }
      entry.researchStatus = "running";
      push();

      setProgress(`Researching ${d.name}${tag}...`);
      const rr = await callBackend("/api/research", { classification: entry.classification });
      try {
        if (rr.error) throw new Error(rr.error);
        const parsed = parseJson(rr.text);
        entry.research = parsed;
        entry.researchStatus = "ok";
      } catch (e) {
        entry.research = {};
        entry.researchStatus = "failed";
      }
      push();
    }

    const good = acc.filter((e) => e.classification);
    if (good.length >= 2) {
      setProgress("Comparing the documents against each other...");
      setConflicts({ status: "running", items: [] });
      const cr = await callBackend("/api/conflicts", { documents: good.map((g) => ({ name: g.name, text: g.text, classification: g.classification })) });
      try {
        if (cr.error) throw new Error(cr.error);
        const parsed = parseJson(cr.text);
        setConflicts({ status: "ok", items: parsed.conflicts || [] });
      } catch (e) {
        setConflicts({ status: "failed", items: [] });
      }
    }
    setProgress("");
    setStage("done");
  }

  function buildAnalysisText() {
    const NEG = { low: "Rarely moves", medium: "Sometimes moves", high: "Often negotiable" };
    const lines = [];
    lines.push("CONTRACT CLARITY — ANALYSIS");
    lines.push("This is not legal advice. Please consult an attorney for the most accurate legal information.");
    lines.push("");
    if (conflicts && conflicts.status === "ok") {
      lines.push("========================================");
      lines.push("CONFLICTS BETWEEN THESE DOCUMENTS");
      lines.push("========================================");
      if (!conflicts.items.length) lines.push("None found.");
      conflicts.items.forEach((cf) => {
        lines.push("");
        lines.push(cf.title.toUpperCase() + "   |   Harm level: " + cf.harmLevel);
        lines.push(cf.explanation);
        const refs = (cf.references || []).map((r) => r.document + ((r.sections || []).length ? " " + r.sections.join(", ") : ""));
        if (refs.length) lines.push("Where: " + refs.join("; "));
      });
      lines.push("");
    }
    results.forEach((e) => {
      lines.push("========================================");
      lines.push("DOCUMENT: " + e.name);
      lines.push("========================================");
      if (e.error) { lines.push("Not analyzed: " + e.error); lines.push(""); return; }
      const c = e.classification;
      lines.push("Contract type: " + (c.contractType || "Not identified"));
      lines.push("Choice of law: " + (c.choiceOfLawState || "Not stated in contract"));
      if (c.disputeForum) lines.push("Where disputes go: " + c.disputeForum);
      lines.push("Counterparty: " + (c.operativeName || "Not clearly identified"));
      lines.push("");
      (c.clauses || []).slice()
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
        .forEach((cl) => {
          lines.push(((cl.category === "other" && cl.title) ? cl.title : (CATEGORY_LABEL[cl.category] || cl.category)).toUpperCase());
          const refs = (cl.sections || []).map((s) => (/^\d/.test(String(s)) ? "§" + s : s)).concat((cl.pages || []).map((p) => "p." + p));
          if (refs.length) lines.push("In the contract: " + refs.join(", "));
          lines.push("Harm level: " + cl.harmLevel + "   |   Negotiability: " + (NEG[cl.negotiability] || cl.negotiability));
          if (cl.harmLevel === "high") lines.push(">> Worth raising with an attorney.");
          lines.push("");
          lines.push(cl.plainEnglish || "");
          if (cl.statuteFlag) { lines.push(""); lines.push("Law check: " + cl.statuteFlag + " Have an attorney confirm."); }
          if (cl.harmDuration) { lines.push(""); lines.push("How long this follows you: " + cl.harmDuration); }
          if (cl.revenueImpact) { lines.push(""); lines.push("Where the money goes: " + cl.revenueImpact); }
          if (cl.worksInYourFavor) { lines.push(""); lines.push("Works in your favor: " + cl.worksInYourFavor); }
          const r = (e.research || {})[cl.category];
          if (r && ((r.general && r.general.length) || (r.operative && r.operative.length))) {
            lines.push("");
            lines.push("What other artists say:");
            (r.general || []).concat(r.operative || []).forEach((it) => lines.push("  - " + it.finding + "  [" + it.sourceTag + "]"));
          }
          lines.push("");
          lines.push("----------------------------------------");
          lines.push("");
        });
    });
    const state = (results.find((e) => e.classification && e.classification.choiceOfLawState) || {}).classification;
    lines.push("As a reminder, consult an attorney" + (state ? " licensed in " + state.choiceOfLawState.replace(/\s*\(.*\)$/, "") : "") + ".");
    return lines.join("\n");
  }

  async function handleCopy() {
    const text = buildAnalysisText();
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const text = buildAnalysisText();
    const base = results.length === 1 ? results[0].name.replace(/\.[^.]+$/, "") : "contracts";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = base + "-analysis.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const canAnalyze = (docs.length > 0 || pasted.trim()) && !busy;
  const totalDocs = docs.length + (pasted.trim() ? 1 : 0);
  const firstState = (results.find((e) => e.classification && e.classification.choiceOfLawState) || {}).classification;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.relatedTarget) setDragOver(false); }}
      onDrop={onDrop}
      style={{ minHeight: "100vh", background: "#14161B", padding: "32px 16px 64px", fontFamily: "'Inter', sans-serif" }}>
      <style>{FONT_IMPORT}</style>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Music2 size={22} color="#C9A227" />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.08em", color: "#8B93A6", textTransform: "uppercase" }}>Contract Clarity</span>
        </div>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: "clamp(28px, 5vw, 40px)", color: "#EDE9E0", margin: "0 0 10px", lineHeight: 1.15 }}>
          Know what you're signing.
        </h1>
        <p style={{ color: "#9A968C", fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: "0 0 6px" }}>
          Upload one contract, or several that go together. This breaks each one down in plain English, and checks related documents against each other.
        </p>
        <Disclaimer text="This is not legal advice. Please consult an attorney for the most accurate legal information." />

        <div style={{ marginTop: 28 }}>
          <div
            onClick={() => !busy && fileInputRef.current && fileInputRef.current.click()}
            style={{
              border: `1.5px dashed ${dragOver ? "#C9A227" : "#3A3D45"}`,
              background: dragOver ? "rgba(201,162,39,0.06)" : "#1B1E25",
              borderRadius: 8, padding: "22px 20px", textAlign: "center", cursor: busy ? "default" : "pointer",
              marginBottom: 14, transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <input
              ref={fileInputRef} type="file" multiple
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: "none" }}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
            />
            {stage === "extracting" ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#C9A227", fontSize: 14, fontWeight: 600 }}>
                <Loader2 size={16} className="spin" /> {progress || "Reading..."}
              </div>
            ) : (
              <>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#C9C5BB", fontSize: 14.5, fontWeight: 600 }}>
                  <Upload size={16} color="#C9A227" /> {dragOver ? "Drop to add" : docs.length ? "Add another contract" : "Drop contracts anywhere on this page, or click to choose"}
                </div>
                <div style={{ color: "#6E6A61", fontSize: 12.5, marginTop: 6 }}>PDF or Word (.docx) · one or several · nothing is read until you click Analyze</div>
              </>
            )}
          </div>

          {docs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {docs.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 7, padding: "9px 12px", color: "#EDE9E0", fontSize: 14 }}>
                  <FileText size={16} color="#C9A227" style={{ flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{d.name}</span>
                  <span style={{ color: "#5C8368", fontSize: 12.5, whiteSpace: "nowrap" }}>added</span>
                  <button onClick={() => removeDoc(d.id)} disabled={busy} title="Remove"
                    style={{ background: "none", border: "none", cursor: busy ? "default" : "pointer", color: "#8B93A6", display: "inline-flex", padding: 2 }}>
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            id="pasted-text"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="...or paste the full text of a contract here."
            style={{
              width: "100%", minHeight: docs.length ? 90 : 200, background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 8,
              color: "#EDE9E0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, lineHeight: 1.6, padding: 16,
              boxSizing: "border-box", resize: "vertical",
            }}
          />

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: canAnalyze ? "#C9A227" : "#3A3D45", color: canAnalyze ? "#14161B" : "#8B93A6",
                border: "none", borderRadius: 7, padding: "11px 20px", fontWeight: 600, fontSize: 14,
                cursor: canAnalyze ? "pointer" : "not-allowed",
              }}
            >
              {stage === "analyzing" ? (<><Loader2 size={16} className="spin" /> Working...</>)
                : (<><Upload size={16} /> {totalDocs > 1 ? "Analyze contracts" : "Analyze contract"}</>)}
            </button>
            {(docs.length > 0 || pasted || results.length > 0) && !busy && (
              <button onClick={clearAll} style={{ background: "none", border: "none", color: "#8B93A6", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                Start over
              </button>
            )}
            {stage === "analyzing" && progress && <span style={{ color: "#9A968C", fontSize: 13 }}>{progress}</span>}
          </div>
          <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>

          {errorMsg && (
            <div style={{ marginTop: 12, color: "#E08A75", fontSize: 13.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {results.length > 0 && (
          <div style={{ marginTop: 34 }}>
            {stage === "done" && (
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={handleCopy} style={{
                  flex: "1 1 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  background: copied ? "rgba(92,131,104,0.15)" : "#1B1E25", border: `1px solid ${copied ? "#5C8368" : "#2A2E37"}`,
                  borderRadius: 7, padding: "10px 13px", cursor: "pointer", fontWeight: 600, fontSize: 13, color: copied ? "#7FB08C" : "#C9C5BB",
                }}>
                  {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy analysis</>}
                </button>
                <button onClick={handleDownload} style={{
                  flex: "1 1 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 7, padding: "10px 13px",
                  cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#C9C5BB",
                }}>
                  <Download size={14} /> Download
                </button>
              </div>
            )}

            <ConflictsPanel conflicts={conflicts} />

            {results.map((e, i) => <DocResult key={i} entry={e} multi={results.length > 1} />)}

            {stage === "done" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 8, padding: "14px 18px", marginTop: 8, fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.5 }}>
                <Scale size={16} color="#C9A227" style={{ flexShrink: 0 }} />
                <span>As a reminder, consult an attorney{firstState ? ` licensed in ${firstState.choiceOfLawState.replace(/\s*\(.*\)$/, "")}` : ""}.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
