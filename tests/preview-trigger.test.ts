import { describe, expect, it } from "vitest";
import type { PreviewDeadline, Task, ProviderEventEnvelope } from "../src/index.js";
import { validateTask, validateTaskCommand, validateResult } from "../src/validation.js";
import { TaskStream } from "../src/testing.js";

const at = "2026-09-11T10:00:00Z";
const preview: Task<"voice"> = {
  id: "interaction-1", assignmentId: "interaction-1", title: "Preview", channel: "voice",
  taskType: "Campaign", capabilitySource: "queue", phase: "preview", capabilities: {}, browsers: [],
  completionMode: "agent-command", party: { number: "+919876543210" },
};
const voice = { channel: "voice" as const, dialOutcomesDeclared: true };
const ringing = { role: "party" as const, stage: "ringing" as const, since: at };

describe("preview trigger ownership", () => {
  it("accepts unlimited preparation and either fixed trigger owner, or waiting for the agent", () => {
    expect(validateTask(preview, voice)).toEqual([]);
    for (const atDeadline of ["calls", "host-calls", "waits"] satisfies PreviewDeadline[]) {
      expect(validateTask({ ...preview, atDeadline, previewEndsAt: at }, voice)).toEqual([]);
    }
  });
  it("waits after the target without expiring the preview or disabling Call", () => {
    const waiting = { ...preview, atDeadline: "waits", previewEndsAt: "2000-01-01T00:00:00Z" };
    expect(validateTask(waiting, voice)).toEqual([]);
    expect(validateTaskCommand({ type: "call", dialId: "manual-after-target" }, waiting, "voice")).toEqual([]);
    expect(waiting.phase).toBe("preview");
    expect(validateTask({ ...waiting, atDeadline: "expires" }, voice).map(v => v.rule)).toContain("task.preview.atDeadline");
  });
  it("requires a valid paired deadline, preview phase, and one declared owner", () => {
    for (const change of [
      { atDeadline: "host-calls" }, { atDeadline: "host-calls", previewEndsAt: "later" },
      { atDeadline: ["calls", "host-calls"], previewEndsAt: at },
      { atDeadline: "host-calls", previewEndsAt: at, phase: "in-progress" },
    ]) expect(validateTask({ ...preview, ...change }, voice)).not.toEqual([]);
  });
  it("keeps manual Call available in both modes and acknowledges submission, not answer", () => {
    const command = { type: "call", dialId: "host-dial" };
    for (const atDeadline of ["calls", "host-calls"] as const) {
      expect(validateTaskCommand(command, { ...preview, atDeadline, previewEndsAt: at }, "voice")).toEqual([]);
    }
    expect(validateResult({ status: "dialling", dialId: "host-dial" }, "execute", "result", "host-dial")).toEqual([]);
    expect(validateResult({ status: "applied" }, "execute", "result", "host-dial")).not.toEqual([]);
  });
  it("allows actual provider-triggered preview ringback without a fabricated host identity", () => {
    const task = { ...preview, atDeadline: "calls", previewEndsAt: at, onCall: [ringing], media: "started" };
    expect(validateTask(task, voice)).toEqual([]);
    for (const atDeadline of ["host-calls", "waits", undefined]) {
      const candidate = { ...task, atDeadline, previewEndsAt: atDeadline ? at : undefined };
      expect(validateTask(candidate, voice).map(v => v.rule)).toContain("task.media.beforeWork");
    }
    expect(validateTask({ ...task, onCall: [] }, voice).map(v => v.rule)).toContain("task.media.beforeWork");
  });
  it("orders provider ringback start/end before non-answer completion without a host dial outcome", () => {
    const task = { ...preview, atDeadline: "calls" as const, previewEndsAt: at, onCall: [ringing] };
    const stream = new TaskStream();
    stream.resync({ tasks: [task] }, "snapshot");
    const event = (type: "task-media-started" | "task-media-ended"): ProviderEventEnvelope => ({
      id: type, loginId: "login", occurredAt: at,
      event: { type, taskId: task.id, assignmentId: task.assignmentId },
    });
    expect(stream.apply(event("task-media-started"))).toEqual([]);
    expect(stream.apply(event("task-media-ended"))).toEqual([]);
    const { atDeadline: _owner, previewEndsAt: _deadline, ...rest } = task;
    expect(stream.apply({ event: { type: "task-updated", task: { ...rest, phase: "completing", media: "ended", onCall: [] } } })).toEqual([]);
    expect(task.phase).toBe("preview");
  });
});
