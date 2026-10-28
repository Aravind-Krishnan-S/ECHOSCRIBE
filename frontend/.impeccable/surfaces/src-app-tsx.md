---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/screens"]
---

# EchoScribe app (all screens)

Scope: the whole signed-in app plus auth. Mode: Operate. Audience now: IEEE panel watching a demo; intended users therapists and mentors, live in the room and right after the session. Jobs: record or upload, read a trustworthy note, follow a client over time, configure providers and models.

## Direction contract

THESIS: A Basel pharmaceutical graphic program applied to clinical notes: precise grotesk, strict 8px grid, coded colour fields that mean something. Refuses the category default of grey cards plus one accent and soft glass.

OWN-WORLD: White ground (#FBFBFA), ink #14161A, hairline greys. Each workspace is a product line: Therapy = deep teal field, Mentoring = ultramarine field; the left rail is a solid field of the active line's colour with white type. Verification codes: supported = green stripe, partial = amber stripe, unsupported = vermilion stripe, unverified = grey. Type: one grotesk (Inter Tight UI / Archivo for numbers? decided in build: "Geist" family) in a strict scale, tabular numerals. Square-ish corners (4px), no glass, no gradients, no drop shadows beyond 1px rules.

STORY: The visitor sees at once which workspace they are in (colour field), what needs attention (risk, unverified sentences), and that every sentence of a note is backed by numbered turns.

FIRST VIEWPORT: Left rail (240px) as a solid product-line colour field with wordmark, workspace switcher, nav, user. Main area: page title row with primary action (New session) top right; Home shows a KPI band of four coded figures, then recent sessions table with a verification stripe per row, then client list. Summary screen: note on the left (sections, each sentence with a 4px coded stripe and superscript turn numbers), transcript on the right with turn numbers in a gutter.

FORM: Swiss pharmaceutical packaging program (Geigy), position 7 of my grounded list. seed:4096a38f5af3e46a. Raises: action colour only on actionable elements (from warm consumer canon); client history as same-scale session strips (from botanical folio); processing pipeline drawn as one line with stations (from transit diagram); recording screen gives the session the whole viewport (from vertical feed).

SIGNATURE MOVE: the coded stripe. Every note sentence and every session row carries a pack-stripe in its verification colour; clicking a sentence's stripe lights its cited turns in the transcript gutter.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
