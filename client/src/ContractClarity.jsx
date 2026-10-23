import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Upload, Loader2, AlertTriangle, ShieldAlert, TrendingDown, Scale, Search, ChevronDown, ChevronUp, Music2, FileText, X, Copy, Check, Download, Square } from "lucide-react";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import { extractDocxMarkup, organizeMarkup, overlap, versionDate, diffVersions, buildResponseDocx, normalizeForMatch, stripPageMarkers } from "./markup.js";
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
          {clause.concession && <Pill color="#7FB08C">Concession you offered</Pill>}
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

      {clause.harmLevel === "high" && !clause.concession && (
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

      {clause.counterLanguage && (
        <div style={{
          background: "#12141A", border: "1px solid rgba(92,131,104,0.45)", borderRadius: 6, padding: "9px 12px", marginTop: 10,
          fontFamily: "'Inter', sans-serif", fontSize: 13, color: "#C9C5BB", lineHeight: 1.5,
        }}>
          <strong style={{ color: "#7FB08C" }}>Suggested language: </strong>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>{clause.counterLanguage}</span>
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


// Who the review is for. The server holds the matching prompt wording.
const ROLES = {
  artist: { label: "The artist" },
  counsel: { label: "The artist's attorney" },
  company: { label: "The agency or company" },
};

// Must match TEXT_LIMIT in server/prompts.js.
const TEXT_LIMIT = 100000;

// ---------------------------------------------------------------------------
// Shared bits of UI
// ---------------------------------------------------------------------------
const S = {
  panel: { background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 8, padding: "18px 20px", marginTop: 26 },
  h2: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 21, color: "#EDE9E0", margin: "0 0 4px", textWrap: "balance" },
  h3: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, color: "#EDE9E0", margin: "18px 0 8px" },
  sub: { fontSize: 13, color: "#9A968C", marginBottom: 12, lineHeight: 1.5 },
  item: { background: "#15171D", borderRadius: 6, padding: "12px 14px", marginBottom: 9 },
  body: { fontSize: 13.5, color: "#C9C5BB", lineHeight: 1.55 },
  small: { fontSize: 12.5, color: "#9A968C", lineHeight: 1.5 },
  quoteBox: { fontSize: 12.5, color: "#C9C5BB", background: "#12141A", border: "1px solid #2A2E37", borderRadius: 5, padding: "8px 10px", marginTop: 8, lineHeight: 1.5 },
  mono: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#C9C5BB", background: "#12141A", border: "1px solid #2A2E37", borderRadius: 4, padding: "2px 7px" },
  label: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#8B93A6", textTransform: "uppercase", letterSpacing: "0.06em" },
  btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 7, padding: "9px 13px", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#C9C5BB" },
};

function Chip({ color, children, title }) {
  return <span title={title} style={{ fontSize: 11.5, fontWeight: 600, color: color, border: `1px solid ${color}`, borderRadius: 4, padding: "1px 7px", whiteSpace: "nowrap" }}>{children}</span>;
}

function Where({ w }) {
  if (!w) return null;
  return <span style={S.mono}>{/^\d/.test(String(w)) ? "§" + w : w}</span>;
}

function Seg({ id, options, value, onChange, disabled }) {
  return (
    <div role="radiogroup" id={id} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <button key={v} role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(v)}
            style={{ background: on ? "rgba(201,162,39,0.16)" : "#15171D", border: `1px solid ${on ? "rgba(201,162,39,0.55)" : "#2A2E37"}`, color: on ? "#E5C35A" : "#C9C5BB",
              borderRadius: 6, padding: "6px 11px", fontSize: 13, fontWeight: 600, cursor: disabled ? "default" : "pointer" }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Suggested({ text, label }) {
  if (!text) return null;
  return (
    <div style={{ ...S.quoteBox, borderColor: "rgba(92,131,104,0.45)" }}>
      <strong style={{ color: "#7FB08C" }}>{label || "Suggested language"}: </strong>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>{text}</span>
    </div>
  );
}

const DIR_COLOR = { "better for the user": "#7FB08C", "worse for the user": "#E08A75", neutral: "#8B93A6" };

// ---------------------------------------------------------------------------
// Redline section of one document
// ---------------------------------------------------------------------------
function ChangeEntry({ r, org }) {
  const col = HARM_COLOR[r.harmLevel] || "#9A968C";
  const refs = r.refs || (r.ref ? [r.ref] : []);
  const authors = Array.from(new Set(refs.map((x) => ((org && org.changes.find((c) => c.ref === x)) || {}).author).filter(Boolean)));
  return (
    <div style={{ ...S.item, borderLeft: `3px solid ${col}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <Where w={r.where} />
          <strong style={{ fontSize: 14.5, color: "#EDE9E0" }}>{r.what}</strong>
        </div>
        <Pill color={col}>Harm: {r.harmLevel}</Pill>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
        {authors.map((a) => <Chip key={a} color="#8B93A6">{a}</Chip>)}
        {r.rejectedYourLanguage && <Chip color="#E08A75">Rejected your proposed language</Chip>}
        {r.askMoreThanEdit && <Chip color="#D9B060" title="Their comment asks for more than their edit actually does">Comment asks for more than the edit</Chip>}
        {r.sideConfirmed === false && <Chip color="#8B93A6">Side not confirmed</Chip>}
      </div>
      {r.before && r.before !== "nothing" && (
        <div style={{ ...S.body, fontSize: 13, marginTop: 8 }}><strong style={{ color: "#E08A75" }}>Was: </strong><span style={{ textDecoration: "line-through", color: "#9A968C" }}>{r.before}</span></div>
      )}
      {r.after && (
        <div style={{ ...S.body, fontSize: 13, marginTop: 3 }}><strong style={{ color: "#7FB08C" }}>Now: </strong>{r.after}</div>
      )}
      {r.textNow && <p style={{ ...S.body, margin: "8px 0 0" }}><strong style={{ color: "#EDE9E0" }}>What the text now says: </strong>{r.textNow}</p>}
      {r.theyWant && <p style={{ ...S.body, margin: "6px 0 0" }}><strong style={{ color: "#EDE9E0" }}>What they say they want: </strong>{r.theyWant}</p>}
      {r.gap && <p style={{ ...S.body, margin: "6px 0 0" }}><strong style={{ color: "#EDE9E0" }}>The gap: </strong>{r.gap}</p>}
      {r.effect && <p style={{ ...S.body, margin: "8px 0 0" }}>{r.effect}</p>}
      {r.theirReason
        ? <div style={S.quoteBox}><strong style={{ color: "#C9A227" }}>Their comment on this change: </strong>“{r.theirReason}”</div>
        : <div style={{ ...S.small, marginTop: 8 }}>No comment from them on this change.</div>}
      <Suggested text={r.counterLanguage} />
    </div>
  );
}

function RedlinePanel({ entry, onExport, exportState }) {
  const org = entry.org;
  const c = entry.classification || {};
  const [showPending, setShowPending] = useState(false);
  const review = (c.markupReview || []);
  const open = (c.openItems || []);
  const openByRef = {};
  open.forEach((o) => { openByRef[o.ref] = o; });
  return (
    <div style={{ background: "#1B1E25", border: "1px solid rgba(201,162,39,0.40)", borderRadius: 8, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={16} color="#C9A227" style={{ flexShrink: 0 }} />
          <h3 style={{ ...S.h3, margin: 0, fontSize: 18 }}>Redline: who changed what</h3>
        </div>
        {onExport && (
          <button onClick={onExport} disabled={exportState === "working"} style={{ ...S.btn, padding: "6px 10px", fontSize: 12.5 }}>
            <Download size={13} /> {exportState === "working" ? "Building…" : exportState === "done" ? "Word copy saved" : "Word copy with these notes as comments"}
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {Object.entries(org.byAuthor).map(([a, v]) => (
          <div key={a} style={S.small}>
            <strong style={{ color: "#EDE9E0" }}>{a}</strong>{" "}
            <span style={{ color: v.side === "mine" ? "#7FB08C" : v.side === "theirs" ? "#E08A75" : "#8B93A6" }}>({v.side === "mine" ? "your side" : v.side === "theirs" ? "other side" : "side not set"})</span>
            {": "}{v.ins} insertion{v.ins === 1 ? "" : "s"}, {v.del} deletion{v.del === 1 ? "" : "s"}, {v.newComments} new comment{v.newComments === 1 ? "" : "s"}{v.oldComments ? `, ${v.oldComments} from earlier rounds` : ""}
          </div>
        ))}
        <div style={{ ...S.small, color: "#6E6A61" }}>
          Counts are edits after joining the pieces Word splits them into. This round = items dated {org.cutoff ? `${org.cutoff} or later` : "(no dates in file)"}.
        </div>
      </div>
      {org.unknownAuthors.length > 0 && (
        <div style={{ ...S.quoteBox, borderColor: "rgba(201,138,46,0.45)", color: "#D9B060", marginBottom: 8 }}>
          You haven't said which side {org.unknownAuthors.join(" and ")} {org.unknownAuthors.length === 1 ? "is" : "are"} on, so their items are treated as the other side's. Set it in the list of people above and analyze again for an exact split.
        </div>
      )}

      <h3 style={S.h3}>Their changes this round</h3>
      {org.theirChanges.length === 0 && <div style={S.small}>They made no tracked edits this round. Their positions are in their comments below.</div>}
      {review.map((r, i) => <ChangeEntry key={i} r={r} org={org} />)}
      {org.theirChanges.length > 0 && !review.length && <div style={S.small}>The analysis did not return a breakdown of these changes. Open the file in Word with markup shown.</div>}

      <h3 style={S.h3}>Open items they raised without editing</h3>
      <div style={S.sub}>New comments from them with no edit of theirs beside them. These are often their real positions for the next round.</div>
      {org.openItems.length === 0 && <div style={S.small}>None.</div>}
      {org.openItems.map((cm) => {
        const o = openByRef[cm.ref] || {};
        return (
          <div key={cm.ref} style={{ ...S.item, borderLeft: "3px solid #C9A227" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Where w={cm.where} />
              <strong style={{ fontSize: 14, color: "#EDE9E0" }}>{o.theyAsk || "Comment from " + cm.author}</strong>
            </div>
            <div style={S.quoteBox}><strong style={{ color: "#C9A227" }}>{cm.author}{cm.date ? ", " + cm.date : ""}: </strong>“{cm.text}”</div>
            {o.matters && <p style={{ ...S.body, margin: "8px 0 0" }}>{o.matters}</p>}
            {o.suggestedResponse && <p style={{ ...S.body, margin: "6px 0 0" }}><strong style={{ color: "#EDE9E0" }}>A possible answer: </strong>{o.suggestedResponse}</p>}
            <Suggested text={o.counterLanguage} />
          </div>
        );
      })}

      {org.yourPending.length > 0 && (
        <>
          <h3 style={S.h3}>Your earlier changes still pending</h3>
          <div style={S.sub}>
            Your own tracked changes that haven't been accepted yet. {org.yourPending.filter((c) => c.rejectedBy).length ? `${org.yourPending.filter((c) => c.rejectedBy).length} of them were struck by the other side.` : ""}
            {" "}<button onClick={() => setShowPending(!showPending)} style={{ background: "none", border: "none", color: "#C9A227", cursor: "pointer", fontWeight: 600, fontSize: 12.5, padding: 0 }}>
              {showPending ? "Hide" : `Show all ${org.yourPending.length}`}
            </button>
          </div>
          {showPending && org.yourPending.map((ch) => (
            <div key={ch.ref} style={{ ...S.item, padding: "9px 12px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Where w={ch.where} />
                <span style={S.small}>{ch.type === "ins" ? "You proposed adding" : "You proposed deleting"}</span>
                {ch.rejectedBy && <Chip color="#E08A75">Struck by {ch.rejectedBy}</Chip>}
              </div>
              <div style={{ ...S.body, fontSize: 13, marginTop: 5, textDecoration: ch.type === "del" ? "line-through" : "none" }}>{ch.text.length > 400 ? ch.text.slice(0, 400) + "…" : ch.text}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results for one document
// ---------------------------------------------------------------------------
function DocResult({ entry, multi, onExport, exportState }) {
  const c = entry.classification;
  const tile = (label, value, Icon) => (
    <div style={{ flex: "1 1 200px", minWidth: 0, background: "#15171D", border: "1px solid #2A2E37", borderRadius: 7, padding: "12px 14px" }}>
      <div style={{ ...S.label, marginBottom: 5 }}>{label}</div>
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
          <h2 style={{ ...S.h2, fontSize: 22, margin: 0, overflowWrap: "anywhere" }}>{entry.name}</h2>
        </div>
      )}
      {entry.note && !c && <div style={{ ...S.small, marginBottom: 6 }}>{entry.note}</div>}
      {entry.error ? (
        <div style={{ color: "#E08A75", fontSize: 13.5, display: "flex", gap: 8, alignItems: "center" }}>
          <AlertTriangle size={15} /> {entry.error}
        </div>
      ) : !c ? null : (
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

          {(entry.warnings || []).map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "rgba(201,138,46,0.10)", border: "1px solid rgba(201,138,46,0.35)", borderRadius: 6, padding: "10px 12px", color: "#D9B060", fontSize: 13, marginBottom: 14 }}>
              <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} /><span>{w}</span>
            </div>
          ))}

          {entry.kind && entry.kind !== "pdf" && (
            <div style={{ fontSize: 12.5, color: "#6E6A61", marginBottom: 16, lineHeight: 1.5 }}>
              References below use the contract's own section numbers. Page numbers aren't shown because {entry.kind === "docx" ? "Word documents" : "pasted text"} don't have fixed pages.
            </div>
          )}

          {entry.org && <RedlinePanel entry={entry} onExport={onExport} exportState={exportState} />}

          {(entry.audit || []).length > 0 && (
            <div style={{ background: "rgba(179,64,47,0.10)", border: "1px solid rgba(179,64,47,0.40)", borderRadius: 7, padding: "12px 14px", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600, fontSize: 13, color: "#E08A75", marginBottom: 6 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0 }} /> Unverified figures in this analysis
              </div>
              {(entry.audit || []).map((w, i) => (
                <div key={i} style={{ fontSize: 13, color: "#C9C5BB", lineHeight: 1.5 }}>• {w}</div>
              ))}
              <div style={{ fontSize: 12, color: "#9A968C", marginTop: 6, lineHeight: 1.45 }}>
                These were checked against the document text by code. Confirm them in the contract before relying on them.
              </div>
            </div>
          )}

          {entry.researchStatus === "running" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9A968C", fontSize: 13.5, marginBottom: 18 }}>
              <Loader2 size={15} className="spin" /> Adding background on how other artists experience these terms...
            </div>
          )}
          {entry.researchStatus === "failed" && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 18, background: "rgba(201,138,46,0.10)", border: "1px solid rgba(201,138,46,0.35)", borderRadius: 6, padding: "10px 12px", color: "#D9B060", fontSize: 13 }}>
              <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>The background on other artists didn't load. The breakdown below is based on the contract text alone.</span>
            </div>
          )}

          <h3 style={{ ...S.h3, fontSize: 19, marginTop: 6 }}>Clause by clause{entry.org ? ", as the text now reads" : ""}</h3>
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

function NeededDocs({ items }) {
  if (!items.length) return null;
  return (
    <div style={{ ...S.panel, borderColor: "rgba(179,64,47,0.45)" }}>
      <h2 style={S.h2}>Documents you need before signing</h2>
      <div style={S.sub}>Referred to in the contract or in the comments, but not among the files you uploaded. Parts of the analysis can't be checked without them.</div>
      {items.map((d, i) => (
        <div key={i} style={{ ...S.item, borderLeft: "3px solid #B3402F" }}>
          <strong style={{ fontSize: 14, color: "#EDE9E0" }}>{d.name}</strong>
          {d.why && <div style={{ ...S.body, marginTop: 4 }}>{d.why}</div>}
          {d.source && <div style={{ ...S.small, marginTop: 4 }}>{d.source}</div>}
        </div>
      ))}
    </div>
  );
}

function ComparePanel({ comparisons }) {
  if (!comparisons || !comparisons.length) return null;
  return (
    <div style={S.panel}>
      <h2 style={S.h2}>What changed between drafts</h2>
      <div style={S.sub}>These files look like versions of one agreement, so they are compared draft to draft instead of checked against each other as separate documents. Differences are found by code; the reading of each is Claude's.</div>
      {comparisons.map((cp, k) => (
        <div key={k} style={{ marginTop: k ? 22 : 4 }}>
          <div style={{ ...S.label, marginBottom: 6, overflowWrap: "anywhere" }}>{cp.older} → {cp.newer}{cp.hunkCount != null ? ` · ${cp.hunkCount} wording difference${cp.hunkCount === 1 ? "" : "s"}` : ""}</div>
          {cp.status === "running" && <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9A968C", fontSize: 13.5 }}><Loader2 size={15} className="spin" /> Comparing the drafts...</div>}
          {cp.status === "failed" && <div style={{ color: "#D9B060", fontSize: 13.5 }}>The comparison didn't complete. {cp.error || "Run the analysis again to retry."}</div>}
          {cp.status === "stopped" && <div style={{ color: "#9A968C", fontSize: 13.5 }}>Stopped before this comparison ran.</div>}
          {cp.status === "ok" && (
            <>
              {cp.data.summary && <p style={{ ...S.body, fontSize: 14.5, margin: "0 0 10px" }}>{cp.data.summary}</p>}
              {(cp.data.stillOpen || []).length > 0 && (
                <div style={{ ...S.item, borderLeft: "3px solid #C9A227" }}>
                  <strong style={{ fontSize: 13.5, color: "#EDE9E0" }}>Still open</strong>
                  {(cp.data.stillOpen || []).map((s, i) => <div key={i} style={{ ...S.body, marginTop: 4 }}>• {s}</div>)}
                </div>
              )}
              {(cp.data.changes || []).map((ch, i) => {
                const col = HARM_COLOR[ch.harmLevel] || "#9A968C";
                return (
                  <div key={i} style={{ ...S.item, borderLeft: `3px solid ${col}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                        <Where w={ch.where} />
                        <strong style={{ fontSize: 14.5, color: "#EDE9E0" }}>{ch.what}</strong>
                      </div>
                      <Pill color={col}>Harm: {ch.harmLevel}</Pill>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                      {ch.movedBy && <Chip color="#8B93A6">Changed by {ch.movedBy === "user" ? "your side" : ch.movedBy}</Chip>}
                      {ch.direction && <Chip color={DIR_COLOR[ch.direction] || "#8B93A6"}>{ch.direction}</Chip>}
                      {ch.status && <Chip color="#C9A227">{ch.status}</Chip>}
                    </div>
                    {ch.before && <div style={{ ...S.body, fontSize: 13, marginTop: 8 }}><strong style={{ color: "#E08A75" }}>Before: </strong><span style={{ color: "#9A968C" }}>{ch.before}</span></div>}
                    {ch.after && <div style={{ ...S.body, fontSize: 13, marginTop: 3 }}><strong style={{ color: "#7FB08C" }}>After: </strong>{ch.after}</div>}
                    {ch.effect && <p style={{ ...S.body, margin: "8px 0 0" }}>{ch.effect}</p>}
                    <Suggested text={ch.counterLanguage} />
                  </div>
                );
              })}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ConflictsPanel({ conflicts }) {
  if (!conflicts) return null;
  return (
    <div style={S.panel}>
      <h2 style={S.h2}>Conflicts between these documents</h2>
      <div style={S.sub}>Terms in one document that clash with, or change the effect of, terms in another.</div>
      {conflicts.status === "running" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9A968C", fontSize: 13.5 }}>
          <Loader2 size={15} className="spin" /> Comparing the documents...
        </div>
      )}
      {conflicts.status === "failed" && <div style={{ color: "#D9B060", fontSize: 13.5 }}>The comparison didn't complete. Run the analysis again to retry.</div>}
      {conflicts.status === "stopped" && <div style={{ color: "#9A968C", fontSize: 13.5 }}>Stopped before this comparison ran.</div>}
      {conflicts.status === "ok" && conflicts.items.length === 0 && <div style={{ color: "#9A968C", fontSize: 13.5 }}>No conflicts found between these documents.</div>}
      {conflicts.status === "ok" && conflicts.items.map((cf, i) => {
        const color = HARM_COLOR[cf.harmLevel] || "#9A968C";
        return (
          <div key={i} style={{ ...S.item, borderLeft: `3px solid ${color}`, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <strong style={{ fontSize: 14.5, color: "#EDE9E0" }}>{cf.title}</strong>
              <Pill color={color}>Harm: {cf.harmLevel}</Pill>
            </div>
            <p style={{ ...S.body, margin: "8px 0 6px" }}>{cf.explanation}</p>
            {cf.revises && cf.revises.note && (
              <div style={{ ...S.quoteBox, background: "#1B1E25", margin: "0 0 8px" }}>
                <strong style={{ color: "#D9B060" }}>Changes the single-document reading{cf.revises.document ? ` of ${cf.revises.document}` : ""}{cf.revises.category ? ` (${cf.revises.category})` : ""}:</strong>{" "}{cf.revises.note}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(cf.references || []).map((r, j) => (
                <span key={j} style={{ ...S.mono, overflowWrap: "anywhere" }}>
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
  const [docs, setDocs] = useState([]); // [{id, name, kind, file, status, text, markup, vdate, whose}]
  const [pasted, setPasted] = useState("");
  const [role, setRole] = useState("artist");
  const [mode, setMode] = useState("auto"); // auto | versions | separate
  const [sides, setSides] = useState({}); // author -> mine | theirs
  const [background, setBackground] = useState(false);
  const [alsoEarlier, setAlsoEarlier] = useState(false);
  const [stage, setStage] = useState("idle"); // idle | analyzing | done
  const [progress, setProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [results, setResults] = useState([]);
  const [conflicts, setConflicts] = useState(null);
  const [comparisons, setComparisons] = useState([]);
  const [stoppedNote, setStoppedNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [exportState, setExportState] = useState({});
  const fileInputRef = useRef(null);
  const ctlRef = useRef(null);
  const stopRef = useRef(false);
  const skipRef = useRef(new Set());
  const currentIdRef = useRef(null);
  const busy = stage === "analyzing";

  async function extractPdf(file) {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      text += "\n===== PAGE " + p + " =====\n" + content.items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join(" ") + "\n";
    }
    return text.trim();
  }

  async function extractDocx(file) {
    const buf = await file.arrayBuffer();
    let markup = null;
    try { markup = await extractDocxMarkup(buf.slice(0)); } catch (e) { markup = null; }
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { text: (result.value || "").trim(), markup: markup };
  }

  // Files are read in the browser as soon as they are added, so the tool can
  // show who made the tracked changes and whether the files are drafts of one
  // agreement. Nothing is sent to Claude until Analyze is clicked.
  async function prepare(d) {
    const upd = (patch) => setDocs((all) => all.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
    try {
      let text, markup = null;
      if (d.kind === "pdf") text = await extractPdf(d.file);
      else { const got = await extractDocx(d.file); text = got.text; markup = got.markup && got.markup.hasMarkup ? got.markup : null; }
      if (!text || text.replace(/=====\s*PAGE\s+\d+\s*=====/g, "").trim().length < 40) {
        upd({ status: "error", error: "No readable text in this file. If it's a scanned contract, paste the text instead." });
        return;
      }
      upd({ status: "ready", text, markup, vdate: versionDate(d.name, text, d.file.lastModified) });
    } catch (err) {
      console.error(err);
      upd({ status: "error", error: "This file couldn't be read. Try pasting its text instead." });
    }
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
      added.push({ id: Date.now() + Math.random(), name: file.name, kind: isPdf ? "pdf" : "docx", file, status: "reading", whose: "unknown" });
    });
    setDocs((d) => {
      const fresh = added.filter((a) => !d.some((x) => x.name === a.name && x.file.size === a.file.size));
      fresh.forEach((a) => setTimeout(() => prepare(a), 0));
      return d.concat(fresh);
    });
    if (problems.length) setErrorMsg(problems.join(" · "));
  }, []);

  // Keep drafts in date order once every file has been read.
  const readyKey = docs.map((d) => d.id + ":" + d.status).sort().join("|");
  useEffect(() => {
    if (docs.length < 2 || docs.some((d) => d.status === "reading")) return;
    if (docs.every((d) => d.vdate)) {
      const sorted = docs.slice().sort((a, b) => a.vdate.localeCompare(b.vdate));
      if (sorted.some((d, i) => d.id !== docs[i].id)) setDocs(sorted);
    }
  }, [readyKey]);

  // Are these drafts of one agreement? Compare the wording of every pair.
  const relation = useMemo(() => {
    const ready = docs.filter((d) => d.status === "ready");
    if (ready.length < 2) return null;
    let best = 0;
    for (let i = 0; i < ready.length; i++) for (let j = i + 1; j < ready.length; j++) best = Math.max(best, overlap(ready[i].text, ready[j].text));
    return { overlap: best, versions: best >= 0.4 };
  }, [readyKey]);

  const countAll = docs.filter((d) => d.status !== "error").length + (pasted.trim() ? 1 : 0);
  const effMode = countAll < 2 ? "single" : mode === "auto" ? (relation && relation.versions ? "versions" : "separate") : mode;

  // Everyone who appears in tracked changes or comments, across all files.
  const people = {};
  docs.forEach((d) => {
    if (!d.markup) return;
    Object.entries(d.markup.authors).forEach(([a, v]) => {
      const p = people[a] || (people[a] = { changes: 0, comments: 0, files: 0 });
      p.changes += v.changes; p.comments += v.comments; p.files++;
    });
  });

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (!busy) handleFiles(e.dataTransfer.files);
  }

  function removeDoc(id) {
    if (busy) {
      // Skip it in the running analysis; abort the call if it is the one in progress.
      skipRef.current.add(id);
      if (currentIdRef.current === id && ctlRef.current) ctlRef.current.abort();
    }
    setDocs((d) => d.filter((x) => x.id !== id));
  }

  function moveDoc(id, dir) {
    setDocs((d) => {
      const i = d.findIndex((x) => x.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= d.length) return d;
      const n = d.slice(); const t = n[i]; n[i] = n[j]; n[j] = t; return n;
    });
  }

  function setWhose(id, v) { setDocs((d) => d.map((x) => (x.id === id ? { ...x, whose: v } : x))); }

  function cycleSide(a) {
    setSides((s) => {
      const nextV = !s[a] ? "mine" : s[a] === "mine" ? "theirs" : undefined;
      const n = { ...s };
      if (nextV) n[a] = nextV; else delete n[a];
      return n;
    });
  }

  function clearAll() {
    setDocs([]); setPasted(""); setResults([]); setConflicts(null); setComparisons([]); setErrorMsg(""); setStoppedNote(""); setSides({}); setExportState({});
  }

  function handleStop() {
    stopRef.current = true;
    if (ctlRef.current) ctlRef.current.abort();
    setProgress("Stopping...");
  }

  async function callBackend(path, payload) {
    const ctl = new AbortController();
    ctlRef.current = ctl;
    let res;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
    } catch (netErr) {
      if (netErr && netErr.name === "AbortError") return { cancelled: true };
      return { error: "Couldn't reach the Contract Clarity server. Is it running (npm run dev)?" };
    } finally {
      if (ctlRef.current === ctl) ctlRef.current = null;
    }
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      return { error: "The server replied with something unreadable (status " + res.status + ")." };
    }
    if (!res.ok || data.error) return { error: data.error || "The server returned status " + res.status + "." };
    return { text: data.text, audit: data.audit };
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
    const list = docs.filter((d) => d.status === "ready").map((d) => ({ id: d.id, name: d.name, kind: d.kind, text: d.text, markup: d.markup, vdate: d.vdate, whose: d.whose }));
    if (pasted.trim()) list.push({ id: "pasted", name: "Pasted text", kind: "paste", text: pasted.trim(), whose: "unknown", vdate: "" });
    if (!list.length) return;
    const runMode = list.length < 2 ? "single" : effMode;
    const opts = { role };
    stopRef.current = false; skipRef.current = new Set();
    setErrorMsg(""); setResults([]); setConflicts(null); setComparisons([]); setStoppedNote(""); setExportState({}); setStage("analyzing");

    const acc = list.map((d, i) => {
      const e = { ...d, org: organizeMarkup(d.markup, sides), warnings: [] };
      e.analyze = runMode !== "versions" || i === list.length - 1 || alsoEarlier;
      if (!e.analyze) e.note = "Earlier draft. It is compared with the next draft above instead of being analyzed on its own.";
      return e;
    });
    const push = () => setResults(acc.map((x) => ({ ...x })));
    push();
    const targets = acc.filter((e) => e.analyze);
    // In versions mode the latest draft is the one that matters most: do it first.
    if (runMode === "versions") targets.reverse();

    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) break;
      const entry = targets[i];
      if (skipRef.current.has(entry.id)) { entry.error = "Removed before analysis."; push(); continue; }
      currentIdRef.current = entry.id;
      const tag = targets.length > 1 ? ` (${i + 1} of ${targets.length})` : "";
      setProgress(`Analyzing ${entry.name}${tag}...`);
      if (entry.text.length > TEXT_LIMIT) entry.warnings.push(`This document is ${entry.text.length.toLocaleString()} characters long. Only the first ${TEXT_LIMIT.toLocaleString()} were analyzed, so terms after that point were not read.`);
      const r = await callBackend("/api/analyze", { contractText: entry.text, org: entry.org, opts: { ...opts, whose: entry.whose } });
      if (r.cancelled) { if (stopRef.current) break; entry.error = "Removed before analysis."; push(); continue; }
      if (r.error) { entry.error = r.error; push(); continue; }
      try { entry.classification = parseJson(r.text); }
      catch (e) { entry.error = "The analysis reply couldn't be read. Try again."; push(); continue; }
      entry.audit = Array.isArray(r.audit) ? r.audit : [];
      push();

      if (background && !stopRef.current) {
        entry.researchStatus = "running"; push();
        setProgress(`Adding background for ${entry.name}${tag}...`);
        const rr = await callBackend("/api/research", { classification: entry.classification });
        if (rr.cancelled) { entry.researchStatus = undefined; push(); if (stopRef.current) break; continue; }
        try {
          if (rr.error) throw new Error(rr.error);
          entry.research = parseJson(rr.text);
          entry.researchStatus = "ok";
        } catch (e) {
          entry.research = {};
          entry.researchStatus = "failed";
        }
        push();
      }
    }
    currentIdRef.current = null;

    if (runMode === "versions") {
      const pairs = [];
      for (let i = 0; i + 1 < acc.length; i++) pairs.push({ older: acc[i], newer: acc[i + 1] });
      const cps = pairs.map((p) => ({ older: p.older.name, newer: p.newer.name, status: stopRef.current ? "stopped" : "pending" }));
      setComparisons(cps.slice());
      // Newest pair first: it is the round being negotiated now.
      for (let k = pairs.length - 1; k >= 0; k--) {
        if (stopRef.current) { cps[k].status = "stopped"; continue; }
        const { older, newer } = pairs[k];
        if (skipRef.current.has(older.id) || skipRef.current.has(newer.id)) { cps[k].status = "stopped"; continue; }
        setProgress(`Comparing ${older.name} with ${newer.name}...`);
        const hunks = diffVersions(older.text, newer.text);
        cps[k].hunkCount = hunks.length;
        cps[k].status = "running"; setComparisons(cps.slice());
        if (!hunks.length) { cps[k].status = "ok"; cps[k].data = { summary: "No wording differences were found between these two drafts.", changes: [], stillOpen: [] }; setComparisons(cps.slice()); continue; }
        const strip = (d) => ({ name: d.name, vdate: d.vdate, whose: d.whose });
        const cr = await callBackend("/api/compare", { older: strip(older), newer: strip(newer), hunks, opts });
        if (cr.cancelled) { cps[k].status = "stopped"; setComparisons(cps.slice()); continue; }
        try {
          if (cr.error) throw new Error(cr.error);
          cps[k].data = parseJson(cr.text); cps[k].status = "ok";
        } catch (e) { cps[k].status = "failed"; cps[k].error = cr.error || ""; }
        setComparisons(cps.slice());
      }
      cps.forEach((c) => { if (c.status === "pending") c.status = "stopped"; });
      setComparisons(cps.slice());
    } else {
      const good = acc.filter((e) => e.classification);
      if (good.length >= 2) {
        if (stopRef.current) setConflicts({ status: "stopped", items: [] });
        else {
          setProgress("Checking the documents against each other...");
          setConflicts({ status: "running", items: [] });
          const documents = good.map((e) => ({ name: e.name, text: e.text, org: e.org, classification: e.classification }));
          const cr = await callBackend("/api/conflicts", { documents, opts });
          if (cr.cancelled) setConflicts({ status: "stopped", items: [] });
          else {
            try {
              if (cr.error) throw new Error(cr.error);
              const parsed = parseJson(cr.text);
              setConflicts({ status: "ok", items: parsed.conflicts || [] });
            } catch (e) {
              setConflicts({ status: "failed", items: [] });
            }
          }
        }
      }
    }

    if (stopRef.current) {
      acc.forEach((e) => { if (e.analyze && !e.classification && !e.error) e.error = "Stopped before analysis."; if (e.researchStatus === "running") e.researchStatus = undefined; });
      setStoppedNote("Stopped. Anything finished before you stopped is kept below.");
      push();
    }
    setProgress("");
    setStage("done");
  }

  // Documents the contract or comments refer to that were not uploaded.
  function neededDocs() {
    const out = [];
    const names = docs.map((d) => d.name.toLowerCase());
    results.forEach((e) => {
      ((e.classification && e.classification.neededDocuments) || []).forEach((d) => {
        if (d && d.name) out.push({ name: d.name, why: d.why, source: results.length > 1 ? "From " + e.name : "" });
      });
    });
    const seen = new Set();
    return out.filter((d) => {
      const k = d.name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
      if (seen.has(k) || names.some((n) => n.replace(/[^a-z0-9]/g, "").includes(k))) return false;
      seen.add(k); return true;
    });
  }

  async function handleExport(entry) {
    const d = docs.find((x) => x.id === entry.id);
    if (!d || !d.file) return;
    const c = entry.classification || {};
    const notes = [];
    const piOfRef = (ref) => {
      const ch = entry.org.changes.find((x) => x.ref === ref);
      if (ch) return ch.pi;
      const cm = entry.org.comments.find((x) => x.ref === ref);
      return cm ? cm.startP : -1;
    };
    (c.markupReview || []).forEach((r) => {
      const pi = piOfRef((r.refs || [])[0]);
      if (pi < 0) return;
      notes.push({ pi, text: [
        (r.what || "Change") + " (harm to you: " + (r.harmLevel || "?") + ")",
        r.effect, r.gap,
        r.counterLanguage ? "Suggested language: " + r.counterLanguage : "",
      ].filter(Boolean).join("\n") });
    });
    (c.openItems || []).forEach((o) => {
      const pi = piOfRef(o.ref);
      if (pi < 0) return;
      notes.push({ pi, text: ["Re their comment: " + (o.theyAsk || ""), o.suggestedResponse ? "Possible answer: " + o.suggestedResponse : "", o.counterLanguage ? "Suggested language: " + o.counterLanguage : ""].filter(Boolean).join("\n") });
    });
    if (!notes.length) return;
    setExportState((s) => ({ ...s, [entry.id]: "working" }));
    try {
      const { blob } = await buildResponseDocx(await d.file.arrayBuffer(), notes, "Contract Clarity");
      saveBlob(blob, d.name.replace(/\.docx$/i, "") + " - Contract Clarity notes.docx");
      setExportState((s) => ({ ...s, [entry.id]: "done" }));
    } catch (e) {
      console.error(e);
      setExportState((s) => ({ ...s, [entry.id]: undefined }));
      setErrorMsg("The Word copy couldn't be built. Use Copy analysis instead.");
    }
  }

  function buildAnalysisText() {
    const NEG = { low: "Rarely moves", medium: "Sometimes moves", high: "Often negotiable" };
    const lines = [];
    lines.push("CONTRACT CLARITY — ANALYSIS");
    lines.push("Prepared for: " + ROLES[role].label);
    lines.push("This is not legal advice. Please consult an attorney for the most accurate legal information.");
    if (stoppedNote) lines.push("NOTE: the analysis was stopped before it finished.");
    lines.push("");
    const need = neededDocs();
    if (need.length) {
      lines.push("========================================");
      lines.push("DOCUMENTS YOU NEED BEFORE SIGNING");
      lines.push("========================================");
      need.forEach((d) => lines.push("- " + d.name + (d.why ? ": " + d.why : "")));
      lines.push("");
    }
    comparisons.forEach((cp) => {
      lines.push("========================================");
      lines.push("WHAT CHANGED: " + cp.older + " -> " + cp.newer);
      lines.push("========================================");
      if (cp.status !== "ok") { lines.push("(not completed)"); lines.push(""); return; }
      if (cp.data.summary) lines.push(cp.data.summary);
      if ((cp.data.stillOpen || []).length) { lines.push(""); lines.push("Still open:"); cp.data.stillOpen.forEach((s) => lines.push("  - " + s)); }
      (cp.data.changes || []).forEach((ch) => {
        lines.push("");
        lines.push((ch.where ? "§" + ch.where + "  " : "") + (ch.what || "").toUpperCase() + "   |   Harm: " + ch.harmLevel + "   |   " + [ch.movedBy && "changed by " + ch.movedBy, ch.direction, ch.status].filter(Boolean).join(", "));
        if (ch.before) lines.push("  Before: " + ch.before);
        if (ch.after) lines.push("  After: " + ch.after);
        if (ch.effect) lines.push("  " + ch.effect);
        if (ch.counterLanguage) lines.push("  Suggested language: " + ch.counterLanguage);
      });
      lines.push("");
    });
    if (conflicts && conflicts.status === "ok") {
      lines.push("========================================");
      lines.push("CONFLICTS BETWEEN THESE DOCUMENTS");
      lines.push("========================================");
      if (!conflicts.items.length) lines.push("None found.");
      conflicts.items.forEach((cf) => {
        lines.push("");
        lines.push(cf.title.toUpperCase() + "   |   Harm level: " + cf.harmLevel);
        lines.push(cf.explanation);
        if (cf.revises && cf.revises.note) {
          lines.push("Changes the single-document reading" + (cf.revises.document ? " of " + cf.revises.document : "") + (cf.revises.category ? " (" + cf.revises.category + ")" : "") + ": " + cf.revises.note);
        }
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
      if (!e.classification) { lines.push(e.note || "Not analyzed on its own."); lines.push(""); return; }
      const c = e.classification;
      lines.push("Contract type: " + (c.contractType || "Not identified"));
      lines.push("Choice of law: " + (c.choiceOfLawState || "Not stated in contract"));
      if (c.disputeForum) lines.push("Where disputes go: " + c.disputeForum);
      lines.push("Counterparty: " + (c.operativeName || "Not clearly identified"));
      (e.warnings || []).forEach((w) => lines.push("!! " + w));
      if (e.org) {
        const o = e.org;
        lines.push("");
        lines.push("REDLINE: WHO CHANGED WHAT (this round = items dated " + (o.cutoff || "?") + " or later)");
        Object.entries(o.byAuthor).forEach(([a, v]) => lines.push("  " + a + " (" + (v.side === "mine" ? "your side" : v.side === "theirs" ? "other side" : "side not set") + "): " + v.ins + " insertions, " + v.del + " deletions, " + v.newComments + " new comments" + (v.oldComments ? ", " + v.oldComments + " earlier" : "")));
        lines.push("");
        lines.push("THEIR CHANGES THIS ROUND");
        if (!o.theirChanges.length) lines.push("  None. Their positions are in their comments.");
        (c.markupReview || []).forEach((r) => {
          lines.push("");
          lines.push("  " + (r.where ? "§" + r.where + "  " : "") + (r.what || "").toUpperCase() + "   |   Harm level: " + r.harmLevel
            + (r.rejectedYourLanguage ? "   |   REJECTED YOUR PROPOSED LANGUAGE" : "") + (r.askMoreThanEdit ? "   |   COMMENT ASKS FOR MORE THAN THE EDIT" : ""));
          if (r.before && r.before !== "nothing") lines.push("  Was: " + r.before);
          if (r.after) lines.push("  Now: " + r.after);
          if (r.textNow) lines.push("  What the text now says: " + r.textNow);
          if (r.theyWant) lines.push("  What they say they want: " + r.theyWant);
          if (r.gap) lines.push("  The gap: " + r.gap);
          if (r.effect) lines.push("  " + r.effect);
          lines.push("  " + (r.theirReason ? "Their comment on this change: \"" + r.theirReason + "\"" : "No comment from them on this change."));
          if (r.counterLanguage) lines.push("  Suggested language: " + r.counterLanguage);
        });
        lines.push("");
        lines.push("OPEN ITEMS THEY RAISED WITHOUT EDITING");
        if (!o.openItems.length) lines.push("  None.");
        const byRef = {}; (c.openItems || []).forEach((x) => { byRef[x.ref] = x; });
        o.openItems.forEach((cm) => {
          const x = byRef[cm.ref] || {};
          lines.push("");
          lines.push("  §" + cm.where + "  " + cm.author + (cm.date ? ", " + cm.date : "") + ": \"" + cm.text + "\"");
          if (x.theyAsk) lines.push("  They ask: " + x.theyAsk);
          if (x.matters) lines.push("  Why it matters: " + x.matters);
          if (x.suggestedResponse) lines.push("  A possible answer: " + x.suggestedResponse);
          if (x.counterLanguage) lines.push("  Suggested language: " + x.counterLanguage);
        });
        if (o.yourPending.length) {
          lines.push("");
          lines.push("YOUR EARLIER CHANGES STILL PENDING (" + o.yourPending.length + ")");
          o.yourPending.forEach((ch) => lines.push("  §" + ch.where + "  " + (ch.type === "ins" ? "added: " : "deleted: ") + ch.text.slice(0, 300) + (ch.rejectedBy ? "   [struck by " + ch.rejectedBy + "]" : "")));
        }
      }
      if ((e.audit || []).length) {
        lines.push("");
        lines.push("!! UNVERIFIED FIGURES — checked against the document text by code:");
        (e.audit || []).forEach((w) => lines.push("   - " + w));
      }
      lines.push("");
      lines.push("CLAUSE BY CLAUSE");
      lines.push("");
      (c.clauses || []).slice()
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
        .forEach((cl) => {
          lines.push(((cl.category === "other" && cl.title) ? cl.title : (CATEGORY_LABEL[cl.category] || cl.category)).toUpperCase());
          const refs = (cl.sections || []).map((s) => (/^\d/.test(String(s)) ? "§" + s : s)).concat((cl.pages || []).map((p) => "p." + p));
          if (refs.length) lines.push("In the contract: " + refs.join(", "));
          lines.push("Harm level: " + cl.harmLevel + "   |   Negotiability: " + (NEG[cl.negotiability] || cl.negotiability) + (cl.concession ? "   |   Concession you offered" : ""));
          if (cl.harmLevel === "high" && !cl.concession) lines.push(">> Worth raising with an attorney.");
          lines.push("");
          lines.push(cl.plainEnglish || "");
          if (cl.statuteFlag) { lines.push(""); lines.push("Law check: " + cl.statuteFlag + " Have an attorney confirm."); }
          if (cl.harmDuration) { lines.push(""); lines.push("How long this follows you: " + cl.harmDuration); }
          if (cl.revenueImpact) { lines.push(""); lines.push("Where the money goes: " + cl.revenueImpact); }
          if (cl.worksInYourFavor) { lines.push(""); lines.push("Works in your favor: " + cl.worksInYourFavor); }
          if (cl.counterLanguage) { lines.push(""); lines.push("Suggested language: " + cl.counterLanguage); }
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

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDownload() {
    const text = buildAnalysisText();
    const base = results.length === 1 ? results[0].name.replace(/\.[^.]+$/, "") : "contracts";
    saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), base + "-analysis.txt");
  }

  const stillReading = docs.some((d) => d.status === "reading");
  const canAnalyze = (docs.some((d) => d.status === "ready") || pasted.trim()) && !busy && !stillReading;
  const totalDocs = docs.filter((d) => d.status === "ready").length + (pasted.trim() ? 1 : 0);
  const firstState = (results.find((e) => e.classification && e.classification.choiceOfLawState) || {}).classification;
  const need = stage === "done" ? neededDocs() : [];
  const nReady = docs.length;

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
          Upload one contract, several that go together, or successive drafts of one agreement. Redlines are split by who made each change and when.
        </p>
        <Disclaimer text="This is not legal advice. Please consult an attorney for the most accurate legal information." />

        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={S.label}>Who is this for?</div>
          <Seg id="role" value={role} onChange={setRole} disabled={busy}
            options={[["artist", ROLES.artist.label], ["counsel", ROLES.counsel.label], ["company", ROLES.company.label]]} />
          {role === "counsel" && <div style={S.small}>Adds suggested counter-language to each change, open comment and clause.</div>}
        </div>

        <div style={{ marginTop: 20 }}>
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
              ref={fileInputRef} type="file" multiple id="file-input"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display: "none" }}
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
            />
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#C9C5BB", fontSize: 14.5, fontWeight: 600 }}>
              <Upload size={16} color="#C9A227" /> {dragOver ? "Drop to add" : docs.length ? "Add another file" : "Drop contracts anywhere on this page, or click to choose"}
            </div>
            <div style={{ color: "#6E6A61", fontSize: 12.5, marginTop: 6 }}>PDF or Word (.docx) · files are read in your browser · nothing goes to Claude until you click Analyze</div>
          </div>

          {docs.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <div style={S.label}>These files are</div>
              <Seg id="mode" value={mode} onChange={setMode} disabled={busy}
                options={[["auto", "Detect automatically"], ["versions", "Drafts of one agreement"], ["separate", "Separate documents signed together"]]} />
              {mode === "auto" && relation && (
                <div style={S.small}>
                  {relation.versions
                    ? `These look like drafts of the same agreement (${Math.round(relation.overlap * 100)}% shared wording). They'll be compared draft to draft, oldest first as listed below.`
                    : `These look like separate documents (${Math.round(relation.overlap * 100)}% shared wording). They'll be checked against each other for conflicts.`}
                </div>
              )}
              {effMode === "versions" && (
                <label style={{ ...S.small, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                  <input id="also-earlier" type="checkbox" checked={alsoEarlier} onChange={(e) => setAlsoEarlier(e.target.checked)} disabled={busy} />
                  Also analyze each earlier draft clause by clause (slower; the latest draft is always analyzed)
                </label>
              )}
            </div>
          )}

          {docs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {docs.map((d, i) => (
                <div key={d.id} style={{ background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 7, padding: "9px 12px", color: "#EDE9E0", fontSize: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <FileText size={16} color="#C9A227" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                      {effMode === "versions" && <span style={{ ...S.label, marginRight: 8, color: "#C9A227" }}>Draft {i + 1}{i === nReady - 1 ? " · latest" : ""}</span>}
                      {d.name}
                    </span>
                    {effMode === "versions" && !busy && (
                      <span style={{ display: "inline-flex", gap: 2 }}>
                        <button onClick={() => moveDoc(d.id, -1)} disabled={i === 0} title="Earlier" aria-label="Move earlier" style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#3A3D45" : "#8B93A6", padding: 2, display: "inline-flex" }}><ChevronUp size={15} /></button>
                        <button onClick={() => moveDoc(d.id, 1)} disabled={i === docs.length - 1} title="Later" aria-label="Move later" style={{ background: "none", border: "none", cursor: i === docs.length - 1 ? "default" : "pointer", color: i === docs.length - 1 ? "#3A3D45" : "#8B93A6", padding: 2, display: "inline-flex" }}><ChevronDown size={15} /></button>
                      </span>
                    )}
                    <button onClick={() => removeDoc(d.id)} title={busy ? "Remove and skip this file" : "Remove"} aria-label="Remove"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#8B93A6", display: "inline-flex", padding: 2 }}>
                      <X size={15} />
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 6, paddingLeft: 26 }}>
                    {d.status === "reading" && <span style={{ ...S.small, display: "inline-flex", gap: 6, alignItems: "center" }}><Loader2 size={12} className="spin" /> Reading…</span>}
                    {d.status === "error" && <span style={{ fontSize: 12.5, color: "#E08A75" }}>{d.error}</span>}
                    {d.status === "ready" && (
                      <>
                        <span style={{ fontSize: 12.5, color: "#5C8368" }}>Ready{d.vdate ? " · dated " + d.vdate : ""}{d.markup ? ` · ${d.markup.changes.length} tracked edits, ${d.markup.comments.length} comments` : ""}</span>
                        <label style={{ ...S.small, display: "inline-flex", gap: 6, alignItems: "center" }}>
                          Whose draft?
                          <select id={"whose-" + i} value={d.whose} disabled={busy} onChange={(e) => setWhose(d.id, e.target.value)}
                            style={{ background: "#15171D", color: "#C9C5BB", border: "1px solid #2A2E37", borderRadius: 5, padding: "2px 6px", fontSize: 12.5 }}>
                            <option value="unknown">Not sure</option>
                            <option value="mine">Ours</option>
                            <option value="theirs">The other side's</option>
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {Object.keys(people).length > 0 && (
            <div style={{ background: "#1B1E25", border: "1px solid #2A2E37", borderRadius: 7, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ ...S.label, marginBottom: 4 }}>People in the tracked changes and comments</div>
              <div style={{ ...S.small, marginBottom: 10 }}>Tap each name to say which side they're on. That keeps your own earlier changes from being read as the other side's.</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(people).map(([a, p]) => {
                  const sd = sides[a];
                  const col = sd === "mine" ? "#7FB08C" : sd === "theirs" ? "#E08A75" : "#8B93A6";
                  return (
                    <button key={a} onClick={() => cycleSide(a)} disabled={busy}
                      style={{ background: "#15171D", border: `1px solid ${col}`, color: "#EDE9E0", borderRadius: 6, padding: "6px 10px", cursor: busy ? "default" : "pointer", fontSize: 13, textAlign: "left" }}>
                      <strong>{a}</strong> <span style={{ color: col, fontWeight: 600 }}>· {sd === "mine" ? "Your side" : sd === "theirs" ? "Other side" : "Side not set"}</span>
                      <div style={{ fontSize: 11.5, color: "#8B93A6", marginTop: 2 }}>{p.changes} edits · {p.comments} comments</div>
                    </button>
                  );
                })}
              </div>
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

          <label style={{ ...S.small, display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, cursor: "pointer" }}>
            <input id="background" type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
            <span>Search the web for how other artists describe terms like these. One extra call per document, with web searches billed per search; findings are not verified.</span>
          </label>

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
              {busy ? (<><Loader2 size={16} className="spin" /> Working...</>)
                : stillReading ? (<><Loader2 size={16} className="spin" /> Reading files...</>)
                : (<><Upload size={16} /> {totalDocs > 1 ? (effMode === "versions" ? "Compare drafts" : "Analyze contracts") : "Analyze contract"}</>)}
            </button>
            {busy && (
              <button onClick={handleStop} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(179,64,47,0.14)", border: "1px solid rgba(179,64,47,0.55)", color: "#E08A75", borderRadius: 7, padding: "10px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
                <Square size={13} /> Stop
              </button>
            )}
            {(docs.length > 0 || pasted || results.length > 0) && !busy && (
              <button onClick={clearAll} style={{ background: "none", border: "none", color: "#8B93A6", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                Start over
              </button>
            )}
            {busy && progress && <span style={{ color: "#9A968C", fontSize: 13 }}>{progress}</span>}
          </div>
          {busy && <div style={{ ...S.small, marginTop: 8 }}>Uploaded the wrong file? Remove it with its × to skip it, or press Stop to end the run and keep what's finished.</div>}
          <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>

          {errorMsg && (
            <div style={{ marginTop: 12, color: "#E08A75", fontSize: 13.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {results.length > 0 && (
          <div style={{ marginTop: 34 }}>
            {stoppedNote && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", background: "rgba(201,138,46,0.10)", border: "1px solid rgba(201,138,46,0.35)", borderRadius: 6, padding: "10px 12px", color: "#D9B060", fontSize: 13.5, marginBottom: 14 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0 }} /> {stoppedNote}
              </div>
            )}
            {stage === "done" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={handleCopy} style={{ ...S.btn, flex: "1 1 160px", background: copied ? "rgba(92,131,104,0.15)" : "#1B1E25", borderColor: copied ? "#5C8368" : "#2A2E37", color: copied ? "#7FB08C" : "#C9C5BB" }}>
                  {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy analysis</>}
                </button>
                <button onClick={handleDownload} style={{ ...S.btn, flex: "1 1 160px" }}>
                  <Download size={14} /> Download
                </button>
              </div>
            )}

            <NeededDocs items={need} />
            <ComparePanel comparisons={comparisons} />
            <ConflictsPanel conflicts={conflicts} />

            {(comparisons.length ? results.slice().reverse() : results).map((e) => (
              <DocResult key={e.id} entry={e} multi={results.length > 1}
                onExport={e.kind === "docx" && e.org && e.classification && stage === "done" ? () => handleExport(e) : null}
                exportState={exportState[e.id]} />
            ))}

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
