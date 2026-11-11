# Select

Same box as Input with a chevron at right 10px. Three forms.

- **Single select**: a native `select` styled with the chevron; use for short, stable lists (study, site, language).
- **Multi select**: chosen values render as 24px chips inside the box; the box grows.
- **Combobox**: an input that opens a Dropdown menu filtered by what is typed, with a secondary fact in mono at the right (site, code). Use for people and volunteers.

The consumer supplies options as `{value, label, meta?}`. Keep option labels under 32 characters; put the rest in `meta`.
