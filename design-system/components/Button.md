# Button

Eight variants on one shape: 14px medium IBM Plex Sans, 6px radius (`radius-md`), 1px border, 36px tall by default.

## Variants

- **Primary** (`btn-primary`): `brand` fill, `brand-contrast` text. One per view, the main action. Hover `brand-strong`.
- **Secondary** (`btn-secondary`): `surface` fill, `line-strong` border, `shadow-sm`. Everything that is not the main action: Export, Filter, Close.
- **Ghost** (`btn-ghost`): no border, `text-muted`. Toolbars and Cancel.
- **Outline** (`btn-outline`): `brand` border and text. Secondary actions that still belong to the brand, such as "Add volunteer" beside a primary "Save".
- **Danger** and **Danger outline**: `blocked`. Destructive confirmations only; the outline form is for the trigger, the filled form for the confirm button in the modal.
- **Regulatory** (`btn-regulatory`): `regulatory` fill. Reserved for actions that sign, approve or release something under the IRB gate or Part 11: "Approve with IRB number", "Sign and lock", "Acknowledge adverse event". Never used for ordinary saves.
- **Done** (`btn-done`): `done` fill. Only for closing a state: Mark paid, Mark enrolled.
- **Link** (`btn-link`): text in `brand`, no box.

## Sizes

`btn-sm` 32px (toolbars, table rows), default 36px (forms, headers), `btn-lg` 44px (auth pages, welcome screen, participant-facing).

## Rules

- Sentence case. Name the object: "Schedule visit", not "Submit".
- Secondary on the left, primary on the right. Never two primaries in one row.
- Loading: keep the width, swap the icon for `.spin`, keep the label ("Syncing Meta").
- Disabled: 50% opacity and `cursor: not-allowed`; still readable.
- Pill (`btn-pill`) only for participant-facing or messaging actions.
- Focus ring: `shadow-focus` plus a `brand` border; regulatory buttons use `shadow-focus-regulatory`.
