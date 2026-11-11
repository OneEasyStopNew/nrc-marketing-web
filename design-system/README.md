The visual system for NRC Connect, the platform OctavoLab is building for National Research Centers: recruitment and volunteers, front desk and visits, the marketing studio, reports, study finance, clinical follow-up and administration. It takes its structure from the Bonsai capture (semantic tokens, 14px everywhere, borders not shadows) and its colour from the NRC Connect prototype's language: deep navy ink, a working blue, violet reserved for regulatory, green for done, dark purple-navy slabs, IBM Plex Sans and IBM Plex Mono.

## Principles

**One blue does the work.** `brand` (#2f5bd8) is the only colour that acts: the one primary button per view, links, the active tab, focus rings, switches that are on, selected rows, chart series one. Everything else is `ink` and the grey-navy neutrals. A screen with two blue buttons has a decision left unmade.

**Violet means regulatory, nothing else.** `regulatory` (#6a3bd1) appears only where the IRB gate, the compliance check, a Part 11 signature, an audit entry or the adverse event clock is involved. It is never an accent, never a chart colour outside regulatory views, never decoration. When a person sees violet they know a rule is in the room.

**The boundary is visible.** Every screen says which side of the marketing and clinical data wall it belongs to: the clinical side carries a `badge-brand` "Clinical side" in the TopBar; the marketing studio carries the wall pill (`wall`, `brand-dark`) "Marketing side · no patient data". Marketing-side surfaces show codes (V-0412, L-2231, C-0219), never names. No component mixes the two sides.

**Status is a word plus a colour.** `done` green, `waiting` amber, `blocked` red and `brand` blue each pair a wash with a text colour and always a dot or icon and a word. Green and red differ in lightness, not only hue; nothing depends on telling them apart by hue alone.

**Borders, not shadows.** Cards, inputs, tables and the top bar are separated by 1px `line`. Shadows belong to things that float: dropdowns and toasts (`shadow-md`), modals and drawers (`shadow-lg`). `shadow-sm` on a resting card is a hint, not a lift.

**14px, everywhere.** Body, labels, buttons, cells, sidebar items and menu items are 14/20. Hierarchy comes from weight (400, 500, 600) and colour (`ink`, `text-muted`, `text-faint`), not size. Headings step to 16, 20, 26 and 36. Figures, codes and identifiers are IBM Plex Mono.

**Say the uncomfortable thing.** Copy states what happened, what it blocks, what to do: "Paused by Meta", "Needs finance access on eClinPro", "Nothing you entered was lost." No apology paragraphs, no exclamation marks, no "Oops".

## Colour

Build from the semantic tokens. Both themes are paired, not inverted: dark mode lightens `brand` and `regulatory`, so text on those fills becomes navy (`brand-contrast`, `regulatory-contrast`), never white.

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page ground | `surface-2` | #f5f6fb | #0c0d22 |
| Cards, fields, tables | `surface` | #ffffff | #12142e |
| Hover, raised, disabled | `surface-3` | #edeff7 | #1a1d3d |
| Default border | `line` | #dce0ee | #2a2e55 |
| Field border, strong rule | `line-strong` | #b9c0da | #434a7e |
| Body text | `ink` | #121a3a | #edeff8 |
| Secondary text | `text-muted` | #525b7e | #b5bbd8 |
| Column headers, placeholders | `text-faint` | #6b7290 | #8c93b8 |
| The working blue | `brand` | #2f5bd8 | #86a4ff |
| Blue wash | `brand-wash` | #e8eeff | #1c2650 |
| Purple-navy slab | `brand-dark` | #16163f | #0b0b24 |
| Regulatory violet | `regulatory` | #6a3bd1 | #bfa6ff |
| Done | `done` | #1e7e45 | #6fd39a |
| Waiting | `waiting` | #9a5b00 | #f2b85c |
| Blocked | `blocked` | #c0303a | #ff8a8a |

Every text token reaches 4.5:1 on the grounds its usage note names, in both themes; `text-disabled` is the one exception and is decorative by design. Chart series run `chart-1` blue, `chart-2` teal, `chart-3` amber, `chart-4` slate; `chart-5` violet only in regulatory views. Avatar grounds cycle `avatar-1` to `avatar-4` by person id.

Full-bleed surfaces (authentication slab, error pages, the cover, the code block) use `brand-dark` and `brand-dark-2` with `on-dark` and `on-dark-muted` text in both themes.

## Typography

IBM Plex Sans for everything read; IBM Plex Mono for everything counted or identified. Both load from Google Fonts; the fallback stacks are declared in `type.families`.

| Style | Size / line | Weight | Where |
| --- | --- | --- | --- |
| `display` | 36 / 42 | 600, −0.5px | Auth slab titles, error pages |
| `heading-lg` | 26 / 34 | 600, −0.25px | Page titles |
| `heading-md` | 20 / 28 | 600 | Card and modal titles |
| `heading-sm` | 16 / 24 | 600 | Section headers in cards |
| `body` | 14 / 20 | 400 | Everything |
| `body-medium` | 14 / 20 | 500 | Labels, buttons, sidebar, tabs |
| `body-semibold` | 14 / 20 | 600 | Primary table cell, active tab |
| `body-lg` | 16 / 24 | 400 | Participant-facing copy |
| `caption` | 12 / 16 | 500, caps | Column headers, badge text |
| `caption-regular` | 12 / 16 | 400 | Helper text, timestamps, ticks |
| `micro` | 11 / 14 | 600, caps | Ribbons |
| `code` | 13 / 20 mono | 400 | Codes, protocols, invoice numbers |
| `stat` | 28 / 32 mono | 500, tabular | Stat values, chart totals |

Column headers are uppercase with 0.4px tracking; nothing else is uppercase except ribbons.

## Spacing, radius, layout

4px base. Buttons 32 / 36 / 44 tall; inputs 36; table rows 44 (36 compact); sidebar items 36; menu items 34. Card padding 16 (20 on dashboards); page gutter 24; section gap 32.

Radii: `radius-sm` 4 (checkbox, kanban card, inline code), `radius-md` 6 (buttons, inputs, menu items: the workhorse), `radius-lg` 10 (cards, dropdowns, toasts), `radius-xl` 14 (modals, auth card, AI panels), `radius-pill` for chips, pills, badges and the switch, `radius-full` for avatars.

Frame: 48px TopBar, 240px Sidebar collapsing to a 56px rail, content in a 1120px wrapper (1440 for kanban, calendar and data tables), 560px right drawer, 640px auth card.

## States and feedback

Focus is a `brand` border plus `shadow-focus` (3px ring at 35%); regulatory controls use `regulatory` plus `shadow-focus-regulatory`. Hover on rows and items is `surface-3`. Disabled is 50% opacity with `cursor: not-allowed`, never a lighter colour alone. Loading says what is loading; skeleton rows when the layout is known, a Spinner when it is not.

Inline conditions use Alert; transient confirmations use Notification; bars under the TopBar use NoticeBar, regulatory first. Empty states explain why the feature exists in NRC's words.

## Iconography

Line icons on a 16px grid, 1.5px stroke, round caps and joins, `currentColor`. Fifty glyphs are drawn in the Icons component; copy their paths. Signal icons only take colour: `shield` and `clock` in `regulatory`, `check` in `done`, `warn` in `blocked`. Module icons sit in a 32px `brand-wash` tile. No filled icons, no emoji, no stock photography, no clip art, no gradients for decoration.

## Content

Sentence case everywhere except column headers and ribbons. Buttons name the object: "Schedule visit", "Mark paid", "Approve with IRB number". Errors are written as the fix: "Enter ten digits". Participant-facing copy is second person, plain, in English and Spanish, and never shows the study condition where someone else might see the screen. Never write that the system is HIPAA compliant, Part 11 compliant or SOC 2 certified; write HIPAA-aligned safeguards, a signed Business Associate Agreement, Part 11 controls validated with NRC.

## Components

Every component has a live preview and guidelines, grouped as Foundations (Icons, Strokes), Actions (Button, ButtonGroup, Link, Chip), Forms (Input, Select, Textarea, Checkbox, Radio, Switch, FormLayout), Data display (Card, StatCard, BasicTable, DataTable, PricingTable, List, Kanban, Calendar, Carousel, Image, Video, Avatar), Navigation (Sidebar, TopBar, Tabs, Breadcrumbs, Pagination), Overlays (Dropdown, Popover, Tooltip, Modal), Feedback (Badge, Ribbon, Alert, NoticeBar, Notification, ProgressBar, Spinner, EmptyState), Charts (BarChart, LineChart, PieChart, RadarChart), Maps (VectorMap, LocationMap), Pages (SignIn, SignUp, ResetPassword, TwoStepVerification, ErrorPage, SuccessPage), Marketing studio (CampaignBuilder, CreativeCard, ComplianceCheck, CampaignPacing, LeadFunnel, Inbox) and AI (AIAssistant, AITextGenerator, AIImageGenerator, AICodeGenerator, AIVideoGenerator, AISettings).

`components/bundle.css` holds every class the previews use (`.btn`, `.input`, `.table`, `.badge`, `.card`, `.menu`, `.modal`, `.kanban` and the rest). Load `tokens.css` then `bundle.css` and the markup in any preview works as is.
