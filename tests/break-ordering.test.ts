import { describe, expect, it } from "vitest";
import type { BreakApproval, BreakState } from "../src/index.js";
import { validateBreakTransition, validateBreakCommand, validateBreakStatus, validateTeamBreakCommand, validateResult, type BreakMethod } from "../src/validation.js";
import { BreakStream } from "../src/testing.js";

const state = (approval: BreakApproval): BreakState => ({ approval, mayAsk: true });
const event = (approval: BreakApproval) => ({ event: { type: "break-state", break: state(approval) } });

describe("runtime break ordering", () => {
  it("rejects the retired break field even beside the new field", () => {
    const forced = { by: "manager", endsAutomatically: false };
    for (const fields of [{ imposed: forced }, { imposed: forced, forced }]) {
      const after = { ...state("in-effect"), ...fields };
      expect(validateBreakStatus(after, []).map(v => v.rule)).toContain("break.forced.renamed");
      expect(validateBreakTransition(state("not-requested"), after).map(v => v.rule)).toContain("break.forced.renamed");
    }
  });

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

  it("allows independently evidenced forced breaks, but rejects malformed forced-break evidence", () => {
    const after = { ...state("in-effect"), forced: { by: "manager", endsAutomatically: false } };
    expect(validateBreakTransition(state("not-requested"), after)).toEqual([]);
    expect(validateBreakTransition(state("not-requested"), { ...after, forced: {} })).not.toEqual([]);
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

  it("requires a snapshot initially and after a rejected delta", () => {
    const stream = new BreakStream();
    expect(stream.needsRecovery).toBe(true);
    expect(stream.apply(event("granted")).map(v => v.rule)).toContain("stream.breakState.baseline");
    expect(stream.seed({ break: state("in-effect") })).toEqual([]);
    expect(stream.apply(event("awaiting-decision"))).not.toEqual([]);
    expect(stream.needsRecovery).toBe(true);
    // The rejected request cannot make the following grant appear valid.
    expect(stream.apply(event("granted")).map(v => v.rule)).toContain("stream.breakState.baseline");
    expect(stream.seed({ break: state("not-requested") })).toEqual([]);
    expect(stream.needsRecovery).toBe(false);
    expect(stream.apply(event("awaiting-decision"))).toEqual([]);
    expect(stream.apply(event("granted"))).toEqual([]);
    expect(stream.apply(event("in-effect"))).toEqual([]);
  });

  it("requires reseeding after transport loss even when transport becomes active again", () => {
    const stream = new BreakStream();
    stream.seed({ break: state("granted") });
    stream.apply({ event: { type: "transport-status", status: "connecting" } });
    stream.apply({ event: { type: "transport-status", status: "active" } });
    expect(stream.needsRecovery).toBe(true);
    expect(stream.apply(event("in-effect"))).not.toEqual([]);
    expect(stream.seed({ break: state("in-effect") })).toEqual([]);
    expect(stream.apply(event("not-requested"))).toEqual([]);
  });

  it("refuses malformed break deltas and snapshots without advancing state", () => {
    const stream = new BreakStream();
    stream.seed({ break: state("granted") });
    expect(stream.apply({ event: { type: "break-state", break: {} } })).not.toEqual([]);
    expect(stream.seed({ break: { approval: "granted" } })).not.toEqual([]);
    expect(stream.needsRecovery).toBe(true);
    expect(stream.apply(event("in-effect"))).not.toEqual([]);
    expect(stream.seed({ break: state("in-effect") })).toEqual([]);
    expect(stream.apply(event("not-requested"))).toEqual([]);
  });

  it("does not claim to detect a stale snapshot or legal-looking old event", () => {
    // No source revision/attempt identity exists: this could be a new request or a delayed old one.
    expect(validateBreakTransition(state("not-requested"), state("awaiting-decision"))).toEqual([]);
    const stream = new BreakStream();
    stream.seed({ break: state("in-effect") });
    expect(stream.apply({ event: { type: "snapshot", snapshot: { break: state("not-requested") } } })).toEqual([]);
  });
});

const context = {
  transport: "active",
  authentication: { status: "authenticated", identity: { id: "agent", displayName: "Agent", timeZone: "UTC" }, capabilities: { breaks: true } },
};
describe("break prerequisites", () => {
  it("checks all four methods against every approval", () => {
    const allowed: Record<BreakMethod, BreakApproval[]> = {
      requestBreak: ["not-requested"], commitBreak: ["granted", "starting-after-task", "in-effect"],
      cancelBreak: ["awaiting-decision", "granted"], endBreak: ["starting-after-task", "in-effect"],
    };
    const approvals: BreakApproval[] = ["not-requested", "awaiting-decision", "granted", "starting-after-task", "in-effect"];
    for (const method of Object.keys(allowed) as BreakMethod[]) for (const approval of approvals) {
      const found = validateBreakCommand(method, method === "requestBreak" ? {} : undefined, state(approval), context);
      expect(found.length === 0, `${method} from ${approval}`).toBe(allowed[method].includes(approval));
    }
  });
  it("requires explicit live capability and active transport on every method", () => {
    for (const method of ["requestBreak", "commitBreak", "cancelBreak", "endBreak"] as const) {
      const current = state(method === "requestBreak" ? "not-requested" : method === "endBreak" ? "in-effect" : "granted");
      for (const invalid of [undefined, {}, { ...context, transport: "connecting" }, { ...context, authentication: { status: "expired" } },
        { ...context, authentication: { ...context.authentication, capabilities: { breaks: false } } }]) {
        expect(validateBreakCommand(method, method === "requestBreak" ? {} : undefined, current, invalid)).not.toEqual([]);
      }
    }
  });
  it("requires published reasons and permits only selected alwaysAvailable exceptions", () => {
    const current = { ...state("not-requested"), mayAsk: false, reasons: [
      { id: "bio", label: "Bio", alwaysAvailable: true }, { id: "lunch", label: "Lunch" },
    ] };
    expect(validateBreakCommand("requestBreak", { reasonId: "bio" }, current, context)).toEqual([]);
    for (const request of [{}, { reason: "Bio" }, { reasonId: "missing" }, { reasonId: "lunch" }, { reasonId: "bio", reason: "" }, null]) {
      expect(validateBreakCommand("requestBreak", request, current, context)).not.toEqual([]);
    }
    expect(validateBreakCommand("requestBreak", { reasonId: "bio" }, state("not-requested"), context)).not.toEqual([]);
    // mayAsk is not a withdrawal of an already granted request.
    expect(validateBreakCommand("commitBreak", undefined, { ...state("granted"), mayAsk: false }, context)).toEqual([]);
  });
  it("forbids agent ending forced breaks and rejects extra arguments or methods", () => {
    expect(validateBreakCommand("endBreak", undefined, { ...state("in-effect"), forced: { by: "lead", endsAutomatically: false } }, context))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: "break.command.end.forced" })]));
    expect(validateBreakCommand("commitBreak", {}, state("granted"), context)).not.toEqual([]);
    expect(validateBreakCommand("bogus" as BreakMethod, undefined, state("granted"), context)).not.toEqual([]);
  });
  it("validates response vocabulary without treating acknowledgments as state", () => {
    for (const [method, status] of [["requestBreak", "requested"], ["commitBreak", "committed"], ["cancelBreak", "cancelled"], ["endBreak", "ended"]] as const) {
      expect(validateResult({ status }, method)).toEqual([]);
      expect(validateResult({ status: "in-effect" }, method)).not.toEqual([]);
    }
    expect(validateResult({ status: "failed", failure: { code: "omni.break-already-committed", message: "Commit won", retryable: false } }, "cancelBreak")).toEqual([]);
  });
  it("requires complete task evidence and keeps a finishing task from becoming an active break", () => {
    expect(validateBreakStatus(state("starting-after-task"), [])).not.toEqual([]);
    expect(validateBreakStatus(state("in-effect"), [{ id: "task", phase: "completing" }])).not.toEqual([]);
    expect(validateBreakStatus(state("in-effect"), [])).toEqual([]);
    expect(validateBreakStatus(state("in-effect"), undefined)).not.toEqual([]);
    expect(validateBreakStatus(state("starting-after-task"), [{ id: "task" }])).toEqual([]);
    const listening = { ...state("in-effect"), activeReasonId: "training", reasons: [{ id: "training", label: "Training", kind: "training" }] };
    expect(validateBreakStatus(listening, [{ listening: {} }])).toEqual([]);
    expect(validateBreakStatus(state("in-effect"), [{ listening: {} }])).not.toEqual([]);
  });
});

describe("lead break prerequisites", () => {
  const lead = { ...context, authentication: { ...context.authentication, capabilities: { team: { breakControl: true } } },
    team: { members: [{ id: "member", availability: "ready", break: "awaiting-decision" }] },
    memberBreak: { ...state("not-requested"), reasons: [{ id: "bio", label: "Bio" }] },
  };
  it("requires current decision eligibility, target membership and explicit lead permission", () => {
    const request = { command: { type: "decide-break-request", memberId: "member", decision: "granted" } };
    expect(validateTeamBreakCommand(request, lead)).toEqual([]);
    expect(validateTeamBreakCommand({ command: { ...request.command, decision: "denied" } }, lead)).toEqual([]);
    expect(validateTeamBreakCommand({ command: { ...request.command, type: "decide" } }, lead).map(v => v.rule)).toContain("team.break.command.type");
    for (const bad of [context, { ...lead, transport: "connecting" }, { ...lead, team: { members: [] } },
      { ...lead, team: { members: [{ id: "member", break: "granted" }] } }]) {
      expect(validateTeamBreakCommand(request, bad)).not.toEqual([]);
    }
    expect(validateTeamBreakCommand({ command: { ...request.command, decision: "maybe" } }, lead)).not.toEqual([]);
  });
  it("rejects the retired command and preserves force prerequisites", () => {
    const command = { type: "force-break", memberId: "member", reasonId: "bio" };
    for (const type of ["place", "force"]) {
      expect(validateTeamBreakCommand({ command: { ...command, type } }, lead).map(v => v.rule)).toContain("team.break.command.type");
    }
    for (const bad of [context, { ...lead, transport: "connecting" }, { ...lead, team: { members: [] } }, { ...lead, memberBreak: undefined }]) {
      expect(validateTeamBreakCommand({ command }, bad)).not.toEqual([]);
    }
  });
  it("rejects the old team end command and preserves its permission and state gates", () => {
    const command = { type: "end-forced-break", memberId: "member" };
    const current = { ...lead, memberBreak: { ...state("in-effect"), forced: { by: "another-lead", endsAutomatically: false } } };
    for (const type of ["release", "end", "end-break"]) {
      expect(validateTeamBreakCommand({ command: { ...command, type } }, current).map(v => v.rule)).toContain("team.break.command.type");
    }
    expect(validateTeamBreakCommand({ command }, lead).map(v => v.rule)).toContain("team.break.command.endForcedBreak");
    for (const bad of [context, { ...current, transport: "connecting" }, { ...current, team: { members: [] } }, { ...current, memberBreak: undefined }]) {
      expect(validateTeamBreakCommand({ command }, bad)).not.toEqual([]);
    }
    expect(validateTeamBreakCommand({ command }, { ...current, memberBreak: { ...current.memberBreak, approval: "starting-after-task" } })).toEqual([]);
  });
  it("checks the forced-break reason and end without assuming the same lead does both", () => {
    expect(validateTeamBreakCommand({ command: { type: "force-break", memberId: "member", reasonId: "bio" } }, lead)).toEqual([]);
    expect(validateTeamBreakCommand({ command: { type: "force-break", memberId: "member" } }, lead)).not.toEqual([]);
    const end = { command: { type: "end-forced-break", memberId: "member" } };
    expect(validateTeamBreakCommand(end, lead)).not.toEqual([]);
    expect(validateTeamBreakCommand(end, { ...lead, memberBreak: { ...state("in-effect"), forced: { by: "another-lead", endsAutomatically: false } } })).toEqual([]);
  });
  it("rejects unsupported policy, malformed commands and extra fields", () => {
    expect(validateTeamBreakCommand({ command: { type: "policy", policy: "suspended" } }, lead)).toEqual([]);
    for (const command of [null, { type: "toString" }, { type: "policy", policy: "anything" }, { type: "policy", policy: "ask", memberId: "member" }]) {
      expect(validateTeamBreakCommand({ command }, lead)).not.toEqual([]);
    }
  });
});
