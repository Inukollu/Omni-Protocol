import { describe, expect, it } from "vitest";
import type { PreviewDeadline, Task, ProviderEventEnvelope } from "../src/index.js";
import { validateTask, validateTaskCommand, validateResult } from "../src/validation.js";
import { TaskStream } from "../src/testing.js";

const at = "2026-09-11T10:00:00Z";
const preview: Task<"voice"> = {
  assignmentId: "interaction-1", title: "Preview", channel: "voice",
  taskType: "Campaign", capabilitySource: "queue", phase: "preview", capabilities: {}, browsers: [],
  completionMode: "agent-command", party: { number: "+919876543210" },
};
const voice = { channel: "voice" as const, dialOutcomesDeclared: true };
const ringing = { role: "party" as const, stage: "ringing" as const, since: at };

describe("preview trigger ownership", () => {
  it("accepts unlimited preparation and either fixed trigger owner, or waiting for the agent", () => {
    expect(validateTask(preview, voice)).toEqual([]);
    for (const atDeadline of ["provider-dials", "host-dials", "waits"] satisfies PreviewDeadline[]) {
      expect(validateTask({ ...preview, atDeadline, previewEndsAt: at }, voice)).toEqual([]);
    }
  });
  it("waits after the target without expiring the preview or disabling Call", () => {
    const waiting = { ...preview, atDeadline: "waits", previewEndsAt: "2000-01-01T00:00:00Z" };
    expect(validateTask(waiting, voice)).toEqual([]);
    expect(validateTaskCommand({ type: "dial", dialId: "manual-after-target" }, waiting, "voice")).toEqual([]);
    expect(waiting.phase).toBe("preview");
    expect(validateTask({ ...waiting, atDeadline: "expires" }, voice).map(v => v.rule)).toContain("task.preview.atDeadline");
  });
  it("requires a valid paired deadline, preview phase, and one declared owner", () => {
    for (const change of [
      { atDeadline: "host-dials" }, { atDeadline: "host-dials", previewEndsAt: "later" },
      { atDeadline: ["provider-dials", "host-dials"], previewEndsAt: at },
      { atDeadline: "host-dials", previewEndsAt: at, phase: "in-progress" },
    ]) expect(validateTask({ ...preview, ...change }, voice)).not.toEqual([]);
  });
  it("keeps manual Call available in both modes and acknowledges submission, not answer", () => {
    const command = { type: "dial", dialId: "host-dial" };
    for (const atDeadline of ["provider-dials", "host-dials"] as const) {
      expect(validateTaskCommand(command, { ...preview, atDeadline, previewEndsAt: at }, "voice")).toEqual([]);
    }
    expect(validateResult({ status: "dialling", dialId: "host-dial" }, "execute", "result", "host-dial")).toEqual([]);
    expect(validateResult({ status: "applied" }, "execute", "result", "host-dial")).not.toEqual([]);
  });
  it("allows actual provider-triggered preview ringback without a fabricated host identity", () => {
    const task = { ...preview, atDeadline: "provider-dials", previewEndsAt: at, onCall: [ringing], audio: "started" };
    expect(validateTask(task, voice)).toEqual([]);
    for (const atDeadline of ["host-dials", "waits", undefined]) {
      const candidate = { ...task, atDeadline, previewEndsAt: atDeadline ? at : undefined };
      expect(validateTask(candidate, voice).map(v => v.rule)).toContain("task.audio.beforeWork");
    }
    expect(validateTask({ ...task, onCall: [] }, voice).map(v => v.rule)).toContain("task.audio.beforeWork");
  });
  it("orders provider ringback start/end before non-answer completion without a host dial outcome", () => {
    const task = { ...preview, atDeadline: "provider-dials" as const, previewEndsAt: at, onCall: [ringing] };
    const stream = new TaskStream();
    stream.resync({ tasks: [task] }, "snapshot");
    const event = (type: "task-audio-started" | "task-audio-ended"): ProviderEventEnvelope => ({
      id: type, loginId: "login", occurredAt: at,
      event: { type, assignmentId: task.assignmentId },
    });
    expect(stream.apply(event("task-audio-started"))).toEqual([]);
    expect(stream.apply(event("task-audio-ended"))).toEqual([]);
    const { atDeadline: _owner, previewEndsAt: _deadline, ...rest } = task;
    expect(stream.apply({ event: { type: "task-updated", task: { ...rest, phase: "completing", audio: "ended", onCall: [] } } })).toEqual([]);
    expect(task.phase).toBe("preview");
  });
});
