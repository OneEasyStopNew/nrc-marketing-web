# Badge

A 20px pill in 12px medium text. Status badges carry a 6px dot in the same colour and always a word: colour alone never carries a state.

| Badge | Token pair | Meaning |
| --- | --- | --- |
| `badge-done` | `done-wash` / `done` | finished: enrolled, paid, published, verified |
| `badge-waiting` | `waiting-wash` / `waiting` | waiting on someone: approval, IRB number, payment |
| `badge-blocked` | `blocked-wash` / `blocked` | failed, overdue, rejected, did not qualify |
| `badge-brand` | `brand-wash` / `brand-strong` | in motion: scheduled, in review, syncing |
| `badge` (neutral) | `surface-3` / `text-muted` | not started, draft, archived |
| `badge-regulatory` | `regulatory-wash` / `regulatory-strong` | an IRB number, an audit flag, the adverse event clock |

`badge-count` is the numeric counter (`brand` fill); `badge-solid` is the inverse chip for document states. Add `no-dot` when an icon leads instead.

Each recruitment stage (sixteen of them) maps to one of the five status families; the mapping lives in LeadFunnel's README.
