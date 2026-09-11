import { describe, expect, it } from "vitest";
import type { BreakStatus, BreakState } from "../src/index.js";
import { validateBreakTransition, validateBreakCommand, validateBreakStatus, validateTeamCommand, validateResult, type BreakMethod } from "../src/validation.js";
import { BreakStream } from "../src/testing.js";

const state = (status: BreakStatus): BreakState => ({ status, canRequestBreak: true });
const event = (status: BreakStatus) => ({ event: { type: "break-state", break: state(status) } });

describe("runtime break ordering", () => {
  it("rejects the retired awaiting-decision state", () => {
    const retired = { ...state("awaiting-approval"), status: "awaiting-decision" };
    expect(validateBreakStatus(retired, []).map(v => v.rule)).toContain("break.status");
    expect(validateBreakTransition(state("not-requested"), retired).map(v => v.rule)).toContain("break.status");
  });

  it("keeps a break committed when its forced marker is lifted", () => {
    for (const status of ["on-break", "starting-after-task"] as const) {
      const forced = { ...state(status), forced: { by: "lead", expectedDurationMs: 1 } };
      const lifted = state(status);
      expect(validateBreakTransition(forced, lifted)).toEqual([]);
      const stream = new BreakStream();
      const tasks = status === "starting-after-task" ? [{ id: "work" }] : [];
      expect(stream.seed({ break: forced, tasks })).toEqual([]);
      expect(stream.apply({ event: { type: "break-state", break: lifted } })).toEqual([]);
    }
  });

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
    const forced = { by: "manager" };
    for (const fields of [{ imposed: forced }, { imposed: forced, forced }]) {
      const after = { ...state("on-break"), ...fields };
      expect(validateBreakStatus(after, []).map(v => v.rule)).toContain("break.forced.renamed");
      expect(validateBreakTransition(state("not-requested"), after).map(v => v.rule)).toContain("break.forced.renamed");
    }
  });

  it("checks every pair against the allowed event transitions", () => {
    const allowed: Record<BreakStatus, BreakStatus[]> = {
      "not-requested": ["not-requested", "awaiting-approval", "granted"],
      "awaiting-approval": ["not-requested", "awaiting-approval", "granted"],
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
    const after = { ...state("on-break"), forced: { by: "manager" } };
    expect(validateBreakTransition(state("not-requested"), after)).toEqual([]);
    expect(validateBreakTransition(state("not-requested"), { ...after, forced: {} })).not.toEqual([]);
  });

  it("does not mutate accepted state on a late request, and allows a new attempt after ending", () => {
    const before = Object.freeze(state("on-break"));
    expect(validateBreakTransition(before, state("awaiting-approval")).map(v => v.rule))
      .toContain("stream.breakState.backwards");
    expect(before.status).toBe("on-break");
    expect(validateBreakTransition(before, state("not-requested"))).toEqual([]);
    expect(validateBreakTransition(state("not-requested"), state("awaiting-approval"))).toEqual([]);
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
    expect(stream.apply({ event: { type: "snapshot", snapshot: { break: state("awaiting-approval") } } })).toEqual([]);
    expect(stream.apply(event("granted"))).toEqual([]);
    expect(stream.apply(event("on-break"))).toEqual([]);
    // An active snapshot needs no invented request/grant replay.
    stream.seed({ break: state("on-break") });
    expect(stream.apply(event("on-break"))).toEqual([]);
    expect(stream.apply(event("awaiting-approval")).map(v => v.rule)).toContain("stream.breakState.backwards");
  });

  it("requires a snapshot initially and after a rejected delta", () => {
    const stream = new BreakStream();
    expect(stream.needsRecovery).toBe(true);
    expect(stream.apply(event("granted")).map(v => v.rule)).toContain("stream.breakState.baseline");
    expect(stream.seed({ break: state("on-break") })).toEqual([]);
    expect(stream.apply(event("awaiting-approval"))).not.toEqual([]);
    expect(stream.needsRecovery).toBe(true);
    // The rejected request cannot make the following grant appear valid.
    expect(stream.apply(event("granted")).map(v => v.rule)).toContain("stream.breakState.baseline");
    expect(stream.seed({ break: state("not-requested") })).toEqual([]);
    expect(stream.needsRecovery).toBe(false);
    expect(stream.apply(event("awaiting-approval"))).toEqual([]);
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
    expect(validateBreakTransition(state("not-requested"), state("awaiting-approval"))).toEqual([]);
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
  it("allows an agent request without explanatory text with or without reason choices", () => {
    expect(validateBreakCommand("requestBreak", {}, state("not-requested"), context)).toEqual([]);
    expect(validateBreakCommand("requestBreak", { reasonId: "lunch" }, {
      ...state("not-requested"), reasons: [{ id: "lunch", label: "Lunch" }],
    }, context)).toEqual([]);
  });

  it("checks all four methods against every approval", () => {
    const allowed: Record<BreakMethod, BreakStatus[]> = {
      requestBreak: ["not-requested"], commitBreak: ["granted", "starting-after-task", "on-break"],
      cancelBreak: ["awaiting-approval", "granted"], endBreak: ["starting-after-task", "on-break"],
    };
    const approvals: BreakStatus[] = ["not-requested", "awaiting-approval", "granted", "starting-after-task", "on-break"];
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
  it("allows agents to end forced breaks and rejects extra arguments or methods", () => {
    expect(validateBreakCommand("endBreak", undefined, { ...state("on-break"), forced: { by: "lead" } }, context))
      .toEqual([]);
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
    // The one task a break in effect may hold is a call a lead took over: the provider assigns it whatever break the lead is on.
    expect(validateBreakStatus(state("on-break"), [{ takenOver: { memberId: "A-1", since: "2026-08-21T09:00:00Z" } }])).toEqual([]);
    expect(validateBreakStatus(state("on-break"), [{ takenOver: { memberId: "A-1", since: "2026-08-21T09:00:00Z" } }, { id: "task" }])).not.toEqual([]);
  });
});

describe("lead commands", () => {
  const lead = { ...context, authentication: { ...context.authentication, capabilities: { lead: true as const } },
    team: { members: [{ id: "member", availability: "ready", break: "awaiting-approval" }] },
    memberBreak: { ...state("not-requested"), reasons: [{ id: "bio", label: "Bio" }] },
  };
  it("requires current decision eligibility, target membership and explicit lead permission", () => {
    const request = { command: { type: "decide-break-request", memberId: "member", decision: "granted" } };
    expect(validateTeamCommand(request, lead)).toEqual([]);
    expect(validateTeamCommand({ command: { ...request.command, decision: "denied" } }, lead)).toEqual([]);
    expect(validateTeamCommand({ command: { ...request.command, type: "decide" } }, lead).map(v => v.rule)).toContain("team.command.type");
    for (const bad of [context, { ...lead, transport: "connecting" }, { ...lead, team: { members: [] } },
      { ...lead, team: { members: [{ id: "member", break: "granted" }] } }]) {
      expect(validateTeamCommand(request, bad)).not.toEqual([]);
    }
    expect(validateTeamCommand({ command: { ...request.command, decision: "maybe" } }, lead)).not.toEqual([]);
  });
  it("rejects the retired command and preserves force prerequisites", () => {
    const command = { type: "force-break", memberId: "member", reasonId: "bio" };
    for (const type of ["place", "force"]) {
      expect(validateTeamCommand({ command: { ...command, type } }, lead).map(v => v.rule)).toContain("team.command.type");
    }
    for (const bad of [context, { ...lead, transport: "connecting" }, { ...lead, team: { members: [] } }, { ...lead, memberBreak: undefined }]) {
      expect(validateTeamCommand({ command }, bad)).not.toEqual([]);
    }
  });
  it("rejects the old team end command and preserves its permission and state gates", () => {
    const command = { type: "end-forced-break", memberId: "member" };
    const current = { ...lead, memberBreak: { ...state("on-break"), forced: { by: "another-lead" } } };
    for (const type of ["release", "end", "end-break"]) {
      expect(validateTeamCommand({ command: { ...command, type } }, current).map(v => v.rule)).toContain("team.command.type");
    }
    expect(validateTeamCommand({ command }, lead).map(v => v.rule)).toContain("team.command.endForcedBreak");
    for (const bad of [context, { ...current, transport: "connecting" }, { ...current, team: { members: [] } }, { ...current, memberBreak: undefined }]) {
      expect(validateTeamCommand({ command }, bad)).not.toEqual([]);
    }
    expect(validateTeamCommand({ command }, { ...current, memberBreak: { ...current.memberBreak, status: "starting-after-task" } })).toEqual([]);
  });
  it("allows a lead to force a break without explanatory text", () => {
    expect(validateTeamCommand({ command: { type: "force-break", memberId: "member", reasonId: "bio" } }, lead)).toEqual([]);
    expect(validateTeamCommand({ command: { type: "force-break", memberId: "member" } }, {
      ...lead, memberBreak: state("not-requested"),
    })).toEqual([]);
  });
  it("accepts an optional expected duration on force-break and rejects timer controls", () => {
    const command = { type: "force-break", memberId: "member", reasonId: "bio" };
    expect(validateTeamCommand({ command: { ...command, expectedDurationMs: 600000 } }, lead)).toEqual([]);
    for (const expectedDurationMs of [0, -1, Infinity, NaN, "500", null]) {
      expect(validateTeamCommand({ command: { ...command, expectedDurationMs } }, lead).map(v => v.rule)).toContain("team.command.expectedDurationMs");
    }
    expect(validateTeamCommand({ command: { ...command, endsAutomatically: true } }, lead).map(v => v.rule)).toContain("team.command.field");
  });
  it("checks the forced-break reason and end without assuming the same lead does both", () => {
    expect(validateTeamCommand({ command: { type: "force-break", memberId: "member", reasonId: "bio" } }, lead)).toEqual([]);
    expect(validateTeamCommand({ command: { type: "force-break", memberId: "member" } }, lead)).not.toEqual([]);
    const end = { command: { type: "end-forced-break", memberId: "member" } };
    expect(validateTeamCommand(end, lead)).not.toEqual([]);
    expect(validateTeamCommand(end, { ...lead, memberBreak: { ...state("on-break"), forced: { by: "another-lead" } } })).toEqual([]);
  });
  it("validates every break policy and rejects the old command name", () => {
    for (const policy of ["suspended", "requests-blocked", "auto-approve"]) {
      expect(validateTeamCommand({ command: { type: "set-break-policy", policy } }, lead).map(v => v.rule)).toContain("team.command.policy");
    }
    expect(validateTeamCommand({ command: { type: "set-break-policy", policy: "ask" } }, lead).map(v => v.rule)).toContain("team.command.policy");
    for (const policy of ["approval-required", "automatically-approved", "requests-suspended"]) {
      const command = { type: "set-break-policy", policy };
      expect(validateTeamCommand({ command }, lead)).toEqual([]);
      expect(validateTeamCommand({ command: { ...command, type: "policy" } }, lead).map(v => v.rule)).toContain("team.command.type");
      for (const bad of [context, { ...lead, transport: "connecting" }]) {
        expect(validateTeamCommand({ command }, bad)).not.toEqual([]);
      }
    }
  });
  it("names the member on every act on a member's call, and holds each to what the team member list shows", () => {
    const at = "2026-08-21T09:04:00Z";
    const onCall = { ...lead, team: { members: [{ id: "member", availability: "on-task", tasks: [{ assignmentId: "alloc-7", title: "Call", channel: "voice", taskType: "Queue", phase: "in-progress" }], request: { assignmentId: "alloc-7", since: at } },
      { id: "listened", availability: "on-task", listening: { assignmentId: "alloc-9", mode: "listen", since: at } }] } };
    for (const type of ["listen", "take-over-call", "join", "decline"]) {
      expect(validateTeamCommand({ command: { type, memberId: "member" } }, onCall)).toEqual([]);
      expect(validateTeamCommand({ command: { type, memberId: "member", assignmentId: "alloc-7" } }, onCall)).toEqual([]);
      expect(validateTeamCommand({ command: { type, memberId: "member", assignmentId: "alloc-9" } }, onCall).map(v => v.rule)).toContain("team.command.assignmentId.unknown");
      expect(validateTeamCommand({ command: { type, memberId: "nobody" } }, onCall).map(v => v.rule)).toContain("team.command.member");
      expect(validateTeamCommand({ command: { type } }, onCall).map(v => v.rule)).toContain("team.command.member");
    }
    // Join and decline answer the request the member carries; the listened member has none, and
    // the asking member's request names one assignment, not another they hold.
    for (const type of ["join", "decline"]) {
      expect(validateTeamCommand({ command: { type, memberId: "listened" } }, onCall).map(v => v.rule)).toContain("team.command.request");
      const twoCalls = { ...onCall, team: { members: [{ ...onCall.team.members[0]!, tasks: [...onCall.team.members[0]!.tasks!, { assignmentId: "alloc-8", title: "Call", channel: "voice", taskType: "Queue", phase: "in-progress" }] }] } };
      expect(validateTeamCommand({ command: { type, memberId: "member", assignmentId: "alloc-8" } }, twoCalls).map(v => v.rule)).toContain("team.command.request");
      expect(validateTeamCommand({ command: { type, memberId: "member", assignmentId: "alloc-7" } }, twoCalls)).toEqual([]);
    }
    // Coach, join-call and leave need the lead on that member's call already.
    for (const type of ["coach", "join-call", "leave"]) {
      expect(validateTeamCommand({ command: { type, memberId: "listened" } }, onCall)).toEqual([]);
      expect(validateTeamCommand({ command: { type, memberId: "member" } }, onCall).map(v => v.rule)).toContain("team.command.listening");
    }
    // The former listen and lead-assist shapes name nobody, and are refused.
    expect(validateTeamCommand({ command: { type: "coach" } }, onCall).map(v => v.rule)).toContain("team.command.member");
    expect(validateTeamCommand({ command: { type: "join", requestId: "req-7" } }, onCall).map(v => v.rule)).toContain("team.command.field");
    expect(validateTeamCommand({ command: { type: "listen", memberId: "member" } }, { ...onCall, authentication: { ...onCall.authentication, capabilities: {} } }).map(v => v.rule)).toContain("team.command.capability");
  });
  it("switches the team feature on and off, and sets a policy, as lead commands", () => {
    for (const enabled of [true, false]) expect(validateTeamCommand({ command: { type: "lead-features", enabled } }, lead)).toEqual([]);
    expect(validateTeamCommand({ command: { type: "lead-features", enabled: "yes" } }, lead).map(v => v.rule)).toContain("team.command.enabled");
    expect(validateTeamCommand({ command: { type: "lead-features" } }, lead).map(v => v.rule)).toContain("team.command.enabled");
    expect(validateTeamCommand({ command: { type: "set-policy", capability: "hold", setting: "person" } }, lead)).toEqual([]);
    expect(validateTeamCommand({ command: { type: "set-policy", capability: "skill:billing", setting: "off" } }, lead)).toEqual([]);
    expect(validateTeamCommand({ command: { type: "set-policy", capability: "connectBack", setting: "person" } }, lead).map(v => v.rule)).toContain("team.command.setting.person");
    expect(validateTeamCommand({ command: { type: "set-policy", capability: "mute", setting: "off" } }, lead).map(v => v.rule)).toContain("team.command.capability.key");
    expect(validateTeamCommand({ command: { type: "set-policy", capability: "hold", setting: "maybe" } }, lead).map(v => v.rule)).toContain("team.command.setting");
    // The former one-word policy command is refused.
    expect(validateTeamCommand({ command: { type: "set", capability: "hold", setting: "on" } }, lead).map(v => v.rule)).toContain("team.command.type");
  });
  it("rejects unsupported policy, malformed commands and extra fields", () => {
    expect(validateTeamCommand({ command: { type: "set-break-policy", policy: "requests-suspended" } }, lead)).toEqual([]);
    for (const command of [null, { type: "toString" }, { type: "set-break-policy", policy: "anything" }, { type: "set-break-policy", policy: "approval-required", memberId: "member" }]) {
      expect(validateTeamCommand({ command }, lead)).not.toEqual([]);
    }
  });
});
