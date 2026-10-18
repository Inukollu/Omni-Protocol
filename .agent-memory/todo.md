# Pending — Omni-Protocol

Last updated 2026-10-18.

- **Gap review, reworked with Vasu on 2026-10-18.** Each change below gets wire samples before it is built.
  - **Small batch, built as PR `calls/conference-lead-coaching`:**
    - **Contacts:** each contact carries a unique `id`.
    - **Conference:** `conference: { destinations: "contacts-only" | "any-number" }`; an add carries `contactId` or a typed `number`; the call, the history, the dial outcome and the remove name `contactId`.
    - **Hold:** the hold sentence.
    - **Lead capabilities:** `LeadCapabilities`.
    - **Coaching:** shown on `onCall`.
  - **Chat and email design piece:** its own walk-through, as voice had.
    - Direction: Omni draws the conversation (messages on the wire), and agents start a chat or email from Omni.
    - To decide in it: a lead reading a member's chat live; a multi-day park that frees capacity.
- **Naming review, later:** "login" vs "session". Vasu: the 10-12 hour signed-in period is the session, and login is a point-in-time act. Today the protocol says loginId and "the login", and uses "session" for createAuthenticationSession.
- **Omni release notes owed** for 0.1.115, 0.1.116, 0.1.117, 0.1.118, 0.1.121, 0.1.122, 0.1.123, 0.1.124, 0.1.125, 0.1.126, 0.1.127, 0.1.128 and 0.1.129, once the Omni session is back online. Jema has them all.
