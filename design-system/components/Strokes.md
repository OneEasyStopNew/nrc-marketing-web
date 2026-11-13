# Strokes

Three lines do all the separating; shadows are for things that float.

- `line` (1px): card edges, buttons, inputs at rest in dense tables, section dividers, the top bar bottom edge.
- `line-strong` (1px): field borders at rest, stronger separators, any border that must reach 3:1 on its own.
- `line-hair`: ink at 8% (white at 10% in dark), the hairline between table and list rows.

Focus is never an outline: a `brand` border plus `shadow-focus` (3px ring at 35%). Regulatory controls use `regulatory` plus `shadow-focus-regulatory`. Dashed `line-strong` marks a drop zone. Dividers inside a card are full-bleed; dividers between page sections use 32px of space instead of a line where possible.
