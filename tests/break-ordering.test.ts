import { describe, expect, it } from "vitest";
import type { BreakStatus, BreakState } from "../src/index.js";
import { validateBreakTransition, validateBreakCommand, validateBreakStatus, validateTeamBreakCommand, validateResult, type BreakMethod } from "../src/validation.js";
import { BreakStream } from "../src/testing.js";

const state = (status: BreakStatus): BreakState => ({ status, canRequestBreak: true });
const event = (status: BreakStatus) => ({ event: { type: "break-state", break: state(status) } });

describe("runtime break ordering", () => {
  it("rejects the retired BreakState field, even alongside status", () => {
    for (const value of [{ approval: "granted", canRequestBreak: true }, { ...state("granted"), approval: "granted" }]) {
      expect(validateBreakStatus(value, []).map(v => v.rule)).toContain("break.status.renamed");
      expect(validateBreakTransition(state("not-requested"), value).map(v => v.rule)).toContain("break.status.renamed");
    }
  });

  it("validates break retry delays and rejects the old or mixed field", () => {
    for (const retryRequestAfterMs of [0, 500, 0.5]) {
      expect(validateBreakStatus({ ...state("not-requested"), retryRequestAfterMs }, [])).toEqual([]);
    }
    for (const retryRequestAfterMs of [-1, Infinity, NaN, "500", null]) {
      expect(validateBreakStatus({ ...state("not-requested"), retryRequestAfterMs }, []).map(v => v.rule)).toContain("break.retryRequestAfterMs");
    }
    for (const fields of [{ retryAfterMs: 500 }, { retryAfterMs: 500, retryRequestAfterMs: 500 }]) {
      expect(validateBreakStatus({ ...state("not-requested"), ...fields }, []).map(v => v.rule)).toContain("break.retryRequestAfterMs.renamed");
    }
  });

  it("rejects the retired active break state", () => {
    const retired = { ...state("on-break"), status: "in-effect" };
    expect(validateBreakStatus(retired, []).map(v => v.rule)).toContain("break.status");
    expect(validateBreakTransition(state("granted"), retired).map(v => v.rule)).toContain("break.status");
  });

  it("rejects the retired request-unavailable reason even alongside the new field", () => {
    for (const fields of [{ refusedReason: "Busy hours" }, { refusedReason: "Busy hours", requestUnavailableReason: "Busy hours" }]) {
      expect(validateBreakStatus({ ...state("not-requested"), canRequestBreak: false, ...fields }, []).map(v => v.rule))
        .toContain("break.requestUnavailableReason.renamed");
    }
    expect(validateBreakStatus({ ...state("not-requested"), canRequestBreak: false, requestUnavailableReason: "" }, []).map(v => v.rule))
      .toContain("break.requestUnavailableReason");
  });

  it("rejects the old eligibility field, including alongside the new field", () => {
    for (const value of [
      { status: "not-requested", mayAsk: true },
      { ...state("not-requested"), mayAsk: true },
    ]) {
      expect(validateBreakStatus(value, []).map(v => v.rule)).toContain("break.canRequestBreak.renamed");
      expect(validateBreakTransition(state("not-requested"), value).map(v => v.rule)).toContain("break.canRequestBreak.renamed");
    }
  });

  it("rejects the retired break field even beside the new field", () => {
    const forced = { by: "manager", endsAutomatically: false };
    for (const fields of [{ imposed: forced }, { imposed: forced, forced }]) {
      const after = { ...state("on-break"), ...fields };
      expect(validateBreakStatus(after, []).map(v => v.rule)).toContain("break.forced.renamed");
      expect(validateBreakTransition(state("not-requested"), after).map(v => v.rule)).toContain("break.forced.renamed");
    }
  });

  it("checks every pair against the allowed event transitions", () => {
    const allowed: Record<BreakStatus, BreakStatus[]> = {
      "not-requested": ["not-requested", "awaiting-decision", "granted"],
      "awaiting-decision": ["not-requested", "awaiting-decision", "granted"],
      granted: ["not-requested", "granted", "starting-after-task", "on-break"],
      "starting-after-task": ["not-requested", "starting-after-task", "on-break"],
      "on-break": ["not-requested", "on-break"],
    };
    const phases = Object.keys(allowed) as BreakStatus[];
    for (const from of phases) for (const to of phases) {
      expect(validateBreakTransition(state(from), state(to)).length === 0, `${from} -> ${to}`)
        .toBe(allowed[from].includes(to));
    }
  });

  it("allows independently evidenced forced breaks, but rejects malformed forced-break evidence", () => {
    const after = { ...state("on-break"), forced: { by: "manager", endsAutomatically: false } };
    expect(validateBreakTransition(state("not-requested"), after)).toEqual([]);
    expect(validateBreakTransition(state("not-requested"), { ...after, forced: {} })).not.toEqual([]);
  });

  it("does not mutate accepted state on a late request, and allows a new attempt after ending", () => {
    const before = Object.freeze(state("on-break"));
    expect(validateBreakTransition(before, state("awaiting-decision")).map(v => v.rule))
      .toContain("stream.breakState.backwards");
    expect(before.status).toBe("on-break");
    expect(validateBreakTransition(before, state("not-requested"))).toEqual([]);
    expect(validateBreakTransition(state("not-requested"), state("awaiting-decision"))).toEqual([]);
  });

  it("rejects malformed previous and next states without throwing", () => {
    for (const bad of [null, undefined, [], {}, { status: "started", canRequestBreak: true }, { status: "granted" }]) {
      expect(validateBreakTransition(bad, state("granted"))).not.toEqual([]);
      expect(validateBreakTransition(state("granted"), bad)).not.toEqual([]);
    }
  });

  it("reseeds from an authoritative snapshot instead of ranking against a former attempt", () => {
    const stream = new BreakStream();
    stream.seed({ break: state("on-break") });
    expect(stream.apply({ event: { type: "snapshot", snapshot: { break: state("awaiting-decision") } } })).toEqual([]);
    expect(stream.apply(event("granted"))).toEqual([]);
    expect(stream.apply(event("on-break"))).toEqual([]);
    // An active snapshot needs no invented request/grant replay.
    stream.seed({ break: state("on-break") });
    expect(stream.apply(event("on-break"))).toEqual([]);
    expect(stream.apply(event("awaiting-decision")).map(v => v.rule)).toContain("stream.breakState.backwards");
  });

  it("requires a snapshot initially and after a rejected delta", () => {
    const stream = new BreakStream();
    expect(stream.needsRecovery).toBe(true);
    expect(stream.apply(event("granted")).map(v => v.rule)).toContain("stream.breakState.baseline");
    expect(stream.seed({ break: state("on-break") })).toEqual([]);
    expect(stream.apply(event("awaiting-decision"))).not.toEqual([]);
    expect(stream.needsRecovery).toBe(true);
    // The rejected request cannot make the following grant appear valid.
    expect(stream.apply(event("granted")).map(v => v.rule)).toContain("stream.breakState.baseline");
    expect(stream.seed({ break: state("not-requested") })).toEqual([]);
    expect(stream.needsRecovery).toBe(false);
    expect(stream.apply(event("awaiting-decision"))).toEqual([]);
    expect(stream.apply(event("granted"))).toEqual([]);
    expect(stream.apply(event("on-break"))).toEqual([]);
  });

  it("requires reseeding after transport loss even when transport becomes active again", () => {
    const stream = new BreakStream();
    stream.seed({ break: state("granted") });
    stream.apply({ event: { type: "transport-status", status: "connecting" } });
    stream.apply({ event: { type: "transport-status", status: "active" } });
    expect(stream.needsRecovery).toBe(true);
    expect(stream.apply(event("on-break"))).not.toEqual([]);
    expect(stream.seed({ break: state("on-break") })).toEqual([]);
    expect(stream.apply(event("not-requested"))).toEqual([]);
  });

  it("refuses malformed break deltas and snapshots without advancing state", () => {
    const stream = new BreakStream();
    stream.seed({ break: state("granted") });
    expect(stream.apply({ event: { type: "break-state", break: {} } })).not.toEqual([]);
    expect(stream.seed({ break: { status: "granted" } })).not.toEqual([]);
    expect(stream.needsRecovery).toBe(true);
    expect(stream.apply(event("on-break"))).not.toEqual([]);
    expect(stream.seed({ break: state("on-break") })).toEqual([]);
    expect(stream.apply(event("not-requested"))).toEqual([]);
  });

  it("does not claim to detect a stale snapshot or legal-looking old event", () => {
    // No source revision/attempt identity exists: this could be a new request or a delayed old one.
    expect(validateBreakTransition(state("not-requested"), state("awaiting-decision"))).toEqual([]);
    const stream = new BreakStream();
    stream.seed({ break: state("on-break") });
    expect(stream.apply({ event: { type: "snapshot", snapshot: { break: state("not-requested") } } })).toEqual([]);
  });
});

const context = {
  transport: "active",
  authentication: { status: "authenticated", identity: { id: "agent", displayName: "Agent", timeZone: "UTC" }, capabilities: { breaks: true } },
};
describe("break prerequisites", () => {
  it("checks all four methods against every approval", () => {
    const allowed: Record<BreakMethod, BreakStatus[]> = {
      requestBreak: ["not-requested"], commitBreak: ["granted", "starting-after-task", "on-break"],
      cancelBreak: ["awaiting-decision", "granted"], endBreak: ["starting-after-task", "on-break"],
    };
    const approvals: BreakStatus[] = ["not-requested", "awaiting-decision", "granted", "starting-after-task", "on-break"];
    for (const method of Object.keys(allowed) as BreakMethod[]) for (const status of approvals) {
      const found = validateBreakCommand(method, method === "requestBreak" ? {} : undefined, state(status), context);
      expect(found.length === 0, `${method} from ${status}`).toBe(allowed[method].includes(status));
    }
  });
  it("requires explicit live capability and active transport on every method", () => {
    for (const method of ["requestBreak", "commitBreak", "cancelBreak", "endBreak"] as const) {
      const current = state(method === "requestBreak" ? "not-requested" : method === "endBreak" ? "on-break" : "granted");
      for (const invalid of [undefined, {}, { ...context, transport: "connecting" }, { ...context, authentication: { status: "expired" } },
        { ...context, authentication: { ...context.authentication, capabilities: { breaks: false } } }]) {
        expect(validateBreakCommand(method, method === "requestBreak" ? {} : undefined, current, invalid)).not.toEqual([]);
      }
    }
  });
  it("requires published reasons and permits only selected alwaysAvailable exceptions", () => {
    const current = { ...state("not-requested"), canRequestBreak: false, reasons: [
      { id: "bio", label: "Bio", alwaysAvailable: true }, { id: "lunch", label: "Lunch" },
    ] };
    expect(validateBreakCommand("requestBreak", { reasonId: "bio" }, current, context)).toEqual([]);
    for (const request of [{}, { reason: "Bio" }, { reasonId: "missing" }, { reasonId: "lunch" }, { reasonId: "bio", reason: "" }, null]) {
      expect(validateBreakCommand("requestBreak", request, current, context)).not.toEqual([]);
    }
    expect(validateBreakCommand("requestBreak", { reasonId: "bio" }, state("not-requested"), context)).not.toEqual([]);
    // canRequestBreak is not a withdrawal of an already granted request.
    expect(validateBreakCommand("commitBreak", undefined, { ...state("granted"), canRequestBreak: false }, context)).toEqual([]);
  });
  it("forbids agent ending forced breaks and rejects extra arguments or methods", () => {
    expect(validateBreakCommand("endBreak", undefined, { ...state("on-break"), forced: { by: "lead", endsAutomatically: false } }, context))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rule: "break.command.end.forced" })]));
    expect(validateBreakCommand("commitBreak", {}, state("granted"), context)).not.toEqual([]);
    expect(validateBreakCommand("bogus" as BreakMethod, undefined, state("granted"), context)).not.toEqual([]);
  });
  it("validates response vocabulary without treating acknowledgments as state", () => {
    for (const [method, status] of [["requestBreak", "requested"], ["commitBreak", "committed"], ["cancelBreak", "cancelled"], ["endBreak", "ended"]] as const) {
      expect(validateResult({ status }, method)).toEqual([]);
      expect(validateResult({ status: "on-break" }, method)).not.toEqual([]);
    }
    expect(validateResult({ status: "failed", failure: { code: "omni.break-already-committed", message: "Commit won", retryable: false } }, "cancelBreak")).toEqual([]);
  });
  it("requires complete task evidence and keeps a finishing task from becoming an active break", () => {
    expect(validateBreakStatus(state("starting-after-task"), [])).not.toEqual([]);
    expect(validateBreakStatus(state("on-break"), [{ id: "task", phase: "completing" }])).not.toEqual([]);
    expect(validateBreakStatus(state("on-break"), [])).toEqual([]);
    expect(validateBreakStatus(state("on-break"), undefined)).not.toEqual([]);
    expect(validateBreakStatus(state("starting-after-task"), [{ id: "task" }])).toEqual([]);
    const listening = { ...state("on-break"), activeReasonId: "training", reasons: [{ id: "training", label: "Training", kind: "training" }] };
    expect(validateBreakStatus(listening, [{ listening: {} }])).toEqual([]);
    expect(validateBreakStatus(state("on-break"), [{ listening: {} }])).not.toEqual([]);
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
    const current = { ...lead, memberBreak: { ...state("on-break"), forced: { by: "another-lead", endsAutomatically: false } } };
    for (const type of ["release", "end", "end-break"]) {
      expect(validateTeamBreakCommand({ command: { ...command, type } }, current).map(v => v.rule)).toContain("team.break.command.type");
    }
    expect(validateTeamBreakCommand({ command }, lead).map(v => v.rule)).toContain("team.break.command.endForcedBreak");
    for (const bad of [context, { ...current, transport: "connecting" }, { ...current, team: { members: [] } }, { ...current, memberBreak: undefined }]) {
      expect(validateTeamBreakCommand({ command }, bad)).not.toEqual([]);
    }
    expect(validateTeamBreakCommand({ command }, { ...current, memberBreak: { ...current.memberBreak, status: "starting-after-task" } })).toEqual([]);
  });
  it("checks the forced-break reason and end without assuming the same lead does both", () => {
    expect(validateTeamBreakCommand({ command: { type: "force-break", memberId: "member", reasonId: "bio" } }, lead)).toEqual([]);
    expect(validateTeamBreakCommand({ command: { type: "force-break", memberId: "member" } }, lead)).not.toEqual([]);
    const end = { command: { type: "end-forced-break", memberId: "member" } };
    expect(validateTeamBreakCommand(end, lead)).not.toEqual([]);
    expect(validateTeamBreakCommand(end, { ...lead, memberBreak: { ...state("on-break"), forced: { by: "another-lead", endsAutomatically: false } } })).toEqual([]);
  });
  it("validates every break policy and rejects the old command name", () => {
    for (const policy of ["suspended", "requests-blocked", "auto-approve"]) {
      expect(validateTeamBreakCommand({ command: { type: "set-break-policy", policy } }, lead).map(v => v.rule)).toContain("team.break.command.policy");
    }
    expect(validateTeamBreakCommand({ command: { type: "set-break-policy", policy: "ask" } }, lead).map(v => v.rule)).toContain("team.break.command.policy");
    for (const policy of ["approval-required", "automatically-approved", "requests-suspended"]) {
      const command = { type: "set-break-policy", policy };
      expect(validateTeamBreakCommand({ command }, lead)).toEqual([]);
      expect(validateTeamBreakCommand({ command: { ...command, type: "policy" } }, lead).map(v => v.rule)).toContain("team.break.command.type");
      for (const bad of [context, { ...lead, transport: "connecting" }]) {
        expect(validateTeamBreakCommand({ command }, bad)).not.toEqual([]);
      }
    }
  });
  it("rejects unsupported policy, malformed commands and extra fields", () => {
    expect(validateTeamBreakCommand({ command: { type: "set-break-policy", policy: "requests-suspended" } }, lead)).toEqual([]);
    for (const command of [null, { type: "toString" }, { type: "set-break-policy", policy: "anything" }, { type: "set-break-policy", policy: "approval-required", memberId: "member" }]) {
      expect(validateTeamBreakCommand({ command }, lead)).not.toEqual([]);
    }
  });
});
