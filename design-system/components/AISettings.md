# AISettings

An administration Card. Left: a compact table of tasks with the provider (generic names in the UI; the vendor appears only in the configuration record), region and state (`done` on, `regulatory` for the compliance prompt because a human approves, `waiting` on trial, neutral for admin-only). Under it the data-boundary switches: the two that touch identity are regulatory switches and cannot be turned off from this page. Right: usage with ProgressBars against the monthly cap, the cap field, and the kill switch as a `btn-danger-outline` that turns every AI feature off at once.

Every setting change is audited with the administrator's name.
