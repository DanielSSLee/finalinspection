---
name: FVI Inspection Station
description: High-precision matte carbon industrial design system for photovoltaic solar module final visual inspection
colors:
  primary: "#0369a1"
  primary-hover: "#075985"
  canvas: "#090b0e"
  header: "#11141a"
  dock: "#11141a"
  block: "#151820"
  input: "#0a0c10"
  border-subtle: "#1c222c"
  border-medium: "#272f3e"
  text-bright: "#f8fafc"
  text-main: "#e2e8f0"
  text-muted: "#94a3b8"
  text-dim: "#94a3b8"
  accent-cyan: "#38bdf8"
  code-cyan: "#93c5fd"
  grade-a: "#10b981"
  grade-a-border: "#059669"
  grade-a-text: "#34d399"
  grade-b: "#f59e0b"
  grade-b-border: "#d97706"
  grade-b-text: "#fbbf24"
  grade-r: "#f97316"
  grade-r-border: "#ea580c"
  grade-r-text: "#fb923c"
  grade-x: "#ef4444"
  grade-x-border: "#dc2626"
  grade-x-text: "#f87171"
  severity-c: "#f97316"
  severity-c-text: "#fb923c"
  stage-black: "#000000"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Barlow, -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.04em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-bright}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "{colors.block}"
    textColor: "{colors.text-main}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  grade-toggle:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.xs}"
    padding: "4px 10px"
---

# Design System: FVI Inspection Station

## Overview

**Creative North Star: "The Cleanroom Instrument"**

This workstation operates as a high-precision manufacturing instrument for cleanroom and testing bay environments. It prioritizes zero-latency optical evaluation of solar modules under electroluminescence (EL) cameras. Ambient backgrounds recede into deep matte carbon (`#090b0e`, `#11141a`, `#151820`) to eliminate visual glare, directing 100% of the inspector's optical acuity toward subtle silicon micro-cracks and luminescence variations.

Information architecture maintains rigorous tactile hierarchy: operator credentials and barcode scanning live in the slim 48px upper console rail, classification grades sit prominently centered as discrete physical-style toggles, and the inspection viewport commands 80%+ of the active horizontal field with zero floating modals.

**Key Characteristics:**
- **Matte Carbon Canvas**: High-density low-reflectance surfaces prevent operator eye fatigue during 8-hour shift rotations.
- **Engineered Typography**: Barlow Semi Condensed and Barlow provide authentic industrial instrument character, free of AI template tropes. JetBrains Mono powers high-precision coordinates and telemetry.
- **Micro-Matrix Precision**: Mathematical alignment between data tables, axis headers, and 24x6 cell coordinate overlays (97.49% height calibration).
- **Docked Cell Inspector**: Inline, non-blocking classification directly in the sidebar dock with single-key shortcuts (`1`–`8`).
- **Tonal Status Signaling**: Immediate color-blind safe classification states (Emerald Pass, Amber Secondary, Crimson Reject).

## Colors

The palette delivers strict industrial utility: deep carbon for surface depth, precision cyan for active telemetry, and unambiguous ISO/IEC grade status accents.

### Primary
- **Instrument Blue** (`#0369a1`, hover `#075985`): Used for primary commit actions and active selection states. Exceeds WCAG AA contrast (5.8:1+) against white text.

### Secondary
- **Telemetry Cyan** (`#38bdf8`): Precision accent for coordinate crosshairs, active cell highlights, live indicators, and hover markers.
- **Code Cyan** (`#93c5fd`): Payload formatting and SQL editor highlighting.

### Tertiary Status & Defect Grades
- **Grade Pass (Emerald)** (`#10b981`, border `#059669`, text `#34d399`): Grade A module rating and prime cell indicators.
- **Grade Secondary (Amber)** (`#f59e0b`, border `#d97706`, text `#fbbf24`): Grade B module rating, moderate defects, and inactive cell fingers.
- **Grade Reject (Crimson)** (`#ef4444`, border `#dc2626`, text `#f87171`): Grade X scrap status, critical micro-cracks, and hotspots.
- **Severe Warning (Orange)** (`#f97316`, text `#fb923c`): Dark cell and severe shunt defect badges.

### Neutral
- **Deep Void Canvas** (`#090b0e`): Root application canvas and outer shell.
- **Console Deck** (`#11141a`): Top rail and sidebar dock background.
- **Block Surface** (`#151820`): Docked modules, toolbars, and input housings.
- **Input Well** (`#0a0c10`): Inset input fields and dark backgrounds.
- **Text Bright** (`#f8fafc`): High-contrast primary headings and active values.
- **Text Main** (`#e2e8f0`): Standard body and table cell text.
- **Text Muted** (`#94a3b8`): Secondary labels and captions (meets WCAG AA 4.5:1 on dark canvas).

### Named Rules
**The 11px Floor Rule.** No content-bearing or interactive UI text (badges, coordinates, labels, table cells) may render below `0.72rem` (11.5px).
**The Hairline Depth Rule.** Glow effects must never replace structural borders. Zero-offset blur halos are prohibited in favor of clean 1px border strokes (`#1c222c`, `#272f3e`).

## Typography

**Display Face:** Barlow Semi Condensed, -apple-system, sans-serif
**Body Face:** Barlow, -apple-system, sans-serif
**Label/Mono Face:** JetBrains Mono, monospace

**Character:** Technical, utilitarian, and engineered. Barlow Semi Condensed conveys authentic instrument panel character (like Zeiss and Keyence optical metrology benches). JetBrains Mono provides unambiguous differentiation between numbers (`0` vs `O`, `1` vs `I`).

### Hierarchy
- **Display / H1** (700, `1.25rem`, `1.1`): Station header `FVI-01 Final Visual Inspection Console`.
- **Title / H2** (700, `0.875rem`, `1.2`): Dock section titles, stage heading (1.43× step from H1).
- **Body** (400/500, `0.8125rem`, `1.5`): General instructions, table data.
- **Label** (600, `0.75rem`, `1.2`): Coordinate badges (`C8`), defect codes (`A1`, `X2`), module ID tags.

## Layout

- **Spatial Architecture**: Edge-to-edge console workbench with slim 48px top rail, 360px left sidebar dock, and full-width right inspection viewport.
- **Grid Matrix**: 24 columns (1–24) &times; 6 rows (A–F) overlaid directly over the EL camera feed with sticky coordinate headers on X and Y axes.
- **Viewport Padding**: Tight industrial insets (`8px` to `16px`), zero wasted whitespace.

## Elevation & Depth

Surfaces use matte tonal stepping:
- Canvas (`#090b0e`) &rarr; Deck (`#11141a`) &rarr; Blocks (`#151820`) &rarr; Inputs (`#0a0c10`).
- Crisp 1px hairline borders (`#1c222c`) replace soft drop shadows.

## Components

### Grade Controls
- Segmented 3-way industrial toggle (`[ A PRIME ] [ B SECONDARY ] [ X REJECT ]`) with tactile active inset borders and ISO color accents.

### Docked Cell Inspector
- Immediate inline defect classification without blocking modals. 8 quick defect buttons (`1`–`8`) for single-click or hotkey assignment.

### Precision Hairline Reticle
- 1px crosshair overlay on hover with live coordinate readout and corner brackets.

## Do's and Don'ts

### Do:
- **Do** maintain strict 11.5px font size floor across all elements.
- **Do** ensure all text on dark surfaces meets or exceeds 4.5:1 contrast (WCAG AA).
- **Do** preserve the exact 24x6 cell coordinate grid mapping (1–24 &times; A–F).
- **Do** use rapid, exponential easing (`cubic-bezier(0.16, 1, 0.3, 1)`) for UI transitions.

### Don't:
- **Don't** use generic Inter/Roboto typography.
- **Don't** use kickers/eyebrows above headings.
- **Don't** pop up full-screen modals for cell tagging; keep the camera image visible at all times.
- **Don't** use zero-offset neon glow halos.
