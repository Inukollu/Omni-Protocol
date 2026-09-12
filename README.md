# Omni-Protocol

The contract every provider adapter implements, and the checks that hold adapters to it.

A provider is one independently connected external system — a voice platform, a chat platform, a
mail platform. An adapter is the package speaking this contract for one provider. Omni composes
several providers into one agent-facing desktop and owns everything outside a provider's own
system.

## What is here

| Path | |
| --- | --- |
| `guide.md` | **The protocol.** The terms, the shapes, the rules, and how an adapter is declared, connected and held to them. |
| `guide/` | One file per role and channel: `agent.md`, `lead.md`, `queue.md`, `breaks.md`, `phone.md`, `voice.md`, `chat.md`, `email.md`. Each points back into `guide.md` for what it relies on. |
| `src/index.ts` | The TypeScript declarations. |
| `src/validation.ts` | Runtime validators Omni applies to adapter output. |
| `src/testing.ts` | Testing an adapter an adapter runs against its own test state. |
| `tests/` | One test file per source module, plus the guards over the guide and the repository's own text. |

## Entry points

```ts
import { defineAdapter } from "@xema/omni-protocol";
import { validateSnapshot, assertNoViolations } from "@xema/omni-protocol/validation";
import { testAdapter } from "@xema/omni-protocol/testing";
```

## Validation is not only for tests

An adapter is loaded from a separate package and may be compiled against a different protocol
version, so its output is untrusted input. Every validator takes `unknown` and returns every
violation it found rather than throwing on the first, so a caller reports all of them at once.
Validating a snapshot before it replaces provider state is what stops a malformed task reaching
the agent's workspace; validating a result with `validateResult(result, method)` before acting on
it is what stops a status the host does not know being shown as an outcome.

```ts
const violations = validateSnapshot(snapshot, manifest);
assertNoViolations(violations);
```

A violation carries a stable `rule` id such as `task.browser.url.scheme`, the `path` it was found
at such as `snapshot.tasks[0].browsers[1].url`, and a `message`.

Some rules need more than the object in hand. A team member list never carries the agent it is published to,
a lead's snapshot always carries one and nobody else's ever does — and a validator cannot know who
is reading, or what their login declares, from the snapshot alone. `validateTeamMembers`,
`validateSnapshot`, and `validateEventEnvelope` each take an optional final `{ self, capabilities }`
from the `authenticated` state; given them, they report `team.member.self`, `team.request.self`,
`team.required`, `team.unentitled`, `team.requests.capability`, and `team.requests.required`.
Without them those rules are not checked. `testAdapter` always passes both.

```ts
const { identity, capabilities } = authenticated;
validateSnapshot(snapshot, manifest, "snapshot", { self: identity.id, capabilities });
```

## Conformance

`testAdapter` validates the manifest, opens an authenticated session, connects, checks
required capability methods, subscribes, validates the snapshot, every delivered event, and every
authentication state published during the run — against the latest login — states a capacity,
then unsubscribes and disconnects. `result.notTested` names what the run never reached — each
optional part of a task, of the break state and team member list, each contribution, each event type — so a
clean result is read for what it covers and not for the whole contract; `assertReached(result,
subjects)` is the paired assertion.

```ts
const context = { protocolVersion: OMNI_PROTOCOL_VERSION, loginId: "session-1", host: stillHost(report) };
const result = await testAdapter(adapter, context, { collectOnly: true });
expect(result.violations).toEqual([]);
expect(result.disconnectWasClean).toBe(true);
```

Run the contract scenarios beside it — authentication restore and expiry, capability withdrawal,
reconnect with missed assignments, break denial and retry, a break asked for on a task, who a
break asks, wrap timeout, browser isolation.

> **Assert both directions.** Every helper rejects a violating input as well as accepting a
> conforming one. A suite that only asserts "this conforming case does not throw" passes unchanged
> if the helper is gutted, so pair every positive case with the violating twin.

## Three things TypeScript will not catch for you

All found by adapters against this contract, and all produce a green build over a wrong shape.
Two share one cause: TypeScript checks extra keys only on a literal that is the thing directly
assigned. Move the literal anywhere else and the check is gone.

**Conditional spreads are the blind spot on a task literal.** A key inside
`...(cond ? { … } : {})` is never checked against the task type, and `satisfies Task<C>` on the
surrounding literal does not reach it. Put the check on the spread operand itself:

```ts
const task = {
  id, title, channel: "voice", taskType, capabilities, browsers, phase, completionMode,
  ...(contact ? { contact } satisfies Partial<Task<"voice">> : {}),
};
```

**Switch on `command.action` with no `default`.** A `default` turns a future action into whatever
the default does, silently; naming every arm means dropping one fails the build — indirectly, as a
missing return — and keeps the narrowing that lets you read `destinationId` without a cast.

```ts
switch (command.action) {
  case "cold":     return coldTransfer(command.destinationId);
  case "warm":     return warmTransfer(command.destinationId);
  case "complete": return completeWarmTransfer();
  case "cancel":   return cancelWarmTransfer();
}
```

**A `const` fixture escapes excess-property checking.** Park a literal in a variable and it is no
longer the thing directly assigned — the same reason the conditional spread escapes — so a shared
test fixture keeps a field the contract has dropped: `tsc` says nothing and the suite is
confidently green over a shape that no longer exists. Annotate the `const` or `satisfies` it where
it is declared; either names the field on the next build.

```ts
take({ reasonId, requestedAt });                                // error: requestedAt
const request = { reasonId, requestedAt }; take(request);      // no error — the hole
const request: BreakRequest = { reasonId, requestedAt };        // error: requestedAt
const request = { reasonId, requestedAt } satisfies BreakRequest; // error: requestedAt
```

## Building

```
pnpm install --frozen-lockfile
pnpm check        # clean build, type checks, tests, and packed-package checks
pnpm build        # emits dist/
pnpm test         # type-checks the tests, then runs them
pnpm check:package # verifies the current dist/ as a consumer would
```

CI runs the complete check on Node 20, 22, and 24 for pull requests (including drafts)
and pushes to main. Package checks create a temporary npm tarball, verify its contents,
and check JavaScript imports and TypeScript declarations for every exported entry point
from an isolated consumer. Publishing also runs `pnpm check` through `prepublishOnly`.

## The guide is authoritative

Where `guide.md` and any code here disagree, the guide is right and the code is a defect. It has
been through review and is not edited casually.
