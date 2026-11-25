import { describe, expect, it } from "vitest";
import type { BreakStatus, BreakState } from "../src/index.js";
import { validateBreakTransition, validateBreakCommand, validateBreakStatus, validateTeamCommand, validateResult, type BreakMethod } from "../src/validation.js";
import { BreakStream } from "../src/testing.js";

const EVERY_LEAD_CAPABILITY = { join: true, decline: true, listen: true, coach: true, joinCall: true, takeOverCall: true, decideBreakRequest: true, setBreakPolicy: true, promptBreak: true, ban: true, setPolicy: true } as const;

// A break in effect says which kind it is; these are the agent's own.
const state = (status: BreakStatus): BreakState =>
  ({ status, canRequestBreak: true, ...(status === "on-break" || status === "starting-after-task" ? { type: "break" } : {}) });
const event = (status: BreakStatus) => ({ event: { type: "break-state", break: state(status) } });

describe("runtime break ordering", () => {
  it("rejects the retired awaiting-decision state", () => {
    const retired = { ...state("awaiting-approval"), status: "awaiting-decision" };
    expect(validateBreakStatus(retired, []).map(v => v.rule)).toContain("break.status");
    expect(validateBreakTransition(state("not-requested"), retired).map(v => v.rule)).toContain("break.status");
  });

  it("lets only the platform's own break arrive in effect unasked", () => {
    const reasons = [{ id: "lunch", label: "Lunch" }, { id: "no-answer", label: "No answer", providerOnly: true }];
    const own = { ...state("on-break"), reasons, activeReasonId: "no-answer" };
    const asked = { ...state("on-break"), reasons, activeReasonId: "lunch" };
    expect(validateBreakTransition({ ...state("not-requested"), reasons }, own)).toEqual([]);
    expect(validateBreakTransition({ ...state("not-requested"), reasons }, asked).map(v => v.rule)).toEqual(["stream.breakState.commitBeforeGrant"]);
    // The agent ends the platform's own break, as any break.
    expect(validateBreakTransition(own, { ...state("not-requested"), reasons })).toEqual([]);
    const stream = new BreakStream();
    expect(stream.seed({ break: { ...state("not-requested"), reasons }, tasks: [] })).toEqual([]);
    expect(stream.apply({ event: { type: "break-state", break: own } })).toEqual([]);
  });

  it("makes a missed offer on a softphone tools not ready, and only on a hardphone a break", () => {
    const reasons = [{ id: "lunch", label: "Lunch" }, { id: "no-answer", label: "No answer", providerOnly: true }];
    const missed = { ...state("on-break"), reasons, activeReasonId: "no-answer" };
    const held = { ...missed, type: "tools-not-ready" as const };
    const softphone = new BreakStream({ softphone: true });
    expect(softphone.seed({ break: { ...state("not-requested"), reasons }, tasks: [] })).toEqual([]);
    expect(softphone.apply({ event: { type: "break-state", break: missed } }).map(v => v.rule)).toEqual(["stream.breakState.softphone"]);
    expect(softphone.seed({ break: missed, tasks: [] }).map(v => v.rule)).toEqual(["stream.breakState.softphone"]);
    expect(softphone.seed({ break: { ...state("not-requested"), reasons }, tasks: [] })).toEqual([]);
    expect(softphone.apply({ event: { type: "break-state", break: held } })).toEqual([]);
    // The agent's own break is theirs on any phone.
    const lunch = new BreakStream({ softphone: true });
    lunch.seed({ break: { ...state("granted"), reasons, activeReasonId: "lunch" }, tasks: [] });
    expect(lunch.apply({ event: { type: "break-state", break: { ...state("on-break"), reasons, activeReasonId: "lunch" } } })).toEqual([]);
    const hardphone = new BreakStream({ softphone: false });
    hardphone.seed({ break: { ...state("not-requested"), reasons }, tasks: [] });
    expect(hardphone.apply({ event: { type: "break-state", break: missed } })).toEqual([]);
  });

  it("says which kind every break in effect is, and carries a ban's terms on a ban alone", () => {
    const ban = { by: "lead", reason: "Compliance review", endsInSeconds: 3600 };
    const tools = [{ id: "no-phone", label: "No phone", providerOnly: true }, { id: "lunch", label: "Lunch" }];
    expect(validateBreakStatus({ status: "on-break", canRequestBreak: false }, []).map(v => v.rule)).toEqual(["break.type.required"]);
    expect(validateBreakStatus({ ...state("not-requested"), type: "break" }, []).map(v => v.rule)).toEqual(["break.type.status"]);
    expect(validateBreakStatus({ ...state("on-break"), type: "lunch" } as unknown as BreakState, []).map(v => v.rule)).toEqual(["break.type"]);
    expect(validateBreakStatus({ ...state("on-break"), type: "ban", ban }, [])).toEqual([]);
    expect(validateBreakStatus({ ...state("on-break"), type: "ban" }, []).map(v => v.rule)).toEqual(["break.ban.required"]);
    expect(validateBreakStatus({ ...state("on-break"), ban }, []).map(v => v.rule)).toEqual(["break.ban.type"]);
    expect(validateBreakStatus({ ...state("on-break"), type: "ban", ban: { by: "" } }, []).map(v => v.rule)).toEqual(["ban.by"]);
    // A ban names no break reason; tools not ready is always on the platform's own.
    expect(validateBreakStatus({ ...state("on-break"), type: "ban", ban, reasons: tools }, [])).toEqual([]);
    expect(validateBreakStatus({ ...state("on-break"), type: "ban", ban, reasons: tools, activeReasonId: "lunch" }, []).map(v => v.rule)).toEqual(["break.activeReasonId.ban"]);
    expect(validateBreakStatus({ ...state("on-break"), type: "tools-not-ready", reasons: tools, activeReasonId: "no-phone" }, [])).toEqual([]);
    expect(validateBreakStatus({ ...state("on-break"), type: "tools-not-ready", reasons: tools, activeReasonId: "lunch" }, []).map(v => v.rule)).toEqual(["break.activeReasonId.toolsNotReady"]);
    // A task in hand runs to its end first, whatever the kind.
    expect(validateBreakStatus({ ...state("starting-after-task"), type: "ban", ban }, [{ id: "work" }])).toEqual([]);
  });

  it("lets a ban and tools not ready arrive unasked, and a ban end a break, but no break follow them", () => {
    const ban = { ...state("on-break"), type: "ban" as const, ban: { by: "lead" } };
    const tools = { ...state("on-break"), type: "tools-not-ready" as const };
    for (const arrived of [ban, tools]) expect(validateBreakTransition(state("not-requested"), arrived)).toEqual([]);
    expect(validateBreakTransition(state("on-break"), ban)).toEqual([]);
    expect(validateBreakTransition(tools, ban)).toEqual([]);
    // When a ban lifts and the tools are still not ready, tools not ready follows.
    expect(validateBreakTransition(ban, tools)).toEqual([]);
    for (const before of [ban, tools]) {
      expect(validateBreakTransition(before, state("on-break")).map(v => v.rule)).toEqual(["stream.breakState.commitBeforeGrant"]);
      expect(validateBreakTransition(before, state("not-requested"))).toEqual([]);
    }
  });

  it("takes an accepted ask to granted, and a declined one back to not-requested", () => {
    const ask = { id: "prompt-1", by: "lead", since: "2026-11-25T14:00:00Z" };
    const asked = { ...state("not-requested"), pendingPrompt: ask };
    expect(validateBreakTransition(state("not-requested"), asked)).toEqual([]);
    expect(validateBreakTransition(asked, state("granted"))).toEqual([]);
    expect(validateBreakTransition(asked, state("not-requested"))).toEqual([]);
    // A prompt stands only beside not-requested: a break under way answers or overtakes it.
    for (const status of ["awaiting-approval", "granted", "starting-after-task", "on-break"] as const) {
      expect(validateBreakStatus({ ...state(status), pendingPrompt: ask }, status === "starting-after-task" ? [{ id: "work" }] : []).map(v => v.rule), status).toEqual(["break.pendingPrompt.status"]);
    }
  });

  it("rejects the retired BreakState field, even alongside status", () => {
    for (const value of [{ approval: "granted", canRequestBreak: true }, { ...state("granted"), approval: "granted" }]) {
      expect(validateBreakStatus(value, []).map(v => v.rule)).toContain("break.status.renamed");
      expect(validateBreakTransition(state("not-requested"), value).map(v => v.rule)).toContain("break.status.renamed");
    }
  });

  it("validates break retry delays and rejects the old or mixed field", () => {
    for (const retryRequestInSeconds of [0, 300]) {
      expect(validateBreakStatus({ ...state("not-requested"), retryRequestInSeconds }, [])).toEqual([]);
    }
    for (const retryRequestInSeconds of [-1, 0.5, Infinity, NaN, "500", null]) {
      expect(validateBreakStatus({ ...state("not-requested"), retryRequestInSeconds }, []).map(v => v.rule)).toContain("break.retryRequestInSeconds");
    }
    for (const fields of [{ retryAfterMs: 500 }, { retryRequestAfterMs: 500 }, { retryRequestAfterMs: 500, retryRequestInSeconds: 1 }]) {
      expect(validateBreakStatus({ ...state("not-requested"), ...fields }, []).map(v => v.rule)).toContain("break.retryRequestInSeconds.renamed");
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

  it("refuses a forced break, retired along with the field it was renamed from", () => {
    const forced = { by: "manager", scope: "agent" };
    for (const fields of [{ imposed: forced }, { forced }]) {
      const after = { ...state("on-break"), ...fields };
      expect(validateBreakStatus(after, []).map(v => v.rule)).toContain("break.forced.retired");
      expect(validateBreakTransition(state("not-requested"), after).map(v => v.rule)).toContain("break.forced.retired");
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
  levels: ["org", "site", "team", "person"],
  authentication: { status: "authenticated", identity: { id: "agent", displayName: "Agent", timeZone: "UTC" }, capabilities: { breaks: true } },
};
describe("break prerequisites", () => {
  it("allows an agent request without explanatory text with or without reason choices", () => {
    expect(validateBreakCommand("requestBreak", {}, state("not-requested"), context)).toEqual([]);
    expect(validateBreakCommand("requestBreak", { reasonId: "lunch" }, {
      ...state("not-requested"), reasons: [{ id: "lunch", label: "Lunch" }],
    }, context)).toEqual([]);
  });

  it("checks all five methods against every approval", () => {
    // With no ask standing there is nothing to answer, whatever the break.
    const allowed: Record<BreakMethod, BreakStatus[]> = {
      requestBreak: ["not-requested"], commitBreak: ["granted", "starting-after-task", "on-break"],
      cancelBreak: ["awaiting-approval", "granted"], endBreak: ["starting-after-task", "on-break"], answerPrompt: [],
    };
    const approvals: BreakStatus[] = ["not-requested", "awaiting-approval", "granted", "starting-after-task", "on-break"];
    for (const method of Object.keys(allowed) as BreakMethod[]) for (const status of approvals) {
      const request = method === "requestBreak" ? {} : method === "answerPrompt" ? { promptId: "prompt-1", answer: "accepted" } : undefined;
      const found = validateBreakCommand(method, request, state(status), context);
      expect(found.length === 0, `${method} from ${status}`).toBe(allowed[method].includes(status));
    }
  });
  it("validates the session against the manifest's levels, which the context carries", () => {
    const decided = { ...context, authentication: { ...context.authentication, capabilities: { breaks: true, preferences: [{ id: "hold", label: "Hold", enabled: true, setBy: "team" }] } } };
    const rules = (found: readonly { rule: string }[]) => found.map(violation => violation.rule);
    expect(rules(validateBreakCommand("requestBreak", {}, state("not-requested"), decided))).toEqual([]);
    expect(rules(validateBreakCommand("requestBreak", {}, state("not-requested"), { ...decided, levels: ["org", "person"] }))).toEqual(["preference.setBy.unknown"]);
    expect(rules(validateBreakCommand("requestBreak", {}, state("not-requested"), { ...decided, levels: undefined }))).toContain("break.command.levels");
    expect(rules(validateTeamCommand({ command: { type: "set-team-features", enabled: true } }, { ...decided, levels: undefined }))).toContain("team.command.levels");
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
    // The provider's own reason is offered to nobody, even where asking is open.
    const own = { ...state("not-requested"), reasons: [{ id: "lunch", label: "Lunch" }, { id: "no-phone", label: "No phone", providerOnly: true }] };
    expect(validateBreakCommand("requestBreak", { reasonId: "lunch" }, own, context)).toEqual([]);
    expect(validateBreakCommand("requestBreak", { reasonId: "no-phone" }, own, context).map(v => v.rule)).toEqual(["break.request.reasonId.providerOnly"]);
    // canRequestBreak is not a withdrawal of an already granted request.
    expect(validateBreakCommand("commitBreak", undefined, { ...state("granted"), canRequestBreak: false }, context)).toEqual([]);
  });
  it("answers the prompt the break state carries, by its id", () => {
    const asked = { ...state("not-requested"), pendingPrompt: { id: "prompt-1", by: "lead", since: "2026-11-25T14:00:00Z" } };
    for (const answer of ["accepted", "declined"]) expect(validateBreakCommand("answerPrompt", { promptId: "prompt-1", answer }, asked, context)).toEqual([]);
    expect(validateBreakCommand("answerPrompt", { promptId: "prompt-0", answer: "accepted" }, asked, context).map(v => v.rule)).toEqual(["break.command.answer.prompt"]);
    expect(validateBreakCommand("answerPrompt", { promptId: "prompt-1", answer: "maybe" }, asked, context).map(v => v.rule)).toEqual(["break.answer.answer"]);
    expect(validateBreakCommand("answerPrompt", { promptId: "prompt-1", answer: "accepted", note: "x" }, asked, context).map(v => v.rule)).toEqual(["break.answer.field"]);
    expect(validateBreakCommand("answerPrompt", undefined, asked, context).map(v => v.rule)).toEqual(["break.answer.shape"]);
  });
  it("lets the agent end a break, and neither a ban nor tools not ready", () => {
    for (const status of ["on-break", "starting-after-task"] as const) expect(validateBreakCommand("endBreak", undefined, state(status), context)).toEqual([]);
    expect(validateBreakCommand("endBreak", undefined, { ...state("on-break"), type: "ban", ban: { by: "lead" } }, context).map(v => v.rule)).toEqual(["break.command.end.type"]);
    expect(validateBreakCommand("endBreak", undefined, { ...state("on-break"), type: "tools-not-ready" }, context).map(v => v.rule)).toEqual(["break.command.end.type"]);
    // Banned, the agent cannot ask for a break either: a request starts only from not-requested.
    expect(validateBreakCommand("requestBreak", {}, { ...state("on-break"), type: "ban", ban: { by: "lead" } }, context).map(v => v.rule)).toEqual(["break.command.request.pending"]);
  });
  it("rejects extra arguments or methods", () => {
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
  const lead = { ...context, authentication: { ...context.authentication, capabilities: { lead: EVERY_LEAD_CAPABILITY } },
    team: { members: [{ id: "member", availability: "ready", break: "awaiting-approval" }] },
    memberBreak: { ...state("not-requested"), reasons: [{ id: "bio", label: "Bio" }] },
  };
  it("lets a lead send only the commands its lead capabilities allow", () => {
    const rules = (found: readonly { rule: string }[]) => found.map(violation => violation.rule);
    const holding = (granted: Record<string, true>) => ({ ...lead, authentication: { ...lead.authentication, capabilities: { lead: granted } } });
    const teamLead = holding({ decideBreakRequest: true, listen: true });
    const decide = { command: { type: "decide-break-request", memberId: "member", decision: "granted" } };
    const ban = { command: { type: "ban", memberId: "member" } };
    expect(rules(validateTeamCommand(decide, teamLead))).toEqual([]);
    expect(rules(validateTeamCommand(ban, teamLead))).toEqual(["team.command.notGranted"]);
    expect(rules(validateTeamCommand(ban, holding({ ban: true })))).toEqual([]);
    // Switching the team feature is every lead's.
    expect(rules(validateTeamCommand({ command: { type: "lead-features", enabled: true } }, teamLead))).toEqual([]);
  });

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
  it("refuses the retired forced-break commands, which have no alias", () => {
    for (const command of [{ type: "force-break", memberId: "member", reasonId: "bio" }, { type: "end-forced-break", memberId: "member" },
      { type: "force-team-break", reasonId: "bio", durationSeconds: 1800 }, { type: "end-team-break" }, { type: "place", memberId: "member" }]) {
      expect(validateTeamCommand({ command }, lead).map(v => v.rule), command.type).toEqual(["team.command.type"]);
    }
  });
  describe("asking a member for a break", () => {
    const idle = { ...lead, team: { members: [{ id: "member", availability: "ready" }] } };
    const rules = (found: readonly { rule: string }[]) => found.map(violation => violation.rule);
    const ask = { command: { type: "prompt-break", memberId: "member", reasonId: "bio", reason: "Training, room 4", durationSeconds: 1800 } };
    it("asks a signed-in member with no break of their own, on a published reason that is not the provider's own", () => {
      expect(rules(validateTeamCommand(ask, idle))).toEqual([]);
      expect(rules(validateTeamCommand({ command: { type: "prompt-break", memberId: "member", reasonId: "bio" } }, idle))).toEqual([]);
      expect(rules(validateTeamCommand({ command: { type: "prompt-break", memberId: "member" } }, idle))).toEqual(["team.command.reasonId"]);
      expect(rules(validateTeamCommand({ command: { type: "prompt-break", memberId: "member" } }, { ...idle, memberBreak: state("not-requested") }))).toEqual([]);
      const own = { ...idle, memberBreak: { ...state("not-requested"), reasons: [{ id: "bio", label: "Bio" }, { id: "no-answer", label: "No answer", providerOnly: true }] } };
      expect(rules(validateTeamCommand({ command: { ...ask.command, reasonId: "no-answer" } }, own))).toEqual(["team.command.reasonId.providerOnly"]);
      expect(rules(validateTeamCommand({ command: { ...ask.command, durationSeconds: 0 } }, idle))).toEqual(["team.command.durationSeconds"]);
      expect(rules(validateTeamCommand({ command: { ...ask.command, reason: "" } }, idle))).toEqual(["team.command.reason"]);
      expect(rules(validateTeamCommand(ask, { ...idle, memberBreak: undefined }))).not.toEqual([]);
    });
    it("asks one at a time, and only a member who is here with no break under way", () => {
      const member = (over: Record<string, unknown>) => ({ ...idle, team: { members: [{ id: "member", availability: "ready", ...over }] } });
      const standing = { id: "prompt-1", by: "agent", since: "2026-11-25T14:00:00Z" };
      expect(rules(validateTeamCommand(ask, member({ pendingPrompt: standing })))).toEqual(["team.command.promptBreak.standing"]);
      expect(rules(validateTeamCommand(ask, member({ pendingPrompt: { ...standing, declinedAt: "2026-11-25T14:01:00Z" } })))).toEqual([]);
      for (const over of [{ availability: "on-break" }, { availability: "signed-out" }, { break: "awaiting-approval" }]) {
        expect(rules(validateTeamCommand(ask, member(over))), JSON.stringify(over)).toEqual(["team.command.promptBreak.member"]);
      }
      // Nothing overlaps: a banned member, or one with tools not ready, is not asked.
      for (const over of [{ availability: "banned", ban: { by: "lead" } }, { availability: "on-task", ban: { by: "lead" } }, { availability: "tools-not-ready" }]) {
        expect(rules(validateTeamCommand(ask, member(over))), JSON.stringify(over)).toEqual(["team.command.promptBreak.member"]);
      }
    });
    it("withdraws only a prompt the list shows, under the same capability", () => {
      const withdraw = { command: { type: "withdraw-prompt", memberId: "member" } };
      const asked = { ...idle, team: { members: [{ id: "member", availability: "ready", pendingPrompt: { id: "prompt-1", by: "agent", since: "2026-11-25T14:00:00Z" } }] } };
      expect(rules(validateTeamCommand(withdraw, asked))).toEqual([]);
      expect(rules(validateTeamCommand(withdraw, idle))).toEqual(["team.command.withdrawPrompt"]);
      const without = { ...asked, authentication: { ...lead.authentication, capabilities: { lead: { ban: true } } } };
      expect(rules(validateTeamCommand(withdraw, without))).toEqual(["team.command.notGranted"]);
      expect(rules(validateTeamCommand(ask, { ...without, team: idle.team }))).toEqual(["team.command.notGranted"]);
    });
  });
  it("places a ban on a member without one, and lifts only a lead's ban the list shows", () => {
    const rules = (found: readonly { rule: string }[]) => found.map(violation => violation.rule);
    const ban = { command: { type: "ban", memberId: "member", reason: "Compliance review", durationSeconds: 3600 } };
    const liftBan = { command: { type: "lift-ban", memberId: "member" } };
    const banned = { ...lead, team: { members: [{ id: "member", availability: "signed-out", ban: { by: "lead" } }] } };
    expect(rules(validateTeamCommand(ban, lead))).toEqual([]);
    expect(rules(validateTeamCommand({ command: { type: "ban", memberId: "member" } }, lead))).toEqual([]);
    expect(rules(validateTeamCommand(ban, banned))).toEqual(["team.command.ban.standing"]);
    expect(rules(validateTeamCommand(liftBan, banned))).toEqual([]);
    expect(rules(validateTeamCommand(liftBan, lead))).toEqual(["team.command.liftBan"]);
    // The platform lifts a ban it placed itself.
    const byProvider = { ...lead, team: { members: [{ id: "member", availability: "banned", ban: { by: "provider", reason: "Phone not registered" } }] } };
    expect(rules(validateTeamCommand(liftBan, byProvider))).toEqual(["team.command.liftBan.provider"]);
    expect(rules(validateTeamCommand({ command: { ...ban.command, durationSeconds: 0 } }, lead))).toEqual(["team.command.durationSeconds"]);
    expect(rules(validateTeamCommand({ command: { ...ban.command, reason: "" } }, lead))).toEqual(["team.command.reason"]);
    expect(rules(validateTeamCommand({ command: { ...liftBan.command, reason: "x" } }, banned))).toEqual(["team.command.field"]);
    // Placing and lifting a ban is one capability, and only a lead holding it sends either.
    const without = { ...lead, authentication: { ...lead.authentication, capabilities: { lead: { promptBreak: true } } } };
    expect(rules(validateTeamCommand(ban, without))).toEqual(["team.command.notGranted"]);
    expect(rules(validateTeamCommand(liftBan, { ...banned, authentication: without.authentication }))).toEqual(["team.command.notGranted"]);
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
      { id: "listened", availability: "on-task", listening: [{ leadId: "agent", assignmentId: "alloc-9", mode: "listen", since: at }] },
      { id: "elsewhere", availability: "on-task", listening: [{ leadId: "L-4", assignmentId: "alloc-11", mode: "coach", since: at }] }] } };
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
      // Another lead on a member's call is not this lead: the entry that counts names the signed-in lead.
      expect(validateTeamCommand({ command: { type, memberId: "elsewhere" } }, onCall).map(v => v.rule)).toContain("team.command.listening");
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
