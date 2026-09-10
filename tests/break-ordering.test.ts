import { describe, expect, it } from "vitest";
import type { BreakApproval, BreakState } from "../src/index.js";
import { validateBreakTransition } from "../src/validation.js";
import { BreakStream } from "../src/testing.js";

const state = (approval: BreakApproval): BreakState => ({ approval, mayAsk: true });
const event = (approval: BreakApproval) => ({ event: { type: "break-state", break: state(approval) } });

describe("runtime break ordering", () => {
  it("checks every pair against the allowed event transitions", () => {
    const allowed: Record<BreakApproval, BreakApproval[]> = {
      "not-requested": ["not-requested", "awaiting-decision", "granted"],
      "awaiting-decision": ["not-requested", "awaiting-decision", "granted"],
      granted: ["not-requested", "granted", "starting-after-task", "in-effect"],
      "starting-after-task": ["not-requested", "starting-after-task", "in-effect"],
      "in-effect": ["not-requested", "in-effect"],
    };
    const phases = Object.keys(allowed) as BreakApproval[];
    for (const from of phases) for (const to of phases) {
      expect(validateBreakTransition(state(from), state(to)).length === 0, `${from} -> ${to}`)
        .toBe(allowed[from].includes(to));
    }
  });

  it("allows independently evidenced imposed breaks, but rejects malformed imposition", () => {
    const after = { ...state("in-effect"), imposed: { by: "manager", endsAutomatically: false } };
    expect(validateBreakTransition(state("not-requested"), after)).toEqual([]);
    expect(validateBreakTransition(state("not-requested"), { ...after, imposed: {} })).not.toEqual([]);
  });

  it("does not mutate accepted state on a late request, and allows a new attempt after ending", () => {
    const before = Object.freeze(state("in-effect"));
    expect(validateBreakTransition(before, state("awaiting-decision")).map(v => v.rule))
      .toContain("stream.breakState.backwards");
    expect(before.approval).toBe("in-effect");
    expect(validateBreakTransition(before, state("not-requested"))).toEqual([]);
    expect(validateBreakTransition(state("not-requested"), state("awaiting-decision"))).toEqual([]);
  });

  it("rejects malformed previous and next states without throwing", () => {
    for (const bad of [null, undefined, [], {}, { approval: "started", mayAsk: true }, { approval: "granted" }]) {
      expect(validateBreakTransition(bad, state("granted"))).not.toEqual([]);
      expect(validateBreakTransition(state("granted"), bad)).not.toEqual([]);
    }
  });

  it("reseeds from an authoritative snapshot instead of ranking against a former attempt", () => {
    const stream = new BreakStream();
    stream.seed({ break: state("in-effect") });
    expect(stream.apply({ event: { type: "snapshot", snapshot: { break: state("awaiting-decision") } } })).toEqual([]);
    expect(stream.apply(event("granted"))).toEqual([]);
    expect(stream.apply(event("in-effect"))).toEqual([]);
    // An active snapshot needs no invented request/grant replay.
    stream.seed({ break: state("in-effect") });
    expect(stream.apply(event("in-effect"))).toEqual([]);
    expect(stream.apply(event("awaiting-decision")).map(v => v.rule)).toContain("stream.breakState.backwards");
  });

  it("does not claim to detect a stale snapshot or legal-looking old event", () => {
    // No source revision/attempt identity exists: this could be a new request or a delayed old one.
    expect(validateBreakTransition(state("not-requested"), state("awaiting-decision"))).toEqual([]);
    const stream = new BreakStream();
    stream.seed({ break: state("in-effect") });
    expect(stream.apply({ event: { type: "snapshot", snapshot: { break: state("not-requested") } } })).toEqual([]);
  });
});
