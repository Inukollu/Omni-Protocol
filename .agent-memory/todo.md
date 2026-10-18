# Pending — Omni-Protocol

Last updated 2026-10-18.

- **Gap review, reworked with Vasu on 2026-10-18.** Each change below gets wire samples before it is built.
  - **Small batch, built as PR #158:**
    - **Contacts:** each contact carries a unique `id`.
    - **Add to call (was conference):** the `addToCall` capability says `destinations: "contacts-only" | "any-number"` and may narrow to `contactIds`. The commands are `add-to-call` (`contactId` or `number`) and `remove-from-call`. The role and history step are `added`, and the wire names `contactId`.
    - **Hold:** the hold sentence.
    - **Lead capabilities:** `LeadCapabilities`.
    - **Coaching:** shown on `onCall`.
  - **Chat and email design piece:** its own walk-through, as voice had.
    - Direction: Omni draws the conversation (messages on the wire), and agents start a chat or email from Omni.
    - To decide in it: a lead reading a member's chat live; a multi-day park that frees capacity.
- **Naming, open question:** the browser tab's `sharedSession` (a browser cookie session) is now a second meaning of "session". Decide its name.
- **Omni release notes owed** for 0.1.115, 0.1.116, 0.1.117, 0.1.118, 0.1.121, 0.1.122, 0.1.123, 0.1.124, 0.1.125, 0.1.126, 0.1.127, 0.1.128 and 0.1.129, once the Omni session is back online. Jema has them all.
