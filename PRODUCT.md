# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary User**: Production Quality Control (QC) and Final Visual Inspection (FVI) line operators on manufacturing shift rotations (e.g. Vance.K, Shift A).
- **Situation**: Operating dedicated shop-floor inspection stations under manufacturing line conditions; interacting via industrial desktop PCs equipped with full-size monitors, mice, and handheld barcode scanners.
- **Job to be Done**: Rapidly scan incoming photovoltaic module serial IDs, inspect Electroluminescence (EL) imagery across 144 half-cut cells, accurately tag cell-level defects, assign definitive module classification grades (A, B, or X), and commit structured inspection logs to the manufacturing database.

## Product Purpose

Provide an ultra-responsive, zero-latency workstation interface for solar module final visual inspection (FVI Screen 1) that minimizes inspection cycle times, prevents grading errors, and standardizes defect tracking from physical EL camera scans into backend SQL / MES records.

## Positioning

Unlike generic defect logging forms or heavy enterprise MES interfaces, this station combines a 1:1 mapped 24x6 coordinate matrix overlay directly onto high-resolution EL imagery with one-click single-defect classification, live whiteboard syntax generation, and instant SQL query readiness.

## Operating Context

- **Environment**: Solar panel manufacturing facility, Station 1 Final Visual Inspection line.
- **Hardware**: Industrial workstation PC with standard monitor, mouse navigation, and hardware barcode/serial scanner.
- **Workflows**:
  1. Scan or enter Module Serial ID.
  2. Inspect EL camera image for micro-cracks, dark cells, solder voids, and hotspots using zoom/fit and invert filters.
  3. Click specific cell coordinates (e.g., C8, E14) on the 24x6 grid to log defect codes (A1-A2, B1-B2, C1, X1-X3) with optional notes.
  4. Classify overall module grade: [A] Prime/Pass, [B] Secondary, [R] Retest/Rework, or [X] Reject/Scrap.
  5. Save inspection and sync payload to backend MES / database.

## Capabilities and Constraints

- **Cell Matrix**: Strictly 24 Columns (1–24) &times; 6 Rows (A–F) = 144 half-cut monocrystalline/polycrystalline silicon cells.
- **Module Grade**: Mutually exclusive single selection among Grade A (Prime), Grade B (Secondary), Grade R (Retest / Rework), and Grade X (Reject).
- **Defect Catalog**:
  - `A1`: Micro-Crack (Hairline) [Minor / Grade A]
  - `A2`: Cross-Crack / Star Crack [Moderate / Grade B]
  - `B1`: Inactive Area / Dead Finger [Moderate / Grade B]
  - `B2`: Solder Disconnect / Void [Moderate / Grade B]
  - `C1`: Dark Cell / Low Shunt [Severe / Grade B]
  - `X1`: Broken Cell / Corner V-Crack [Critical / Grade X]
  - `X2`: Severe Hotspot / Solder Bead [Critical / Grade X]
  - `X3`: Delamination / Foreign Material [Critical / Grade X]
- **Feedback Mechanism**: Audio feedback via Web Audio API synthesizer for tactile auditory confirmation during high-speed logging.
- **Output**: Whiteboard coordinate syntax string generation and parameterized SQL `INSERT INTO module_inspections` / `module_defects` statements.
- **Architecture**: Zero-dependency static client-side web application (vanilla HTML5, CSS3, JavaScript ES6+).

## Brand Commitments

- **Tone & Voice**: Industrial, precise, high-contrast, functional, and distraction-free.
- **Design Tokens**: Dark industrial theme (`.theme-dark`), monospace typography for codes/coordinates (`JetBrains Mono`), and clear status badging (Green = Pass, Amber = Secondary, Red = Reject).

## Evidence on Hand

- Core implementation in [index.html](file:///c:/Users/megam/OneDrive/문서/US%20Modules/finalinspection/index.html), [app.js](file:///c:/Users/megam/OneDrive/문서/US%20Modules/finalinspection/app.js), and [styles.css](file:///c:/Users/megam/OneDrive/문서/US%20Modules/finalinspection/styles.css).
- High-resolution production EL module image: [solar_el_sample.jpg](file:///c:/Users/megam/OneDrive/문서/US%20Modules/finalinspection/solar_el_sample.jpg).

## Product Principles

1. **Cycle Time Is Sacred**: Every micro-interaction must prioritize rapid visual assessment and one-click defect tagging to keep pace with module conveyor line speeds.
2. **Coordinate Truth**: The 24x6 grid must align flawlessly with physical cell boundaries on the EL image; a misaligned cell tag is a manufacturing error.
3. **High-Contrast Legibility**: Key statuses, defect severity indicators, and coordinates must be instantaneously distinguishable under varied shop-floor lighting without eye strain.
4. **Zero State Loss**: Inspections in progress must never lose tagged cells or grade selections on accidental clicks; confirmation and clear actions must be intentional.
5. **Direct Backend Alignment**: Logged defects must translate 1:1 into structured SQL/MES payloads with zero ambiguity.

## Accessibility & Inclusion

- Keyboard navigation and shortcut support for rapid grade and coordinate selection.
- Clear color-blind safe differentiation between Grade A (emerald), Grade B (amber), and Grade X (crimson) using distinct icons, letters, and descriptors in addition to color.
- Strict adherence to the 11px minimum font size floor across all functional badges and table cells.
