import { describe, expect, it } from "vitest";
import { type Task, type RecordingState, type HostRecording, type RecordingAction, type RecordingCommand, type VoiceTaskCommand } from "../src/index.js";
import { effectiveRecordingState, validateRecordingOutcome, validateRecordingState, validateRecordingPolicy, validateRecordingRequest, validateHostRecording, validateHostReport, validateTask, validateTaskCommand } from "../src/validation.js";

const observedAt = "2026-09-09T10:00:00.000Z";
const validUntil = "2026-09-09T10:00:30.000Z";
const now = Date.parse(observedAt) + 1000;
const state = (status: "inactive" | "active" | "paused" = "active"): RecordingState => status === "inactive"
  ? { status, observationId: "obs", observedAt, validUntil }
  : { status, observationId: "obs", observedAt, validUntil, recordingId: "capture-1" };
const actions = { start: true, pause: true, resume: true, stop: true, cancel: { effect: "discard" } } as const;
const task = (status: "inactive" | "active" | "paused" = "active"): Task<"voice"> => ({
  id: "task-1", allocationId: "allocation-1", channel: "voice", title: "Call", taskType: "call",
  phase: "in-progress", media: "started", capabilitySource: "queue", completionMode: "agent-command", browsers: [],
  capabilities: { recording: { provider: actions, host: { ...actions, destinationId: "recordings" } } },
  recording: { provider: state(status) },
});
const command = (action: RecordingAction, source: "provider" | "host" = "provider"): RecordingCommand => ({
  type: "recording", source, requestId: "request-1", observationId: "obs", action,
  ...(action === "start" ? {} : { recordingId: "capture-1" }),
  ...(action === "cancel" ? { cancelEffect: "discard" } : {}),
}) as RecordingCommand;
const host: HostRecording = {
  actions: ["start", "pause", "resume", "stop", "cancel"], cancelEffects: ["discard"], destinationIds: ["recordings"],
  execute: async () => ({ status: "applied" }),
};
function check(action: RecordingAction, status: "inactive" | "active" | "paused", source: "provider" | "host" = "provider", changes: Record<string, unknown> = {}, context: Record<string, unknown> = {}, current: Task<"voice"> = task(status)) {
  return validateRecordingRequest({ taskId: "task-1", allocationId: "allocation-1", command: { ...command(action, source), ...changes } }, current, {
    source, now, host, softphone: true,
    hostReport: { online: true, recordings: [{ taskId: "task-1", allocationId: "allocation-1", state: state(status) }] }, ...context,
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
    const current = { ...task(), phase: "pending", media: undefined, capabilities: {} };
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
  it("refuses changed task permissions, destinations, host abilities and stale identity", () => {
    expect(rules(check("pause", "active", "provider", { observationId: "old" }))).toContain("recording.command.stale");
    expect(rules(check("stop", "active", "provider", { recordingId: "replacement" }))).toContain("recording.command.recordingId");
    const locked = { ...task(), capabilities: { recording: { lockedBy: "team" } } } as Task<"voice">;
    expect(check("stop", "active", "provider", {}, {}, locked)).not.toEqual([]);
    const restricted = { ...task(), capabilities: { recording: { provider: { stop: true } } } } as Task<"voice">;
    expect(check("pause", "active", "provider", {}, {}, restricted)).not.toEqual([]);
    expect(check("stop", "active", "provider", {}, {}, restricted)).toEqual([]);
    expect(rules(check("start", "inactive", "host", {}, { host: { ...host, destinationIds: ["other"] } }))).toContain("recording.host.destination");
    expect(rules(check("pause", "active", "host", {}, { host: { ...host, actions: ["stop"], cancelEffects: [] } }))).toContain("recording.host.action");
    expect(rules(check("stop", "active", "host", {}, { softphone: false }))).toContain("recording.host.channel");
    expect(check("stop", "active", "host", {}, { host: undefined })).not.toEqual([]);
    expect(rules(check("stop", "active", "provider", {}, {}, { ...task(), allocationId: "next" }))).toContain("recording.request.scope");
  });
  it("requires explicit cancel effect and does not confuse cancel with stop", () => {
    expect(rules(check("cancel", "active", "provider", { cancelEffect: "retain" }))).toContain("recording.command.cancelEffect");
    expect(rules(check("cancel", "active", "provider", { cancelEffect: undefined }))).toContain("recording.cancel.effect");
    expect(check("stop", "active", "provider", { cancelEffect: "discard" })).not.toEqual([]);
    expect(validateRecordingPolicy({ provider: { cancel: true } })).not.toEqual([]);
    expect(validateRecordingPolicy({ provider: { cancel: { effect: "retain" } } })).toEqual([]);
    expect(validateRecordingPolicy({ host: { start: true } })).not.toEqual([]);
  });
  it("permits terminal actions during wrap-up but cannot resume/start ended media", () => {
    const wrapping = { ...task(), phase: "completing", media: "ended" } as Task<"voice">;
    expect(check("stop", "active", "provider", {}, {}, wrapping)).toEqual([]);
    expect(check("cancel", "active", "provider", {}, {}, wrapping)).toEqual([]);
    expect(check("resume", "paused", "host", {}, {}, wrapping)).not.toEqual([]);
    expect(check("start", "inactive", "host", {}, {}, { ...task("inactive"), media: "ended" })).not.toEqual([]);
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
    for (const declaration of [{ ...host, actions: ["pause"] }, { ...host, actions: ["stop", "stop"] }, { ...host, cancelEffects: [] }, { ...host, destinationIds: [] }, { ...host, execute: undefined }]) expect(validateHostRecording(declaration, true)).not.toEqual([]);
    const report = { taskId: "task-1", allocationId: "allocation-1", state: state() };
    expect(validateHostReport({ online: true, recordings: [report] })).toEqual([]);
    expect(validateHostReport({ online: true, recordings: [report, report] })).not.toEqual([]);
    expect(check("stop", "active", "host", {}, { hostReport: { recordings: [{ ...report, allocationId: "other" }] } })).not.toEqual([]);
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
