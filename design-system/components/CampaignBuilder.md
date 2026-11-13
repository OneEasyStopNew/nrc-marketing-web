# CampaignBuilder

A six-step wizard in a Card: a 220px step rail (done steps in `done`, the current step in `brand-wash`), the step body, and a foot with Back, Save draft, Continue and the gated Publish.

Publish is a `btn-regulatory` that stays disabled (lock icon) until step five passes: compliance check approved by a human and an IRB number on every creative. The forbidden-audience check is an `alert-regulatory` with a `badge-done` or `badge-blocked` result; it runs on every audience change.

Site presets fill budget, language and age from the site's history. Auto-stop switches are on by default. Platform tabs show access state as a badge (Google "Access pending", TikTok "R4"). Every campaign gets a code `C-nnnn` that follows the lead to enrollment. The wall pill is always visible in the head.
