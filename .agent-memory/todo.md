# Pending — Omni-Protocol

Last updated 2026-11-16.

- **Scan items against PURPOSE.md, for Vasu:** provider-worded phases, provider list order, provider-drawn controls, state said twice, the lead's "working kind" break, migration history in the guide, edge-case ceremony, thin chat and email files.
- **Call history and missed calls:** in scope (25 Oct); shape not yet designed.
- **Colleague chat:** in scope as its own surface, not the `chat` channel; not yet designed.
- **Scheduling a call with no task open** (from contacts or the calendar while idle): raised 6 Nov; `schedule` today needs a task. Parked by Vasu until he has clarity; revisit later.
- **Queue-gated Complete:** `complete?: { inSeconds } | { unavailable: true; reason? }` on a `completing` task. Jema agrees and waits on it; awaiting Vasu's go.
- **Day panel on Shift:** add `signedInSeconds` (all signed-in time, breaks, wrap and prep included), `wrapSeconds`, `prepSeconds`, running `wrap`, `prep` and `signed-in`, and `breaks` by `reasonId`. The protocol carries only what the provider counts and defines no figure worked out from them, such as average handle time; the desk works those out itself (Vasu, 17 Nov). The guide says a break counts in Shift exactly when BreakState showed it. Per-queue figures later; the streak and bests stay out (Vasu, 7 Nov). Next PR after the forced-break one.
