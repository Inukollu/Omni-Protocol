import { assertTaskCapabilityWithdrawal } from "../src/testing.js";
import { describe, expect, it } from "vitest";
import { type Task, type RecordingState, type HostRecording, type RecordingAction, type RecordingCommand, type VoiceTaskCommand } from "../src/index.js";
import { effectiveRecordingState, validateRecordingOutcome, validateRecordingCommandState, validateRecordingState, validateRecordingPolicy, validateRecordingRequest, validateHostRecording, validateHostGuarantees, validateHostReport, validateTask, validateTaskCommand } from "../src/validation.js";

const observedAt = "2026-09-09T10:00:00.000Z";
const validUntil = "2026-09-09T10:00:30.000Z";
const now = Date.parse(observedAt) + 1000;
const state = (status: "inactive" | "active" | "paused" = "active"): RecordingState => status === "inactive"
  ? { status, observationId: "obs", observedAt, validUntil }
  : { status, observationId: "obs", observedAt, validUntil, recordingId: "capture-1" };
const actions = { start: true, pause: true, resume: true, stop: true, cancel: true } as const;
const task = (status: "inactive" | "active" | "paused" = "active"): Task<"voice"> => ({
  assignmentId: "assignment-1", channel: "voice", title: "Call", taskType: "call",
  phase: "in-progress", audio: "started", capabilitySource: "queue", completionMode: "agent-command", browsers: [],
  capabilities: { recording: { provider: actions, host: { ...actions, storageId: "recordings" } } },
  recording: { provider: state(status) },
});
const command = (action: RecordingAction, source: "provider" | "host" = "provider"): RecordingCommand => ({
  type: "recording", source, requestId: "request-1", observationId: "obs", action,
  ...(action === "start" ? {} : { recordingId: "capture-1" }),
}) as RecordingCommand;
const host: HostRecording = {
  actions: ["start", "pause", "resume", "stop", "cancel"], storageIds: ["recordings"],
  execute: async () => ({ status: "applied" }),
};
function check(action: RecordingAction, status: "inactive" | "active" | "paused", source: "provider" | "host" = "provider", changes: Record<string, unknown> = {}, context: Record<string, unknown> = {}, current: Task<"voice"> = task(status)) {
  return validateRecordingRequest({ assignmentId: "assignment-1", command: { ...command(action, source), ...changes } }, current, {
    source, now, host, softphone: true,
    hostReport: { online: true, recordings: [{ assignmentId: "assignment-1", state: state(status) }] }, ...context,
  });
}
const rules = (v: ReturnType<typeof validateRecordingState>) => v.map(i => i.rule);

describe("independent recording controls", () => {
  it("checks the complete action/state matrix for each owner", () => {
    const allowed = { start: ["inactive"], pause: ["active"], resume: ["paused"], stop: ["active", "paused"], cancel: ["active", "paused"] };
    for (const source of ["provider", "host"] as const) for (const action of Object.keys(allowed) as RecordingAction[]) for (const status of ["inactive", "active", "paused"] as const) {
      expect(check(action, status, source).length === 0, `${source}/${action}/${status}`).toBe(allowed[action].includes(status));
    }
  });
  it("allows an already-active task without controls, even on arrival", () => {
    const current = { ...task(), phase: "pending", audio: undefined, capabilities: {} };
    expect(validateTask(current, { channel: "voice" })).toEqual([]);
    expect(rules(check("stop", "active", "provider", {}, {}, current as Task<"voice">))).toContain("recording.command.permission");
  });
  it("routes provider commands only through execute and rejects legacy commands", () => {
    expect(validateTaskCommand(command("pause"), task())).toEqual([]);
    expect(rules(validateTaskCommand(command("pause", "host"), task()))).toContain("recording.command.source");
    expect(validateTaskCommand({ type: "recording", action: "start" })).not.toEqual([]);
    expect(validateRecordingPolicy(true)).not.toEqual([]);
  });
  it("keeps owners independent and rejects provider attempts to publish host state", () => {
    const current = task("inactive");
    expect(check("pause", "active", "host", {}, {}, current)).toEqual([]);
    expect(check("pause", "active", "provider", {}, {}, current)).not.toEqual([]);
    expect(rules(validateTask({ ...current, recording: { host: state() } }, { channel: "voice" }))).toContain("recording.task.owner");
    expect(rules(validateTask({ ...current, channel: "chat" }, { channel: "chat" }))).toContain("recording.task.channel");
  });
  it("refuses changed task permissions, storage, host abilities and stale identity", () => {
    expect(rules(check("pause", "active", "provider", { observationId: "old" }))).toContain("recording.command.stale");
    expect(rules(check("stop", "active", "provider", { recordingId: "replacement" }))).toContain("recording.command.recordingId");
    const locked = { ...task(), capabilities: { recording: { lockedBy: "team" } } } as Task<"voice">;
    expect(check("stop", "active", "provider", {}, {}, locked)).not.toEqual([]);
    const restricted = { ...task(), capabilities: { recording: { provider: { stop: true } } } } as Task<"voice">;
    expect(check("pause", "active", "provider", {}, {}, restricted)).not.toEqual([]);
    expect(check("stop", "active", "provider", {}, {}, restricted)).toEqual([]);
    expect(rules(check("start", "inactive", "host", {}, { host: { ...host, storageIds: ["other"] } }))).toContain("recording.host.storage");
    expect(rules(check("pause", "active", "host", {}, { host: { ...host, actions: ["stop"] } }))).toContain("recording.host.action");
    expect(rules(check("stop", "active", "host", {}, { softphone: false }))).toContain("recording.host.channel");
    expect(check("stop", "active", "host", {}, { host: undefined })).not.toEqual([]);
    expect(rules(check("stop", "active", "provider", {}, {}, { ...task(), assignmentId: "next" }))).toContain("recording.request.scope");
  });
  it("offers cancel as a discard-only action and refuses legacy effect fields", () => {
    expect(check("cancel", "active")).toEqual([]);
    expect(check("cancel", "active", "host")).toEqual([]);
    for (const cancelEffect of ["retain", "discard", undefined]) {
      expect(check("cancel", "active", "provider", { cancelEffect })).not.toEqual([]);
    }
    expect(validateRecordingPolicy({ provider: { cancel: true } })).toEqual([]);
    expect(validateRecordingPolicy({ provider: { cancel: false } })).not.toEqual([]);
    for (const effect of ["retain", "discard"]) {
      expect(validateRecordingPolicy({ provider: { cancel: { effect } } })).not.toEqual([]);
    }
    expect(validateHostRecording({ ...host, cancelEffects: ["discard"] }, true)).not.toEqual([]);
    expect(check("cancel", "active", "host", {}, { host: { ...host, actions: ["stop"] } })).not.toEqual([]);
    expect(validateRecordingPolicy({ host: { start: true } })).not.toEqual([]);
  });
  it("permits terminal actions during wrap-up but cannot resume/start ended audio", () => {
    const wrapping = { ...task(), phase: "completing", audio: "ended" } as Task<"voice">;
    expect(check("stop", "active", "provider", {}, {}, wrapping)).toEqual([]);
    expect(check("cancel", "active", "provider", {}, {}, wrapping)).toEqual([]);
    expect(check("resume", "paused", "host", {}, {}, wrapping)).not.toEqual([]);
    expect(check("start", "inactive", "host", {}, {}, { ...task("inactive"), audio: "ended" })).not.toEqual([]);
  });
});

describe("recording evidence and declarations", () => {
  it("expires at the exact boundary, never on receipt time or an unknown clock", () => {
    for (const s of [state("inactive"), state("active"), state("paused")]) {
      expect(effectiveRecordingState(s, Date.parse(observedAt))).toEqual(s);
      expect(effectiveRecordingState(s, Date.parse(validUntil) - 1)).toEqual(s);
      for (const time of [undefined, NaN, Infinity, Date.parse(observedAt) - 1, Date.parse(validUntil)]) expect(effectiveRecordingState(s, time)).toEqual({ status: "unknown" });
    }
    expect(rules(check("stop", "active", "provider", {}, { now: undefined }))).toContain("recording.request.freshness");
    expect(rules(check("stop", "active", "provider", {}, { now: Date.parse(validUntil) }))).toContain("recording.request.freshness");
  });
  it("refuses fabricated/invalid observation variants and does not mutate historical evidence", () => {
    expect(validateRecordingState({ status: "unknown" })).toEqual([]);
    for (const invalid of [null, [], true, {}, { ...state(), observedAt: "2026-02-30T10:00:00.000Z" }, { ...state(), validUntil: observedAt }, { ...state(), recordingId: "" }, { status: "unknown", observedAt }, { ...state("inactive"), recordingId: "r" }, { ...state(), duration: 10 }]) expect(validateRecordingState(invalid)).not.toEqual([]);
    const original = state(); effectiveRecordingState(original, Date.parse(validUntil)); expect(original.status).toBe("active");
  });
  it("validates host declarations, reports, unique scopes and malformed nested inputs", () => {
    expect(validateHostRecording(host, true)).toEqual([]);
    for (const declaration of [{ ...host, actions: ["pause"] }, { ...host, actions: ["stop", "stop"] }, { ...host, actions: ["rewind"] }, { ...host, storageIds: [] }, { ...host, execute: undefined }]) expect(validateHostRecording(declaration, true)).not.toEqual([]);
    const report = { assignmentId: "assignment-1", state: state() };
    expect(validateHostReport({ online: true, recordings: [report] })).toEqual([]);
    expect(validateHostReport({ online: true, recordings: [report, report] })).not.toEqual([]);
    expect(check("stop", "active", "host", {}, { hostReport: { recordings: [{ ...report, assignmentId: "other" }] } })).not.toEqual([]);
    for (const bad of [null, false, [], "x", 1, {}, { toString: null }]) {
      expect(() => validateRecordingRequest(bad, task(), { source: "provider", now })).not.toThrow();
      expect(() => validateRecordingPolicy({ provider: bad, host: bad })).not.toThrow();
      expect(() => validateHostRecording(bad, true)).not.toThrow();
    }
  });
});

// @ts-expect-error Host commands cannot be sent to provider execute.
const wrongExecutor: VoiceTaskCommand = { ...command("stop", "host"), source: "host" };
// @ts-expect-error Stop targets an existing recording.
const missingIdentity: RecordingCommand = { type: "recording", source: "provider", requestId: "q", observationId: "o", action: "stop" };
// @ts-expect-error Inactive is not an existing recording.
const inactiveIdentity: RecordingState = { status: "inactive", observationId: "o", observedAt, validUntil, recordingId: "r" };
void [wrongExecutor, missingIdentity, inactiveIdentity];


describe("recording outcomes", () => {
  const applied = { status: "applied" };
  const failed = { status: "failed", failure: { code: "recorder.refused", message: "Refused", retryable: false } };
  const next = (status: "inactive" | "active" | "paused") => ({ ...state(status), observationId: "confirmed", observedAt: "2026-09-09T10:00:01.000Z" });
  it("requires actual confirming transitions and preserved pause/resume identity", () => {
    for (const [action, before, after] of [["start", "inactive", "active"], ["pause", "active", "paused"], ["resume", "paused", "active"], ["stop", "paused", "inactive"], ["cancel", "active", "inactive"]] as const) {
      expect(validateRecordingOutcome(command(action), state(before), next(after), applied)).toEqual([]);
    }
    expect(validateRecordingOutcome(command("pause"), state(), { ...next("paused"), recordingId: "other" }, applied)).not.toEqual([]);
    expect(validateRecordingOutcome(command("pause"), state(), state(), applied)).not.toEqual([]);
    expect(validateRecordingOutcome(command("start"), state(), next("active"), applied)).not.toEqual([]);
    expect(validateRecordingOutcome(command("stop"), state(), next("inactive"), { status: "dialling", dialId: "d" })).not.toEqual([]);
  });
  it("does not misrepresent partial effects or timeouts as confirmed failure", () => {
    expect(validateRecordingOutcome(command("stop"), state(), state(), failed)).toEqual([]);
    expect(validateRecordingOutcome(command("stop"), state(), next("inactive"), failed)).not.toEqual([]);
    expect(validateRecordingOutcome(command("stop"), state(), next("inactive"), undefined)).toEqual([]);
    expect(validateRecordingOutcome(command("stop"), state(), { status: "unknown" }, undefined)).toEqual([]);
  });
});


describe("recording validation context and direct permission checks", () => {
  it("never treats explicit false or malformed standalone inputs as permission", () => {
    expect(validateRecordingCommandState(command("pause"), { pause: false }, state())).not.toEqual([]);
    expect(validateRecordingCommandState(null, actions, state())).not.toEqual([]);
    expect(validateRecordingCommandState({ ...command("pause"), action: "rewind" }, { rewind: true }, state())).not.toEqual([]);
    expect(validateRecordingCommandState({ ...command("cancel"), cancelEffect: "unsupported" }, { cancel: { effect: "unsupported" } }, state())).not.toEqual([]);
  });

  it("honours the provider's organisation levels at dispatch and static command validation", () => {
    const current = task();
    current.capabilities.hold = { lockedBy: "region" };
    const taskContext = { levels: ["region", "person"] };
    expect(validateTask(current, { ...taskContext, channel: "voice" })).toEqual([]);
    expect(validateTaskCommand(command("pause"), current, "command", taskContext)).toEqual([]);
    expect(check("pause", "active", "provider", {}, { taskContext }, current)).toEqual([]);
    expect(validateTaskCommand(command("pause"), current)).not.toEqual([]);
    expect(check("pause", "active", "provider", {}, {}, current)).not.toEqual([]);
  });

  it("carries known task restrictions through to recording dispatch", () => {
    const current = task();
    current.capabilities.coldTransfer = { destinations: [{ id: "desk", label: "Desk" }] };
    expect(check("pause", "active", "provider", {}, { taskContext: { dialOutcomesDeclared: false } }, current)).not.toEqual([]);
    expect(check("pause", "active", "provider", {}, { taskContext: { dialOutcomesDeclared: true } }, current)).toEqual([]);
  });
});


// @ts-expect-error Cancel is a permission flag, not a configurable retain/discard policy.
const legacyCancelPolicy: import("../src/index.js").RecordingActions = { cancel: { effect: "retain" } };
// @ts-expect-error Cancel has a fixed discard meaning and carries no effect override.
const legacyCancelCommand: RecordingCommand = { type: "recording", source: "provider", action: "cancel", requestId: "q", observationId: "o", recordingId: "r", cancelEffect: "retain" };
void [legacyCancelPolicy, legacyCancelCommand];


it("keeps recording capability withdrawal conformance scoped to the provider's levels", () => {
  const first = task();
  first.capabilities.decline = { lockedBy: "region" };
  const last = { ...first, capabilities: { decline: { lockedBy: "region" } } };
  const manifest = {
    id: "voice", displayName: "Voice", channel: "voice" as const,
    supportedProtocolVersions: [1], authenticationMethods: ["credentials" as const], completionSettleMs: 150,
    orgLevels: [{ id: "region", label: "Region" }, { id: "person", label: "Person" }],
  };
  expect(() => assertTaskCapabilityWithdrawal([first, last], manifest, command("pause"))).not.toThrow();
});


describe("host-only caller recording announcement guarantee", () => {
  it("is optional and declared only as true inside host recording support", () => {
    expect(validateHostRecording(host, true)).toEqual([]);
    expect(validateHostRecording({ ...host, announcesToCaller: true }, true)).toEqual([]);
    for (const value of [false, null, "true", 1, {}]) {
      expect(rules(validateHostRecording({ ...host, announcesToCaller: value }, true))).toContain("recording.host.announcesToCaller");
    }
    expect(validateHostRecording({ announcesToCaller: true }, true)).not.toEqual([]);
    expect(validateHostRecording({ ...host, announcesToCaller: true }, false)).not.toEqual([]);
  });

  it("cannot be placed on provider task policy or the general host guarantees", () => {
    expect(validateHostGuarantees({ announcesToCaller: true })).not.toEqual([]);
    expect(validateRecordingPolicy({ provider: { start: true, announcesToCaller: true } })).not.toEqual([]);
    expect(validateRecordingPolicy({ host: { start: true, storageId: "recordings", announcesToCaller: true } })).not.toEqual([]);
  });

  it("does not grant recording permission or affect provider-owned dispatch", () => {
    const announcingHost = { ...host, announcesToCaller: true };
    expect(check("start", "inactive", "host", {}, { host: announcingHost })).toEqual([]);
    expect(check("stop", "active", "provider", {}, { host: undefined })).toEqual([]);
    const withoutPermission = { ...task("inactive"), capabilities: {} };
    expect(check("start", "inactive", "host", {}, { host: announcingHost }, withoutPermission)).not.toEqual([]);
  });
});

// @ts-expect-error Host recording caller announcement is a guarantee, never false.
const falseAnnouncement: HostRecording = { ...host, announcesToCaller: false };
void falseAnnouncement;
