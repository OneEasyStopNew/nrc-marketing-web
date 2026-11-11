# FormLayout

Forms live in a Card: a head with the title and a side badge, sections introduced by a `cap` label, a two-column grid of fields (16px row gap, 20px column gap), and a foot with Cancel (ghost) left of the primary.

- Required fields carry a red asterisk; the legend sits in the foot.
- Full-width fields span both columns (`grid-column: 1/-1`): addresses, notes, consent rows.
- Generated values render disabled with "Generated" as helper text.
- The side badge says which side of the data boundary the form belongs to: "Clinical side" (`badge-brand`) or the wall pill for marketing.
- Validate on blur, show all errors on submit, scroll to the first.
