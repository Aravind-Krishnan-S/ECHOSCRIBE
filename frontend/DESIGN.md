---
name: EchoScribe
description: Evidence-linked, independently verified session notes for therapy and mentoring, set as a pharmaceutical graphic program.
colors:
  paper: "#ffffff"
  bench: "#f3f4f2"
  panel: "#f7f8f6"
  pressed: "#eceeeb"
  rule: "#dfe2de"
  rule-soft: "#eceeeb"
  control: "#b9bfb9"
  ink: "#121417"
  ink-muted: "#50565c"
  ink-faint: "#656b71"
  therapy-field: "#0b5d5a"
  therapy-deep: "#084744"
  therapy-tint: "#e2efee"
  therapy-tint-2: "#c6e0de"
  therapy-on-field-muted: "#c9e3e1"
  mentoring-field: "#2238a8"
  mentoring-deep: "#19297d"
  mentoring-tint: "#e6e9f8"
  mentoring-tint-2: "#ccd3f1"
  mentoring-on-field-muted: "#d0d7f5"
  code-supported: "#1d7a4b"
  code-partial: "#c1860a"
  code-unsupported: "#cc3d17"
  code-unverified: "#a3a9ae"
  code-edited: "#5b5f9a"
  negative: "#b8330f"
  warning: "#8a5a00"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.125
    letterSpacing: "-0.03em"
  section:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "-0.015em"
  figure:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "40px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "0em"
  note-sentence:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  label:
    fontFamily: "Archivo Variable, Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.33
    letterSpacing: "0em"
rounded:
  tag: "2px"
  control: "4px"
  container: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.therapy-field}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.therapy-deep}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "38px"
    padding: "0 12px"
  rail:
    backgroundColor: "{colors.therapy-field}"
    textColor: "{colors.paper}"
    width: "240px"
  nav-item-current:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.therapy-deep}"
    rounded: "{rounded.tag}"
    height: "36px"
  tag:
    backgroundColor: "{colors.pressed}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    height: "22px"
    typography: "{typography.label}"
---

# Design System: EchoScribe

## Overview

A pharmaceutical graphic program applied to clinical notes, after the 1960s Basel packaging programs: white paper, one precise grotesk on a strict grid, and colour that always codes something. Each workspace is a product line with its own field colour, and that field owns the navigation rail, the section letters of a note and the primary actions. Verification outcomes are a second, fixed code — green, amber, vermilion, grey — carried as a stripe on every sentence, session row and history strip, so a reader can audit a note at a glance before reading a word.

The surface is an operating tool: standard navigation, tables, forms and dialogs; the world contributes type, palette, density and one signature move (the coded stripe), never the layout. Calm is a requirement — the recording screen is a single quiet field with a clock — and trust is shown, not claimed.

## Colors

### Primary
- **Therapy field** `#0b5d5a` (deep teal) and **Mentoring field** `#2238a8` (ultramarine): set through `data-workspace` on the shell; `--accent` resolves to the active line. Fields carry white type; secondary text on a field uses the line's own tint (`on-field-muted`), never grey.

### Neutral
- **Paper** `#ffffff` for work surfaces, **bench** `#f3f4f2` behind sheets, **panel** `#f7f8f6` for printed sub-areas, **pressed** `#eceeeb` for selected and tag grounds.
- **Ink** `#121417`; **muted** `#50565c` (7.4:1 on paper) for secondary text; **faint** `#656b71` (5.4:1) for placeholders and hints.
- Rules: `#dfe2de` for 1px structure, `#eceeeb` for table row dividers; a 1–2px **ink** rule marks a section top or a table header.

### Named Rules
- **The Code Rule.** Verification colours (`code-*`) mean only verification. Risk uses the negative/warning pair. Never reuse a code colour for decoration or for actions.
- **The Action Rule.** The line colour on a filled control means "you can do this". Disabled controls lose the colour (opacity), never change hue.
- **The Line Rule.** Exactly one product line is active per screen; mixing teal and ultramarine on one screen happens only on the workspace picker.

## Typography

Archivo (variable, self-hosted via @fontsource) for everything, with tabular numerals for figures, times and counts. Hierarchy comes from size and weight steps with negative tracking on large sizes; there is no second face.

### Hierarchy
- **Display** 44/1.05 bold, −0.035em: greetings and workspace names.
- **Title** 32/1.125 bold, −0.03em: page titles (28px on phones).
- **Section** 18/1.33 bold: section headings, note section titles.
- **Figure** 40 bold tabular: overview figures, recording clock (64–88px).
- **Note sentence** 15/1.6: one sentence per line in notes.
- **Body** 14/1.43; **label** 12–13 semibold for field labels, table headers and tags.

## Layout

A 240px colour-field rail and a white work area with 40px side margins on desktop (16px on phones). Page titles sit large on the paper with actions right-aligned on the title baseline; a 1px ink rule appears under the header once the page scrolls. Content columns: 12-column grid; notes 7 columns with the evidence column (risk, who spoke, transcript) 5 columns and sticky. On phones the rail becomes a 52px field bar with a full-screen field menu; tables drop secondary columns rather than scroll.

## Elevation & Depth

Flat by default: depth is made with rules and fields, not shadows. Only floating layers (menus, dialogs, toasts, the tour bubble) lift, with one shadow that has offset and blur.

### Shadow Vocabulary
- **layer** `0 12px 32px -8px rgba(18,20,23,.22), 0 2px 6px rgba(18,20,23,.08)`: floating layers only.

## Shapes

Printed, not moulded: 2px on tags and selected nav items, 4px on controls and buttons, 6px on panels and sheets. Avatars are the only circles. Verification chips and stripes are square-ended.

## Components

### Buttons
Primary is the line colour with white text, 36px (44px large), 4px corners, pressed state as an inset shadow. Secondary is paper with a control outline that turns ink on hover. Ghost buttons are text-only with a pressed-grey hover.

### Chips (Tags)
Square 2px tags, 22px high, semibold 12px: neutral, positive, warning, negative and line-tint variants. Used for flags and counts, never as buttons.

### Cards / Containers
Panels are paper with a 1px rule and 20–24px padding — never nested. Many former cards are tables: sessions and clients are ruled tables with an ink header rule and hover rows.

### Inputs / Fields
38px, paper ground, control-grey outline, ink on hover, a 1px line-colour ring on focus; label above in 13px semibold, hint or error below.

### Navigation
The rail's items are 36px rows in on-field-muted type; the current item becomes a white plate with line-deep text. Settings use a paper sub-nav whose current item is a line-tint plate. Tabs are a rule with a 2px line-colour underline on the selected tab.

### The Coded Stripe (signature)
A 4px vertical bar at the start of a note sentence, session row or history strip, coloured by verification outcome. Hovering a sentence lights its cited turns in the transcript gutter (turn number on a line-colour plate); clicking pins them. The note header's verification band is the same code as proportional segments with a count legend.

## Do's and Don'ts

### Do:
- Do give every note sentence, session row and history strip its verification stripe.
- Do put numbers in tabular figures and let the figure carry the weight, with the label beneath.
- Do keep the recording screen to one field: clock, level, stop.
- Do theme browser surfaces (selection, caret, scrollbars, focus) from the palette.

### Don't:
- Don't use glass, blur or gradients; floating layers are solid paper with one shadow.
- Don't add a second typeface or a serif display voice.
- Don't use code colours for anything other than verification.
- Don't add eyebrow/kicker labels above headings.
- Don't nest panels or replace a table with a grid of identical cards.
