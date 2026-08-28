# Omni-Protocol

The contract every provider adapter implements, and the checks that hold adapters to it.

A provider is one independently connected external system — a voice platform, a chat platform, a
mail platform. An adapter is the package speaking this contract for one provider. Omni composes
several providers into one agent-facing desktop and owns everything outside a provider's own
system.

## What is here

| Path | |
| --- | --- |
| `guide.md` | **The protocol.** Rules, shapes, and the reasoning behind them. |
| `src/index.ts` | The TypeScript declarations. |
| `src/validation.ts` | Runtime validators Omni applies to adapter output. |
| `src/testing.ts` | Conformance helpers an adapter runs against its own test state. |

## Entry points

```ts
import { defineAdapter } from "@omni/protocol";
import { validateSnapshot, assertNoViolations } from "@omni/protocol/validation";
import { exerciseAdapter } from "@omni/protocol/testing";
```

## Validation is not only for tests

An adapter is loaded from a separate package and may be compiled against a different protocol
version, so its output is untrusted input. Every validator takes `unknown` and returns every
violation it found rather than throwing on the first, so a caller reports all of them at once.
Validating a snapshot before it replaces provider state is what stops a malformed task reaching
the agent's workspace.

```ts
const violations = validateSnapshot(snapshot, manifest);
assertNoViolations(violations);
```

A violation carries a stable `rule` id such as `task.browser.url.scheme`, the `path` it was found
at such as `snapshot.tasks[0].browsers[1].url`, and a `message`.

## Conformance

`exerciseAdapter` validates the manifest, opens an authenticated session, connects, checks
required capability methods, subscribes, validates the snapshot and every delivered event, states
a capacity, then unsubscribes and disconnects.

```ts
const result = await exerciseAdapter(adapter, context, { collectOnly: true });
expect(result.violations).toEqual([]);
expect(result.disconnectWasClean).toBe(true);
```

Run the contract scenarios beside it — authentication restore and expiry, reconnect with missed
assignments, break denial and retry, command idempotency, wrap timeout, browser isolation.

> **Assert both directions.** Every helper rejects a violating input as well as accepting a
> conforming one. A suite that only asserts "this conforming case does not throw" passes unchanged
> if the helper is gutted, so pair every positive case with the violating twin.

## Building

```
pnpm install
pnpm build        # emits dist/
pnpm test         # type-checks the tests, then runs them
```

## The guide is authoritative

Where `guide.md` and any code here disagree, the guide is right and the code is a defect. It has
been through review and is not edited casually.
