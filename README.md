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
import { defineAdapter } from "@xema/omni-protocol";
import { validateSnapshot, assertNoViolations } from "@xema/omni-protocol/validation";
import { exerciseAdapter } from "@xema/omni-protocol/testing";
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
assignments, break denial and retry, wrap timeout, browser isolation.

> **Assert both directions.** Every helper rejects a violating input as well as accepting a
> conforming one. A suite that only asserts "this conforming case does not throw" passes unchanged
> if the helper is gutted, so pair every positive case with the violating twin.

## Two things TypeScript will not catch for you

Both found by adapters against this contract, and both produce a green build over a wrong shape.

**Conditional spreads are the blind spot on a task literal.** A key inside
`...(cond ? { … } : {})` is never checked against the task type, and `satisfies Task<C>` on the
surrounding literal does not reach it. Put the check on the spread operand itself:

```ts
const task = {
  id, title, channel: "voice", taskType, capabilities, browsers, phase, completionMode,
  ...(contact ? { contact } satisfies Partial<Task<"voice">> : {}),
};
```

**The blind transfer arm is `action?: never`.** Switch on `command.action` with `case undefined`
for it, never a `default`: a `default` turns a future action into a silent blind transfer, and
switching on `command.action ?? "blind"` loses the narrowing that lets you read `destination`
without a cast. Dropping an arm then fails the build — indirectly, as a missing return.

```ts
switch (command.action) {
  case undefined:  return blindTransfer(command.destination);
  case "consult":  return consultTransfer(command.destination);
  case "complete": return completeConsultation();
  case "cancel":   return cancelConsultation();
}
```

## Building

```
pnpm install
pnpm build        # emits dist/
pnpm test         # type-checks the tests, then runs them
```

## The guide is authoritative

Where `guide.md` and any code here disagree, the guide is right and the code is a defect. It has
been through review and is not edited casually.
