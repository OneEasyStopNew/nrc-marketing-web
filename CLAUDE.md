# NRC Marketing web

React 19 + TypeScript + Vite. See README.md for commands and layout.

## The UI is built with Astryx

Every screen is composed from Astryx components (`@astryxdesign/core`, neutral theme) and laid out the way the Astryx page templates do it. Read a component before using it: `npx astryx component <Name>`; start a new screen from a template: `npx astryx template` lists them.

- No custom CSS, no utility classes and no `className` in `src/`. Layout is `VStack`, `HStack`, `Grid`, `Layout`; spacing, colour, radius and type come from Astryx props and theme tokens. The only exceptions are the evidence and diff marks in `src/index.css`.
- The theme (`src/theme/nrcTheme.ts`) is Astryx neutral with the NRC brand blue as the accent. Do not add other overrides.
- Icons are Heroicons through `src/components/ui/Icon.tsx`.
- `src/components/ui` holds thin wrappers that keep the app's prop names; they render Astryx components only.
- One primary button per view. Status is a word plus a colour, never colour alone.
- Copy says what happened, what it blocks and what to do. No exclamation marks, no apologies, no emoji.
- `design-system/` is the earlier NRC Connect design system. It is kept for reference and no longer drives the UI.

## Auth and API rules (OR-102)

- Pages call the API only through `src/api/*`, never `fetch` directly.
- Never write tokens, signed URLs, prompts or patient data to localStorage, IndexedDB, logs, analytics or URLs.
- Hiding a menu item is not authorization: guard routes with `can(capability)`, and expect the API to refuse anyway.
- A 403 is a permission answer to show, not a sign-out. Only `http.ts` handles 401.
- Tenant-scoped query keys must include the tenant id, and the cache is cleared on organisation switch.
- Simulation mode is for development only. The sign-in page labels its identities as simulation, and a production build refuses the mode unless `VITE_ALLOW_SIMULATION=true`.
- All dummy data goes in `src/mocks/data.ts` (data only, git-ignored, never commit it); its shape is `MockData` in `src/mocks/types.ts`; fake endpoints go in `ROUTES` in `src/mocks/api.ts`. Pages never import from `src/mocks/`. Dummy values are visibly fake; never invent study facts.

## Done means

`npm run typecheck`, `npm test` and `npm run test:e2e` pass. A screen change is done when its layout audit passes at 1440, 1280 and 390 wide and in dark mode.
