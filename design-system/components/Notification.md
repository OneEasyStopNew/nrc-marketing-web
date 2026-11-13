# Notification

Toasts are 360px, `surface`, `shadow-md`, stacked bottom-right, 3px coloured left edge by tone (`done`, `blocked`, `regulatory`), with a title, one line of body and a close. They dismiss after six seconds except blocked and regulatory ones, which stay until closed. A progress toast shows a Spinner and a ProgressBar for long syncs.

The notification list (bell menu) reuses List rows with an unread dot in `brand`. Notifications name codes, never participants.
