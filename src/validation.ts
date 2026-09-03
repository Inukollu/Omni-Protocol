// Runtime validation for the approved protocol.
//
// An adapter is loaded from a separate package and may be compiled against a different protocol
// version, so its output is untrusted input. Every validator here takes `unknown` and returns
// every violation it found rather than throwing on the first, so a caller can report all of them
// at once.
//
// The contract's closed sets are declared as types in index.ts and needed here as runtime lists.
// Each list is pinned to its type both ways -- a member the type lacks, or a member the list
// lacks, fails to compile -- so what the validators accept cannot drift from what the
// declarations say.

import {
  ALLOWED_BROWSER_URL_SCHEMES,
  BREAK_KINDS,
  BROWSER_ISOLATION_SCHEMES,
  IDLE_CAPABILITIES,
  OMNI_FAILURE_CODES,
  OMNI_SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
  type AcceptanceMode,
  type AuthenticationMethod,
  type AuthenticationState,
  type BreakApproval,
  type BrowserAccess,
  type HostAudioUnavailableReason,
  type UrlVisibility,
  DEFAULT_LEVELS,
  effectiveLevels,
  type TeamPolicySetting,
  type TaskMediaState,
  type TransportRecovery,
  type CredentialField,
  type HostOutputUnavailableReason,
  type Channel,
  type CompletionMode,
  type TransportStatus,
  type CustomCapability,
  type Destination,
  type DialDestinations,
  type DispositionRules,
  type HandlingStep,
  type IdleCapabilities,
  type IdleCapability,
  type PersonalBrowserCapability,
  type ProtocolViolation,
  type ProviderEvent,
  type UserCapabilities,
  type TeamCapabilities,
  type TaskCapabilities,
  type TaskLead,
  type TaskOutcome,
  type TaskPhase,
  type TeamMemberAvailability,
  type UserId,
} from "./index.js";

export type { ProtocolViolation } from "./index.js";

export class ProtocolConformanceError extends Error {
  readonly violations: readonly ProtocolViolation[];

  constructor(violations: readonly ProtocolViolation[], summary = "Adapter violates the Omni protocol") {
    const detail = violations.map(violation => `  ${violation.rule} at ${violation.path}: ${violation.message}`).join("\n");
    super(`${summary} (${violations.length} violation${violations.length === 1 ? "" : "s"}):\n${detail}`);
    this.name = "ProtocolConformanceError";
    this.violations = violations;
  }
}

/** Throws `ProtocolConformanceError` when any violation is present. */
export function assertNoViolations(violations: readonly ProtocolViolation[], summary?: string): void {
  if (violations.length > 0) throw new ProtocolConformanceError(violations, summary);
}

// ---------------------------------------------------------------------------
// The contract's closed sets, as runtime lists pinned to their types.
// ---------------------------------------------------------------------------

/**
 * Every member of a contract union, as a list.
 *
 * `Record<U, true>` is what makes it complete: a key the union lacks is an excess property and a
 * union member the object lacks is a missing one, so either mistake is a compile error here
 * rather than a validator that quietly accepts or rejects the wrong thing.
 */
const membersOf = <U extends string>(members: Record<U, true>): readonly U[] =>
  Object.keys(members) as U[];

const CHANNELS = membersOf<Channel>({ voice: true, chat: true, email: true });
const TRANSPORT_RECOVERIES = membersOf<TransportRecovery>({ reconnect: true, reauthenticate: true });
const TASK_PHASES = membersOf<TaskPhase>({
  pending: true, confirmed: true, preparing: true, "in-progress": true, paused: true, completing: true,
});
const COMPLETION_MODES = membersOf<CompletionMode>({ "agent-command": true, "provider-automatic": true });
const ACCEPTANCE_MODES = membersOf<AcceptanceMode>({
  "no-preference": true, "require-agent-acceptance": true, "require-automatic-acceptance": true,
});
const TRANSPORT_STATUSES = membersOf<TransportStatus>({ connecting: true, active: true, error: true });
const AUTHENTICATION_METHODS = membersOf<AuthenticationMethod>({ "browser-sso": true, credentials: true });
const AUTHENTICATION_STATUSES = membersOf<AuthenticationState["status"]>({
  "signed-out": true, authenticating: true, authenticated: true, refreshing: true, expired: true,
});
const BREAK_APPROVALS = membersOf<BreakApproval>({
  "not-requested": true, "awaiting-decision": true, granted: true, "starting-after-task": true, "in-effect": true,
});
const TEAM_AVAILABILITIES = membersOf<TeamMemberAvailability>({
  ready: true, "on-task": true, "on-break": true, "signed-out": true,
});
const HANDLING_STEPS = membersOf<HandlingStep>({
  queued: true, offered: true, answered: true, held: true, muted: true, transferred: true, conferenced: true, unanswered: true,
});
const DESTINATION_KINDS = membersOf<Destination["kind"]>({ queue: true, agent: true, external: true });
const CUSTOM_UI_CONTROLS = membersOf<CustomCapability["ui"]["control"]>({ button: true, toggle: true, "menu-item": true });
const CUSTOM_UI_PLACEMENTS = membersOf<CustomCapability["ui"]["placement"]>({ primary: true, secondary: true, overflow: true });
const NOTES_POLICIES = membersOf<NonNullable<DispositionRules["notes"]>>({ required: true, optional: true, hidden: true });
const ACCESS_MODES = membersOf<BrowserAccess["mode"]>({ "allow-all": true, "block-all": true });
const ACCESS_POLICY_SCOPES = membersOf<NonNullable<PersonalBrowserCapability["accessPolicyScope"]>>({
  "initial-url": true, "all-navigation": true,
});
const DIAL_DESTINATION_POLICIES = membersOf<DialDestinations>({ "contacts-only": true, "any-number": true });
const SNAPSHOT_REASONS = membersOf<Extract<ProviderEvent, { type: "snapshot" }>["reason"]>({
  reconnected: true, "provider-requested": true,
});
const SESSION_CAPABILITIES = membersOf<keyof UserCapabilities>({ breaks: true, team: true, preferences: true });
const MEMBER_BREAKS = membersOf<Extract<BreakApproval, "awaiting-decision" | "granted" | "starting-after-task">>({
  "awaiting-decision": true, granted: true, "starting-after-task": true,
});
const OFFERABLE_PHASES = membersOf<Extract<TaskPhase, "pending" | "confirmed" | "preparing">>({
  pending: true, confirmed: true, preparing: true,
});
const TEAM_CAPABILITIES = membersOf<keyof TeamCapabilities>({ breakControl: true, consultControl: true, policyControl: true });
const COMPLETED_BY = membersOf<Extract<TaskOutcome, { type: "completed" }>["by"]>({ agent: true, provider: true });
const EXPIRABLE_PHASES = membersOf<Extract<TaskOutcome, { type: "expired" }>["phase"]>({
  pending: true, confirmed: true, preparing: true,
});

const ISOLATION_SCHEME_VALUES: readonly string[] = Object.values(BROWSER_ISOLATION_SCHEMES);

/** The capabilities each channel arm of `TaskCapabilities` declares, keyed off the type itself. */
const TASK_CAPABILITIES: Readonly<Record<Channel, readonly string[]>> = {
  voice: membersOf<keyof TaskCapabilities<"voice">>({
    browsers: true, dispositions: true, custom: true, decline: true, mute: true, hold: true,
    agentDisconnect: true, callback: true, blindTransfer: true, consultTransfer: true, consultLead: true, conference: true, recording: true,
  }),
  chat: membersOf<keyof TaskCapabilities<"chat">>({ browsers: true, dispositions: true, custom: true, reject: true, hold: true }),
  email: membersOf<keyof TaskCapabilities<"email">>({ browsers: true, dispositions: true, custom: true, reject: true }),
};

// The published list and the type's keys are the same set, or one of them is wrong.
type Assert<T extends true> = T;
type _IdleCapabilitiesMatchTheType = Assert<
  [keyof IdleCapabilities<"voice">] extends [IdleCapability]
    ? ([IdleCapability] extends [keyof IdleCapabilities<"voice">] ? true : false)
    : false
>;

/** Idle capabilities each channel may declare. Only voice may dial, and runtime has to say so too. */
const IDLE_CAPABILITIES_BY_CHANNEL: Readonly<Record<Channel, readonly string[]>> = {
  voice: IDLE_CAPABILITIES,
  chat: IDLE_CAPABILITIES.filter(name => name !== "dial"),
  email: IDLE_CAPABILITIES.filter(name => name !== "dial"),
};

const isChannel = (value: string): value is Channel => (CHANNELS as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Semantic types. Each is a primitive on the wire with its own validation rule.
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * An RFC-3339 timestamp carrying a zone.
 *
 * `Date.parse` accepts a timezone-less string and resolves it against whatever zone the machine
 * happens to be in, so two hosts would read the same wire value as two different instants. The
 * contract calls those invalid, and this is where that is enforced rather than assumed.
 */
const isIsoTimestamp = (value: unknown): boolean =>
  typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value)
  && !Number.isNaN(Date.parse(value));

/** A non-negative integer count of seconds. */
const isDurationSeconds = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Opaque, non-empty, provider-issued. Never parsed and never compared across providers. */
const isUserId = isFilled;
const isTaskId = isFilled;

class Collector {
  readonly violations: ProtocolViolation[] = [];

  add(rule: string, path: string, message: string): void {
    this.violations.push({ rule, path, message });
  }

  require(condition: unknown, rule: string, path: string, message: string): boolean {
    if (!condition) this.add(rule, path, message);
    return Boolean(condition);
  }

  filled(value: unknown, rule: string, path: string, message: string): boolean {
    return this.require(isFilled(value), rule, path, message);
  }

  timestamp(value: unknown, rule: string, path: string): boolean {
    return this.require(isIsoTimestamp(value), rule, path,
      "must be an RFC-3339 timestamp carrying a zone, such as 2026-08-21T09:00:00Z");
  }

  oneOf(value: unknown, allowed: readonly string[], rule: string, path: string): boolean {
    return this.require(typeof value === "string" && allowed.includes(value), rule, path,
      `must be one of ${allowed.join(", ")}; received ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Shared shapes.
// ---------------------------------------------------------------------------

function validateAttributes(value: unknown, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    into.add("attributes.shape", path, "attributes must be an array when present");
    return;
  }
  value.forEach((attribute: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(attribute)) {
      into.add("attribute.shape", at, "each attribute must be an object");
      return;
    }
    into.filled(attribute.key, "attribute.key", `${at}.key`, "an attribute needs a non-empty key");
    into.require(typeof attribute.value === "string", "attribute.value", `${at}.value`, "an attribute value must be a string");
  });
}

/** Every field is optional, so this checks what is present rather than what is missing. */
export function validateContact(contact: unknown, path = "contact"): ProtocolViolation[] {
  const into = new Collector();
  validateContactInto(contact, path, into);
  return into.violations;
}

function validateContactInto(contact: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!isPlainObject(contact)) {
    into.add("contact.shape", path, "a contact must be an object");
    return;
  }
  for (const field of ["name", "number", "email"] as const) {
    if (contact[field] === undefined) continue;
    if ((field === "number" || field === "email") && isLocked(contact[field])) {
      validateLockedInto(contact[field] as Record<string, unknown>, `contact.${field}.locked`, `${path}.${field}`, levels, into);
      continue;
    }
    into.filled(contact[field], `contact.${field}`, `${path}.${field}`, `${field} must not be empty when present`);
  }
  validateAttributes(contact.attributes, `${path}.attributes`, into);
}

export function validateScheduledActivity(activity: unknown, path = "scheduledActivity"): ProtocolViolation[] {
  const into = new Collector();
  validateScheduledActivityInto(activity, path, into);
  return into.violations;
}

function validateScheduledActivityInto(activity: unknown, path: string, into: Collector): void {
  if (!isPlainObject(activity)) {
    into.add("activity.shape", path, "a scheduled activity must be an object");
    return;
  }
  into.filled(activity.id, "activity.id", `${path}.id`, "a scheduled activity needs an id");
  into.filled(activity.title, "activity.title", `${path}.title`, "a scheduled activity needs a title");
  const startValid = into.timestamp(activity.startsAt, "activity.startsAt", `${path}.startsAt`);
  if (activity.endsAt !== undefined) {
    const endValid = into.timestamp(activity.endsAt, "activity.endsAt", `${path}.endsAt`);
    if (startValid && endValid) {
      into.require(
        Date.parse(activity.endsAt as string) >= Date.parse(activity.startsAt as string),
        "activity.endsAt.order", `${path}.endsAt`, "endsAt must not precede startsAt",
      );
    }
  }
  if (activity.party !== undefined) validateContactInto(activity.party, `${path}.party`, into);
  validateAttributes(activity.attributes, `${path}.attributes`, into);
}

// ---------------------------------------------------------------------------
// Manifest.
// ---------------------------------------------------------------------------

function validateBrowserAccess(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("manifest.personalBrowser.access.shape", path, "an access policy must be an object");
    return;
  }
  into.oneOf(value.mode, ACCESS_MODES, "manifest.personalBrowser.access.mode", `${path}.mode`);
  for (const list of ["allowList", "blockList"] as const) {
    if (value[list] === undefined) continue;
    if (!Array.isArray(value[list])) {
      into.add("manifest.personalBrowser.access.list", `${path}.${list}`, `${list} must be an array when present`);
      continue;
    }
    (value[list] as unknown[]).forEach((entry, index) => {
      into.filled(entry, "manifest.personalBrowser.access.host", `${path}.${list}[${index}]`, "a host pattern must not be empty");
    });
  }
}

function validateIdleCapabilities(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    into.add("manifest.idleCapabilities.shape", path, "idleCapabilities must be an object when present");
    return;
  }
  const allowed = isChannel(channel) ? IDLE_CAPABILITIES_BY_CHANNEL[channel] : IDLE_CAPABILITIES_BY_CHANNEL.voice;
  for (const [name, declared] of Object.entries(value)) {
    if (declared === undefined) continue;
    // Only voice may dial, and the channel arms are what make that a compile error. Runtime
    // has to say the same thing, or an adapter compiled against a looser version slips through.
    into.require(allowed.includes(name), "manifest.idleCapability.channel", `${path}.${name}`,
      `${channel} providers may not declare ${name}`);
  }
  if (value.personalBrowser !== undefined) {
    const browser = value.personalBrowser;
    if (!isPlainObject(browser)) {
      into.add("manifest.personalBrowser.shape", `${path}.personalBrowser`, "personalBrowser must be an object when present");
    } else {
      validateBrowserAccess(browser.access, `${path}.personalBrowser.access`, into);
      if (browser.accessPolicyScope !== undefined) {
        into.oneOf(browser.accessPolicyScope, ACCESS_POLICY_SCOPES,
          "manifest.personalBrowser.accessPolicyScope", `${path}.personalBrowser.accessPolicyScope`);
      }
    }
  }
  if (value.dial !== undefined) {
    if (!isPlainObject(value.dial)) {
      into.add("manifest.dial.shape", `${path}.dial`, "dial must be an object when present");
    } else {
      into.oneOf(value.dial.destinations, DIAL_DESTINATION_POLICIES,
        "manifest.dial.destinations", `${path}.dial.destinations`);
    }
  }
  for (const flag of ["calendar", "contacts"] as const) {
    if (value[flag] !== undefined) {
      into.require(value[flag] === true, `manifest.idleCapability.value`, `${path}.${flag}`,
        `${flag} is declared by presence: send true or omit it`);
    }
  }
}

export function validateManifest(manifest: unknown, path = "manifest"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(manifest)) {
    into.add("manifest.shape", path, "a manifest must be an object");
    return into.violations;
  }
  into.filled(manifest.id, "manifest.id", `${path}.id`, "a manifest needs a stable id");
  into.filled(manifest.displayName, "manifest.displayName", `${path}.displayName`, "a manifest needs a display name");
  const channelValid = into.oneOf(manifest.channel, CHANNELS, "manifest.channel", `${path}.channel`);

  const versions = manifest.supportedProtocolVersions;
  if (!Array.isArray(versions) || versions.length === 0) {
    into.add("manifest.supportedProtocolVersions", `${path}.supportedProtocolVersions`,
      "an adapter must declare every protocol version it can speak");
  } else {
    versions.forEach((version, index) => {
      into.require(typeof version === "number" && Number.isInteger(version) && version > 0,
        "manifest.supportedProtocolVersions.value", `${path}.supportedProtocolVersions[${index}]`,
        "a protocol version must be a positive integer");
    });
    // Interoperability: the adapter must speak a version this package does, or Omni must refuse
    // to connect. Reported here so it is found with the manifest rather than at connect time.
    const declared = versions.filter((version): version is number => typeof version === "number");
    into.require(negotiateProtocolVersion(declared) !== undefined,
      "manifest.supportedProtocolVersions.interoperable", `${path}.supportedProtocolVersions`,
      `this host speaks protocol version${OMNI_SUPPORTED_PROTOCOL_VERSIONS.length === 1 ? "" : "s"} ${OMNI_SUPPORTED_PROTOCOL_VERSIONS.join(", ")}; the adapter declares none of them`);
  }

  const methods = manifest.authenticationMethods;
  if (!Array.isArray(methods) || methods.length === 0) {
    into.add("manifest.authenticationMethods", `${path}.authenticationMethods`,
      "an adapter must declare at least one authentication method");
  } else {
    methods.forEach((method, index) => {
      if (into.oneOf(method, AUTHENTICATION_METHODS, "manifest.authenticationMethod",
        `${path}.authenticationMethods[${index}]`) && methods.indexOf(method) !== index) {
        into.add("manifest.authenticationMethod.unique", `${path}.authenticationMethods[${index}]`,
          `duplicate authentication method: ${String(method)}`);
      }
    });
  }

  if (channelValid) validateIdleCapabilities(manifest.idleCapabilities, manifest.channel as string, `${path}.idleCapabilities`, into);

  if (manifest.phaseLabels !== undefined) {
    if (!isPlainObject(manifest.phaseLabels)) {
      into.add("manifest.phaseLabels.shape", `${path}.phaseLabels`, "phaseLabels must be an object when present");
    } else {
      for (const [phase, label] of Object.entries(manifest.phaseLabels)) {
        into.oneOf(phase, TASK_PHASES, "manifest.phaseLabels.phase", `${path}.phaseLabels.${phase}`);
        into.filled(label, "manifest.phaseLabels.label", `${path}.phaseLabels.${phase}`, "a phase label must not be empty");
      }
    }
  }

  if (manifest.orgLevels !== undefined) {
    if (!Array.isArray(manifest.orgLevels)) {
      into.add("manifest.orgLevels.shape", `${path}.orgLevels`, "orgLevels must be an array when present");
    } else {
      const ids = new Set<string>();
      let wellFormed = true;
      manifest.orgLevels.forEach((level: unknown, index: number) => {
        const at = `${path}.orgLevels[${index}]`;
        if (!isPlainObject(level)) {
          into.add("manifest.orgLevel.shape", at, "each level must be an object with an id and a label");
          wellFormed = false;
          return;
        }
        if (into.filled(level.id, "manifest.orgLevel.id", `${at}.id`, "a level needs an id")) {
          if (ids.has(level.id as string)) {
            into.add("manifest.orgLevel.unique", `${at}.id`, `duplicate level: ${level.id}`);
            wellFormed = false;
          }
          ids.add(level.id as string);
        } else wellFormed = false;
        if (!into.filled(level.label, "manifest.orgLevel.label", `${at}.label`, "a level needs the label a desk shows for it")) wellFormed = false;
      });
      if (wellFormed && !ids.has("person")) {
        into.add("manifest.orgLevels.person", `${path}.orgLevels`,
          "a declared ladder states the whole ladder and must include person, the subject of every resolution");
      }
    }
  }

  if (manifest.taskTypePresentation !== undefined) {
    if (!isPlainObject(manifest.taskTypePresentation)) {
      into.add("manifest.taskTypePresentation.shape", `${path}.taskTypePresentation`,
        "taskTypePresentation must be an object when present");
    } else {
      for (const [taskType, presentation] of Object.entries(manifest.taskTypePresentation)) {
        const at = `${path}.taskTypePresentation.${taskType}`;
        if (!isPlainObject(presentation)) {
          into.add("manifest.taskTypePresentation.entry", at, "each presentation must be an object");
          continue;
        }
        into.filled(presentation.singular, "manifest.taskTypePresentation.singular", `${at}.singular`, "a presentation needs a singular name");
        into.filled(presentation.plural, "manifest.taskTypePresentation.plural", `${at}.plural`, "a presentation needs a plural name");
        if (presentation.referenceLabel !== undefined) {
          into.filled(presentation.referenceLabel, "manifest.taskTypePresentation.referenceLabel", `${at}.referenceLabel`,
            "referenceLabel must not be empty when present");
        }
      }
    }
  }
  return into.violations;
}

// ---------------------------------------------------------------------------
// Task.
// ---------------------------------------------------------------------------

function validateDestinationDirectory(value: unknown, path: string, into: Collector): void {
  if (value === true) return;
  if (!isPlainObject(value)) {
    into.add("task.destinations.shape", path, "must be true or a destination directory");
    return;
  }
  into.require(typeof value.allowManualEntry === "boolean", "task.destinations.allowManualEntry",
    `${path}.allowManualEntry`, "a directory must say whether manual entry is allowed");
  // A directory with nothing in it and no typing is a control with nothing to offer.
  if (value.allowManualEntry === false && !(Array.isArray(value.destinations) && value.destinations.length > 0)) {
    into.add("task.destinations.offer", path, "a directory with no destinations must allow manual entry, or the control has nothing to offer");
  }
  if (value.destinations === undefined) return;
  if (!Array.isArray(value.destinations)) {
    into.add("task.destinations.list", `${path}.destinations`, "destinations must be an array when present");
    return;
  }
  const seen = new Set<string>();
  value.destinations.forEach((destination: unknown, index: number) => {
    const at = `${path}.destinations[${index}]`;
    if (!isPlainObject(destination)) {
      into.add("task.destination.shape", at, "each destination must be an object");
      return;
    }
    if (into.filled(destination.id, "task.destination.id", `${at}.id`, "a destination needs an id")) {
      if (seen.has(destination.id as string)) into.add("task.destination.unique", `${at}.id`, `duplicate destination id: ${destination.id}`);
      seen.add(destination.id as string);
    }
    into.filled(destination.label, "task.destination.label", `${at}.label`, "a destination needs a label");
    into.filled(destination.address, "task.destination.address", `${at}.address`, "a destination needs an address");
    into.oneOf(destination.kind, DESTINATION_KINDS, "task.destination.kind", `${at}.kind`);
  });
}

function validateDispositions(value: unknown, path: string, into: Collector): void {
  if (value === true) return;
  if (!isPlainObject(value)) {
    into.add("task.dispositions.shape", path, "must be true or a disposition policy");
    return;
  }
  if (value.required !== undefined) {
    into.require(typeof value.required === "boolean", "task.dispositions.required", `${path}.required`,
      "required must be a boolean when present");
  }
  // A code must be collected before completion, so there must be one to collect.
  if (value.required === true && !(Array.isArray(value.codes) && value.codes.length > 0)) {
    into.add("task.dispositions.required.codes", `${path}.codes`, "a required disposition policy must publish at least one code");
  }
  if (value.notes !== undefined) into.oneOf(value.notes, NOTES_POLICIES, "task.dispositions.notes", `${path}.notes`);
  if (value.codes === undefined) return;
  if (!Array.isArray(value.codes)) {
    into.add("task.dispositions.codes", `${path}.codes`, "codes must be an array when present");
    return;
  }
  const seen = new Set<string>();
  value.codes.forEach((code: unknown, index: number) => {
    const at = `${path}.codes[${index}]`;
    if (!isPlainObject(code)) {
      into.add("task.disposition.shape", at, "each disposition code must be an object");
      return;
    }
    if (into.filled(code.id, "task.disposition.id", `${at}.id`, "a disposition code needs an id")) {
      if (seen.has(code.id as string)) into.add("task.disposition.unique", `${at}.id`, `duplicate disposition code: ${code.id}`);
      seen.add(code.id as string);
    }
    into.filled(code.label, "task.disposition.label", `${at}.label`, "a disposition code needs a label");
  });
}

function validateCustomCapabilities(value: unknown, path: string, into: Collector): void {
  if (!Array.isArray(value)) {
    into.add("task.custom.shape", path, "custom must be an array when present");
    return;
  }
  const seen = new Set<string>();
  value.forEach((custom: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(custom)) {
      into.add("task.custom.entry", at, "each custom capability must be an object");
      return;
    }
    if (into.filled(custom.id, "task.custom.id", `${at}.id`, "a custom capability needs an id")) {
      if (seen.has(custom.id as string)) into.add("task.custom.unique", `${at}.id`, `duplicate custom capability: ${custom.id}`);
      seen.add(custom.id as string);
    }
    if (!isPlainObject(custom.ui)) {
      into.add("task.custom.ui", `${at}.ui`, "a custom capability needs a ui description");
      return;
    }
    into.oneOf(custom.ui.control, CUSTOM_UI_CONTROLS, "task.custom.ui.control", `${at}.ui.control`);
    into.filled(custom.ui.label, "task.custom.ui.label", `${at}.ui.label`, "a custom control needs a label");
    into.oneOf(custom.ui.placement, CUSTOM_UI_PLACEMENTS, "task.custom.ui.placement", `${at}.ui.placement`);
    if (custom.ui.render !== undefined) into.oneOf(custom.ui.render, CUSTOM_RENDERS, "task.custom.ui.render", `${at}.ui.render`);
    if (custom.prompt !== undefined) {
      if (!isPlainObject(custom.prompt) || !Array.isArray(custom.prompt.fields)) {
        into.add("task.custom.prompt.shape", `${at}.prompt`, "a prompt is an object with the fields the agent fills");
      } else {
        into.require(custom.prompt.fields.length > 0, "task.custom.prompt.fields", `${at}.prompt.fields`, "a prompt with no fields asks for nothing; omit it");
        custom.prompt.fields.forEach((field: unknown, fieldIndex: number) => {
          const where = `${at}.prompt.fields[${fieldIndex}]`;
          if (!isPlainObject(field)) {
            into.add("task.custom.prompt.field.shape", where, "each prompt field must be an object");
            return;
          }
          into.filled(field.name, "task.custom.prompt.field.name", `${where}.name`, "a prompt field needs a name");
          into.filled(field.label, "task.custom.prompt.field.label", `${where}.label`, "a prompt field needs a label");
          into.oneOf(field.type, CREDENTIAL_FIELD_TYPES, "task.custom.prompt.field.type", `${where}.type`);
        });
      }
    }
  });
}

const DEFAULT_LEVEL_IDS: readonly string[] = DEFAULT_LEVELS.map(level => level.id);
const POLICY_SETTINGS = membersOf<TeamPolicySetting>({ on: true, off: true, agent: true });
const POLICY_KEYS = new Set<string>([
  ...TASK_CAPABILITIES.voice, ...TASK_CAPABILITIES.chat, ...TASK_CAPABILITIES.email, "dial",
].filter(name => name !== "browsers" && name !== "dispositions" && name !== "custom"));
const AGENT_SETTABLE = /^(hold|mute|skill:.+)$/;
const isLocked = (value: unknown): value is Record<string, unknown> => isPlainObject(value) && value.lockedBy !== undefined;

/** The level ids in force: the manifest's, or the defaults when the caller holds no manifest. */
const levelIds = (levels: readonly string[] | undefined): readonly string[] => levels ?? DEFAULT_LEVEL_IDS;

/** `lockedBy`: a declared level other than `person`, who never locks their own value. */
function validateLockedByInto(value: unknown, rule: string, path: string, levels: readonly string[] | undefined, into: Collector): void {
  if (!into.filled(value, rule, path, "lockedBy names the level that locked it")) return;
  into.require(value !== "person", `${rule}.person`, path, "a person never locks their own value");
  into.require(levelIds(levels).includes(value as string), `${rule}.unknown`, path,
    `${String(value)} is not a level this manifest declares: in force are ${levelIds(levels).join(", ")}`);
}

/** `{ lockedBy, reason? }` standing in for a value: who locked it, and a reason if given. */
function validateLockedInto(value: Record<string, unknown>, rule: string, path: string, levels: readonly string[] | undefined, into: Collector): void {
  validateLockedByInto(value.lockedBy, `${rule}.lockedBy`, `${path}.lockedBy`, levels, into);
  if (value.reason !== undefined) into.filled(value.reason, `${rule}.reason`, `${path}.reason`, "a reason must not be empty when present");
}

/** What every resolved value carries: who set it, and who locked it if anyone. */
function validateResolvedInto(value: Record<string, unknown>, rule: string, path: string, levels: readonly string[] | undefined, into: Collector): void {
  if (into.filled(value.setBy, `${rule}.setBy`, `${path}.setBy`, "setBy names who stated the value: a level, or provisioning")) {
    into.require(value.setBy === "provider" || levelIds(levels).includes(value.setBy as string), `${rule}.setBy.unknown`, `${path}.setBy`,
      `${String(value.setBy)} is neither provisioning nor a level this manifest declares`);
  }
  if (value.lockedBy !== undefined) validateLockedByInto(value.lockedBy, `${rule}.lockedBy`, `${path}.lockedBy`, levels, into);
  if (value.reason !== undefined) {
    into.filled(value.reason, `${rule}.reason`, `${path}.reason`, "a reason must not be empty when present");
    into.require(value.lockedBy !== undefined, `${rule}.reason.unexpected`, `${path}.reason`, "a reason goes with lockedBy: it says why it was locked");
  }
}

/** The level ids a manifest puts in force, for validators that receive one. */
function manifestLevels(manifest: unknown): readonly string[] | undefined {
  if (!isPlainObject(manifest)) return undefined;
  const declared = Array.isArray(manifest.orgLevels)
    ? manifest.orgLevels.filter((level: unknown): level is { id: string; label: string } => isPlainObject(level) && typeof level.id === "string")
    : undefined;
  return effectiveLevels(declared).map(level => level.id);
}
const CUSTOM_RENDERS = membersOf<NonNullable<CustomCapability["ui"]["render"]>>({ inline: true, page: true });
const CREDENTIAL_FIELD_TYPES = membersOf<CredentialField["type"]>({ text: true, password: true });

function validateBrowsers(value: unknown, path: string, into: Collector): void {
  if (!Array.isArray(value)) {
    into.add("task.browsers.shape", path, "browsers must be an array");
    return;
  }
  const seen = new Set<string>();
  const names = new Set<string>();
  value.forEach((browser: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(browser)) {
      into.add("task.browser.shape", at, "each browser must be an object");
      return;
    }
    if (into.filled(browser.id, "task.browser.id", `${at}.id`, "a browser needs an id")) {
      if (seen.has(browser.id as string)) into.add("task.browser.unique", `${at}.id`, `duplicate browser id: ${browser.id}`);
      seen.add(browser.id as string);
    }
    // The name is an input to a `TAB_NAME` isolation scheme: two tabs with one name would
    // silently share a session.
    if (into.filled(browser.name, "task.browser.name", `${at}.name`, "a browser needs a name")) {
      if (names.has(browser.name as string)) into.add("task.browser.name.unique", `${at}.name`, `duplicate browser name: ${browser.name}`);
      names.add(browser.name as string);
    }
    into.filled(browser.purpose, "task.browser.purpose", `${at}.purpose`, "a browser needs a purpose");
    if (browser.urlVisibility !== undefined) {
      into.oneOf(browser.urlVisibility, URL_VISIBILITIES, "task.browser.urlVisibility", `${at}.urlVisibility`);
    }

    if (into.filled(browser.url, "task.browser.url", `${at}.url`, "a browser needs a url")) {
      let scheme: string | undefined;
      try { scheme = new URL(browser.url as string).protocol; } catch { scheme = undefined; }
      into.require(scheme !== undefined && ALLOWED_BROWSER_URL_SCHEMES.includes(scheme as "http:" | "https:"),
        "task.browser.url.scheme", `${at}.url`,
        `a browser url must use ${ALLOWED_BROWSER_URL_SCHEMES.join(" or ")}`);
    }

    // Reuse and its scheme travel together. A reusing browser with no scheme would otherwise
    // inherit whatever a host happened to default to, which is how two tasks end up sharing a
    // session nobody intended. The guide names the rule for the missing case.
    if (browser.sharedSession === true) {
      if (browser.isolationScheme === undefined) {
        into.add("task.browser.isolationScheme.required", `${at}.isolationScheme`,
          `a reusing browser must declare one of: ${ISOLATION_SCHEME_VALUES.join(", ")}`);
      } else {
        into.require(ISOLATION_SCHEME_VALUES.includes(browser.isolationScheme as string),
          "task.browser.isolationScheme", `${at}.isolationScheme`,
          `an isolation scheme must be one of: ${ISOLATION_SCHEME_VALUES.join(", ")}`);
      }
    } else if (browser.sharedSession === false) {
      into.require(browser.isolationScheme === undefined, "task.browser.isolationScheme.unexpected",
        `${at}.isolationScheme`, "a browser that does not share its session must not declare an isolation scheme");
    } else {
      into.add("task.browser.sharedSession", `${at}.sharedSession`, "a browser must say whether its session is shared across tasks");
    }
  });
}

function validateTaskAttributes(value: unknown, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    into.add("task.attributes.shape", path, "attributes must be an array when present");
    return;
  }
  const keys = new Set<string>();
  value.forEach((attribute: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(attribute)) {
      into.add("task.attribute.shape", at, "each task attribute must be an object");
      return;
    }
    if (into.filled(attribute.key, "task.attribute.key", `${at}.key`, "a task attribute needs a key")) {
      if (keys.has(attribute.key as string)) into.add("task.attribute.unique", `${at}.key`, `duplicate attribute key: ${attribute.key}`);
      keys.add(attribute.key as string);
    }
    if (attribute.label !== undefined) {
      into.filled(attribute.label, "task.attribute.label", `${at}.label`, "a label must not be empty when present");
    }
    switch (attribute.type) {
      case "text":
        into.require(typeof attribute.value === "string", "task.attribute.text", `${at}.value`, "a text attribute needs a string value");
        break;
      case "contact":
        validateContactInto(attribute.contact, `${at}.contact`, into);
        break;
      case "timestamp":
        into.timestamp(attribute.at, "task.attribute.timestamp", `${at}.at`);
        break;
      default:
        into.add("task.attribute.type", `${at}.type`, `unsupported attribute type: ${String(attribute.type)}`);
    }
  });
}

function validateHandlingHistory(value: unknown, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    into.add("task.handlingHistory.shape", path, "handlingHistory must be an array when present");
    return;
  }
  value.forEach((entry: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      into.add("task.handlingHistory.entry", at, "each handling step must be an object");
      return;
    }
    into.oneOf(entry.step, HANDLING_STEPS, "task.handlingHistory.step", `${at}.step`);
    into.timestamp(entry.at, "task.handlingHistory.at", `${at}.at`);
    if (entry.seconds !== undefined) {
      // Omitted while a leg is still running. Nought is a claim that it took no time.
      into.require(isDurationSeconds(entry.seconds) && (entry.seconds as number) > 0,
        "task.handlingHistory.seconds", `${at}.seconds`,
        "seconds must be a positive whole number; omit it while the step is still running");
    }
    if (entry.by !== undefined) {
      into.require(isUserId(entry.by), "task.handlingHistory.by", `${at}.by`,
        "by must be a non-empty user id; omit it when the person cannot be identified");
      // On `queued` nobody takes part, so there is nothing to name.
      into.require(entry.step !== "queued", "task.handlingHistory.by.unexpected", `${at}.by`,
        "a queued step names nobody");
    }
  });
}

/** Present only while consulting, and only on voice: elsewhere there is nobody to consult. */
const TASK_MEDIA_STATES = membersOf<TaskMediaState>({ started: true, ended: true });

/** Real-time media is a voice affair, and its state is one of two words. */
function validateTaskMedia(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.media.channel", path,
    `a ${channel} task carries no real-time media state`)) return;
  into.oneOf(value, TASK_MEDIA_STATES, "task.media", path);
}

function validateConsultation(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.consultation.channel", path,
    `a ${channel} task cannot carry a consultation`)) return;
  if (!isPlainObject(value)) {
    into.add("task.consultation.shape", path, "a consultation must be an object when present");
    return;
  }
  into.filled(value.destination, "task.consultation.destination", `${path}.destination`,
    "a consultation names the destination being consulted");
  if (value.label !== undefined) {
    into.filled(value.label, "task.consultation.label", `${path}.label`, "a label must not be empty when present");
  }
  if (value.since !== undefined) into.timestamp(value.since, "task.consultation.since", `${path}.since`);
}

const LEAD_STAGES = membersOf<TaskLead["stage"]>({ requested: true, joined: true });

/** The agent's request for a lead. Voice only; `joined` names the lead, `requested` cannot. */
function validateLead(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.lead.channel", path, `a ${channel} task cannot carry a lead request`)) return;
  if (!isPlainObject(value)) {
    into.add("task.lead.shape", path, "lead must be an object when present");
    return;
  }
  if (into.oneOf(value.stage, LEAD_STAGES, "task.lead.stage", `${path}.stage`)) {
    if (value.stage === "joined") {
      into.require(isUserId(value.leadId), "task.lead.leadId", `${path}.leadId`, "a joined lead is named by their user id");
    } else {
      into.require(value.leadId === undefined, "task.lead.leadId.unexpected", `${path}.leadId`,
        "nobody has joined a requested lead, so there is no lead to name");
    }
  }
  if (value.note !== undefined) into.filled(value.note, "task.lead.note", `${path}.note`, "a note must not be empty when present");
  into.timestamp(value.since, "task.lead.since", `${path}.since`);
}

/** The lead's own task for a call they joined. Voice only. */
function validateAssisting(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.assisting.channel", path, `a ${channel} task cannot be a joined call`)) return;
  if (!isPlainObject(value)) {
    into.add("task.assisting.shape", path, "assisting must be an object when present");
    return;
  }
  into.require(isUserId(value.memberId), "task.assisting.memberId", `${path}.memberId`, "a joined call names the member who asked");
  if (value.note !== undefined) into.filled(value.note, "task.assisting.note", `${path}.note`, "a note must not be empty when present");
  into.timestamp(value.since, "task.assisting.since", `${path}.since`);
}

export interface TaskValidationContext {
  /** The provider's channel, from its manifest. A task must agree with it. */
  channel: string;
  /** The level ids in force, from the manifest. The defaults when absent. */
  levels?: readonly string[];
}

export function validateTask(task: unknown, context: TaskValidationContext, path = "task"): ProtocolViolation[] {
  const into = new Collector();
  validateTaskInto(task, context, path, into);
  return into.violations;
}

function validateTaskInto(task: unknown, context: TaskValidationContext, path: string, into: Collector): void {
  if (!isPlainObject(task)) {
    into.add("task.shape", path, "a task must be an object");
    return;
  }
  into.require(isTaskId(task.id), "task.id", `${path}.id`, "a task needs a non-empty id");
  into.filled(task.title, "task.title", `${path}.title`, "a task needs a title");
  into.filled(task.taskType, "task.taskType", `${path}.taskType`, "a task needs a task type");
  into.oneOf(task.phase, TASK_PHASES, "task.phase", `${path}.phase`);
  into.oneOf(task.completionMode, COMPLETION_MODES, "task.completionMode", `${path}.completionMode`);
  // The allowance is coupled to the mode: a provider that will complete the task itself is going
  // to act on the allowance, so it must state one; a provider waiting for `complete` may omit it
  // to say it imposes no deadline. Present, it is a duration either way.
  if (task.wrapAllowance === undefined) {
    into.require(task.completionMode !== "provider-automatic", "task.wrapAllowance.required",
      `${path}.wrapAllowance`, "provider-automatic completion needs an allowance to act on");
  } else {
    into.require(isDurationSeconds(task.wrapAllowance), "task.wrapAllowance", `${path}.wrapAllowance`,
      "wrapAllowance must be a whole number of seconds, zero or more, or omitted under agent-command");
  }

  // The channel is fixed per provider by its manifest, so a task claiming another one is a
  // task Omni would render with the wrong controls.
  into.require(task.channel === context.channel, "task.channel", `${path}.channel`,
    `a ${context.channel} provider may not publish a ${String(task.channel)} task`);

  if (task.reference !== undefined) {
    into.filled(task.reference, "task.reference", `${path}.reference`, "a reference must not be empty when present");
  }
  if (task.party !== undefined) validateContactInto(task.party, `${path}.party`, into, context.levels);

  validateBrowsers(task.browsers, `${path}.browsers`, into);
  validateTaskAttributes(task.attributes, `${path}.attributes`, into);
  validateHandlingHistory(task.handlingHistory, `${path}.handlingHistory`, into);
  validateConsultation(task.consultation, context.channel, `${path}.consultation`, into);
  validateTaskMedia(task.media, context.channel, `${path}.media`, into);
  validateLead(task.lead, context.channel, `${path}.lead`, into);
  validateAssisting(task.assisting, context.channel, `${path}.assisting`, into);

  const capabilities = task.capabilities;
  if (!isPlainObject(capabilities)) {
    into.add("task.capabilities.shape", `${path}.capabilities`, "a task needs a capabilities object");
    return;
  }
  const allowed = isChannel(context.channel) ? TASK_CAPABILITIES[context.channel] : TASK_CAPABILITIES.voice;
  // A task that supplies browser definitions declares the capability that shows them, and one
  // that declares it supplies at least one: the capability puts a panel in the workspace, and a
  // panel with nothing in it is a control with nothing to offer.
  if (Array.isArray(task.browsers) && task.browsers.length > 0 && capabilities.browsers !== true) {
    into.add("task.browsers.capability", `${path}.browsers`, "a task that supplies browsers declares capabilities.browsers");
  }
  if (capabilities.browsers === true && Array.isArray(task.browsers) && task.browsers.length === 0) {
    into.add("task.browsers.required", `${path}.browsers`, "a task that declares capabilities.browsers supplies at least one; with none, omit the capability");
  }
  for (const [name, declared] of Object.entries(capabilities)) {
    if (declared === undefined) continue;
    if (!into.require(allowed.includes(name), "task.capability.channel", `${path}.capabilities.${name}`,
      `a ${context.channel} task may not declare ${name}`)) continue;
    // A control the queue could allow may stand locked in its place, saying whose. What the
    // queue provides -- browsers, dispositions, custom controls -- is content, not a control.
    if (isLocked(declared)) {
      if (into.require(name !== "browsers" && name !== "dispositions" && name !== "custom", "task.capability.locked.unexpected",
        `${path}.capabilities.${name}`, `${name} is what the queue provides, not a control anyone locks`)) {
        validateLockedInto(declared, "task.capability.locked", `${path}.capabilities.${name}`, context.levels, into);
      }
      continue;
    }
    switch (name) {
      case "dispositions": validateDispositions(declared, `${path}.capabilities.dispositions`, into); break;
      case "custom": validateCustomCapabilities(declared, `${path}.capabilities.custom`, into); break;
      case "blindTransfer":
      case "consultTransfer":
      case "conference": validateDestinationDirectory(declared, `${path}.capabilities.${name}`, into); break;
      default:
        // Presence is the permission: the flag capabilities carry no payload, so anything but
        // true is a value a host would have to interpret.
        into.require(declared === true, "task.capability.value", `${path}.capabilities.${name}`,
          `${name} is declared by presence: send true or omit it`);
    }
  }
}

// ---------------------------------------------------------------------------
// Breaks, team, snapshot.
// ---------------------------------------------------------------------------

function validateImposedBreak(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("break.imposed.shape", path, "an imposed break must be an object");
    return;
  }
  // `by` is required either way. Who put somebody off the floor survives whether or not the
  // break ends on a clock -- an imposed break with no origin is a state the agent cannot
  // reason about.
  into.require(isUserId(value.by), "break.imposed.by", `${path}.by`, "an imposed break must say who placed it");

  if (value.endsAutomatically === true) {
    into.timestamp(value.endsAt, "break.imposed.endsAt", `${path}.endsAt`);
  } else if (value.endsAutomatically === false) {
    into.require(value.endsAt === undefined, "break.imposed.endsAt.unexpected", `${path}.endsAt`,
      "a break that does not end automatically must not carry an end time");
  } else {
    into.add("break.imposed.endsAutomatically", `${path}.endsAutomatically`,
      "an imposed break must say whether it ends automatically");
  }
}

function validateBreakState(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("break.shape", path, "break state must be an object");
    return;
  }
  into.oneOf(value.approval, BREAK_APPROVALS, "break.approval", `${path}.approval`);
  into.require(typeof value.mayAsk === "boolean", "break.mayAsk", `${path}.mayAsk`, "mayAsk says whether the agent may ask for a break: a boolean");

  for (const field of ["refusedReason", "decisionReason"] as const) {
    if (value[field] !== undefined) {
      into.filled(value[field], `break.${field}`, `${path}.${field}`, `${field} must not be empty when present`);
    }
  }
  // The refusal is the reason the control is withdrawn; beside `mayAsk: true` it explains nothing.
  if (value.refusedReason !== undefined) {
    into.require(value.mayAsk !== true, "break.refusedReason.mayAsk", `${path}.refusedReason`,
      "refusedReason is shown when mayAsk is false; omit it while the agent may ask");
  }
  if (value.retryAfterMs !== undefined) {
    into.require(typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0,
      "break.retryAfterMs", `${path}.retryAfterMs`, "retryAfterMs must be a non-negative number when present");
  }
  if (value.activeReasonId !== undefined) {
    into.filled(value.activeReasonId, "break.activeReasonId", `${path}.activeReasonId`,
      "activeReasonId must not be empty when present");
    // A break nobody is on has no reason. Reporting one beside `not-requested` describes a
    // break that is not happening.
    into.require(value.approval !== "not-requested", "break.activeReasonId.approval", `${path}.activeReasonId`,
      "activeReasonId must be omitted when no break is requested or in effect");
  }
  if (value.imposed !== undefined) {
    validateImposedBreak(value.imposed, `${path}.imposed`, into);
    // An imposed break is a break somebody placed; beside `not-requested` there is no break.
    into.require(value.approval !== "not-requested", "break.imposed.approval", `${path}.imposed`,
      "an imposed break is a break in progress; not-requested says there is none");
  }

  if (value.reasons === undefined) return;
  if (!Array.isArray(value.reasons)) {
    into.add("break.reasons.shape", `${path}.reasons`, "break reasons must be an array when present");
    return;
  }
  // A provider that defines no codes omits the field: an empty list is a second spelling of that.
  if (value.reasons.length === 0) {
    into.add("break.reasons.empty", `${path}.reasons`, "a provider that defines no reasons omits the field rather than publishing an empty list");
  }
  const seen = new Set<string>();
  value.reasons.forEach((reason: unknown, index: number) => {
    const at = `${path}.reasons[${index}]`;
    if (!isPlainObject(reason)) {
      into.add("break.reason.shape", at, "each break reason must be an object");
      return;
    }
    if (into.filled(reason.id, "break.reason.id", `${at}.id`, "a break reason needs an id")) {
      if (seen.has(reason.id as string)) into.add("break.reason.unique", `${at}.id`, `duplicate break reason id: ${reason.id}`);
      seen.add(reason.id as string);
    }
    into.filled(reason.label, "break.reason.label", `${at}.label`, "a break reason needs a label");
    if (reason.kind !== undefined) into.oneOf(reason.kind, BREAK_KINDS, "break.reason.kind", `${at}.kind`);
    if (reason.alwaysAvailable !== undefined) {
      into.require(reason.alwaysAvailable === true, "break.reason.alwaysAvailable", `${at}.alwaysAvailable`,
        "alwaysAvailable is declared by presence: send true or omit it");
    }
  });
  // The active reason is one of the published ones, or it is a reason Omni cannot name.
  if (typeof value.activeReasonId === "string" && value.activeReasonId.length > 0) {
    into.require(seen.has(value.activeReasonId), "break.activeReasonId.known", `${path}.activeReasonId`,
      `activeReasonId names a reason the provider did not publish: ${value.activeReasonId}`);
  }
}

/**
 * Who is reading what the adapter published, and what their login declares. The validators check
 * structure without it; given it, they also hold what the adapter publishes to the login.
 */
export interface ReaderContext {
  /**
   * The signed-in agent, `AuthenticationState.identity.id`. A lead does not report to themself:
   * a roster that lists them in `members`, or their own ask in `requests`, is a violation.
   */
  self?: UserId;
  /**
   * The login's `AuthenticationState.capabilities`. The login is the permission: a lead's
   * snapshot carries a roster, nobody else's does, and `requests` need `team.consultControl`.
   */
  capabilities?: UserCapabilities;
  /** The level ids in force. Filled from the manifest by `validateSnapshot` and `validateEventEnvelope`; the defaults otherwise. */
  levels?: readonly string[];
  /** The login's `loginId`. A snapshot or event naming another belongs to a login that is gone. */
  loginId?: string;
  /** `ConnectContext.autoAcceptTasks` as sent, absent meaning `true`: whether `task-offered` carries an `acceptanceMode`. */
  autoAcceptTasks?: boolean;
}

export function validateTeamRoster(roster: unknown, path = "team", context: ReaderContext = {}): ProtocolViolation[] {
  const into = new Collector();
  validateTeamRosterInto(roster, path, context, into);
  return into.violations;
}

function validateTeamRosterInto(roster: unknown, path: string, context: ReaderContext, into: Collector): void {
  if (!isPlainObject(roster)) {
    into.add("team.shape", path, "a team roster must be an object");
    return;
  }
  // The login is the permission: a roster reaches a login that declares `capabilities.team` and
  // nobody else. Only a caller holding the login can check it.
  if (context.capabilities !== undefined && context.capabilities.team === undefined) {
    into.add("team.unentitled", path,
      "a roster published to a login that does not declare capabilities.team: the login is the permission");
  }
  // The team's policies travel with the roster exactly when the login may set them.
  if (context.capabilities !== undefined) {
    const may = context.capabilities.team?.policyControl === true;
    if (may && roster.policies === undefined) {
      into.add("team.policies.required", `${path}.policies`, "the login declares team.policyControl, so the roster carries the team's policies");
    }
    if (!may && roster.policies !== undefined) {
      into.add("team.policies.capability", `${path}.policies`, "policies require team.policyControl on the login: a lead who may not set them has nothing to see");
    }
  }
  if (roster.policies !== undefined) validateTeamPoliciesInto(roster.policies, `${path}.policies`, into, context.levels);
  if (roster.requests === undefined) {
    // `[]` says nobody is asking; omission says the lead may not be asked. A login that may be
    // asked therefore always carries the list.
    if (context.capabilities?.team?.consultControl === true) {
      into.add("team.requests.required", `${path}.requests`,
        "the login declares team.consultControl, so the roster carries requests: [] when nobody is asking");
    }
  } else {
    // Requests are what a lead acts on, so a lead who may not act has no business receiving them.
    // Whether they may is on the login, so the check needs the login in hand.
    if (context.capabilities !== undefined) {
      into.require(context.capabilities.team?.consultControl === true, "team.requests.capability", `${path}.requests`,
        "requests require team.consultControl on the login: a lead who may not join has nothing to decide");
    }
    if (!Array.isArray(roster.requests)) {
      into.add("team.requests.shape", `${path}.requests`, "requests must be an array when present");
    } else {
      const seenRequests = new Set<string>();
      roster.requests.forEach((request: unknown, index: number) => {
        const at = `${path}.requests[${index}]`;
        if (!isPlainObject(request)) {
          into.add("team.request.shape", at, "each request must be an object");
          return;
        }
        if (into.filled(request.id, "team.request.id", `${at}.id`, "a request needs an id")) {
          if (seenRequests.has(request.id as string)) into.add("team.request.unique", `${at}.id`, `duplicate request id: ${request.id}`);
          seenRequests.add(request.id as string);
        }
        if (into.require(isUserId(request.memberId), "team.request.memberId", `${at}.memberId`, "a request names the member asking")) {
          into.require(request.memberId !== context.self, "team.request.self", `${at}.memberId`,
            "the roster carries the reader's own ask: an agent's request for a lead goes to whoever leads them");
        }
        into.require(isTaskId(request.taskId), "team.request.taskId", `${at}.taskId`, "a request names the task the lead would join");
        if (request.note !== undefined) into.filled(request.note, "team.request.note", `${at}.note`, "a note must not be empty when present");
        into.timestamp(request.since, "team.request.since", `${at}.since`);
      });
    }
  }
  if (!Array.isArray(roster.members)) {
    into.add("team.members.shape", `${path}.members`, "a roster must carry a members array");
    return;
  }
  const seen = new Set<string>();
  roster.members.forEach((member: unknown, index: number) => {
    const at = `${path}.members[${index}]`;
    if (!isPlainObject(member)) {
      into.add("team.member.shape", at, "each roster member must be an object");
      return;
    }
    if (into.require(isUserId(member.id), "team.member.id", `${at}.id`, "a roster member needs a user id")) {
      if (seen.has(member.id as string)) into.add("team.member.unique", `${at}.id`, `duplicate roster member: ${member.id}`);
      seen.add(member.id as string);
      into.require(member.id !== context.self, "team.member.self", `${at}.id`,
        "the roster carries the agent it is published to: a lead does not report to themself");
    }
    into.oneOf(member.availability, TEAM_AVAILABILITIES, "team.member.availability", `${at}.availability`);
    if (member.since !== undefined) into.timestamp(member.since, "team.member.since", `${at}.since`);
    if (member.break !== undefined) {
      // Only an outstanding request appears here: `not-requested` is absence, `in-effect` is
      // `availability: "on-break"`, and a denial never survives to be reported.
      if (into.oneOf(member.break, MEMBER_BREAKS, "team.member.break", `${at}.break`)) {
        into.require(member.availability !== "signed-out" && member.availability !== "on-break", "team.member.break.availability",
          `${at}.break`, "a member on a break or signed out has no request outstanding");
      }
    }
  });
}

export function validateSnapshot(snapshot: unknown, manifest: unknown, path = "snapshot", context: ReaderContext = {}): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(snapshot)) {
    into.add("snapshot.shape", path, "a snapshot must be an object");
    return into.violations;
  }
  const channel = isPlainObject(manifest) && typeof manifest.channel === "string" ? manifest.channel : "voice";
  const levels = context.levels ?? manifestLevels(manifest);

  into.oneOf(snapshot.transport, TRANSPORT_STATUSES, "snapshot.transport", `${path}.status`);
  if (into.filled(snapshot.loginId, "snapshot.loginId", `${path}.loginId`, "a snapshot needs the login id it belongs to")
    && context.loginId !== undefined) {
    into.require(snapshot.loginId === context.loginId, "snapshot.loginId.mismatch", `${path}.loginId`,
      `a snapshot for session ${String(snapshot.loginId)} on a login whose session is ${context.loginId}`);
  }

  validateBreakState(snapshot.break, `${path}.break`, into);

  // The count is the provider's confirmation of how much work it answered with. Stated, never
  // inferred: an unanswered or blank state lacks it, and cannot pass as a confirmed empty.
  if (into.require(typeof snapshot.taskCount === "number" && Number.isInteger(snapshot.taskCount) && snapshot.taskCount >= 0,
    "snapshot.taskCount", `${path}.taskCount`, "a snapshot states its task count: a whole number, zero or more")
    && Array.isArray(snapshot.tasks)) {
    into.require(snapshot.taskCount === snapshot.tasks.length, "snapshot.taskCount.mismatch", `${path}.taskCount`,
      `taskCount says ${snapshot.taskCount} and tasks carries ${snapshot.tasks.length}: a count that does not reconcile is an answer nobody gave`);
  }
  if (!Array.isArray(snapshot.tasks)) {
    into.add("snapshot.tasks.shape", `${path}.tasks`, "a snapshot must carry a tasks array");
  } else {
    const seen = new Set<string>();
    let assisting: number | undefined;
    snapshot.tasks.forEach((task: unknown, index: number) => {
      validateTaskInto(task, { channel, levels }, `${path}.tasks[${index}]`, into);
      // A lead assists one call at a time.
      if (isPlainObject(task) && task.assisting !== undefined) {
        if (assisting !== undefined) into.add("snapshot.assisting.single", `${path}.tasks[${index}].assisting`, "a lead assists one call at a time");
        assisting = index;
      }
      if (isPlainObject(task) && isTaskId(task.id)) {
        if (seen.has(task.id as string)) into.add("task.id.unique", `${path}.tasks[${index}].id`, `duplicate task id: ${task.id}`);
        seen.add(task.id as string);
      }
    });
  }

  // A break in effect begins when the work ends, so it holds no task. A snapshot reporting both
  // describes a state the agent cannot be in, whichever half is stale.
  if (isPlainObject(snapshot.break) && snapshot.break.approval === "in-effect"
    && Array.isArray(snapshot.tasks) && snapshot.tasks.length > 0) {
    into.add("break.in-effect.tasks", `${path}.tasks`,
      "a break in effect holds no task: it begins when the work ends, and until then the state is starting-after-task");
  }

  // Presence is the permission, and it cuts both ways: data a provider never declared a
  // capability for is data Omni would show against a control the agent does not have.
  const idle = isPlainObject(manifest) && isPlainObject(manifest.idleCapabilities) ? manifest.idleCapabilities : {};
  // And it cuts the other way too: a declared contribution is required, `[]` included. A snapshot
  // that omits one the manifest declares has not cleared it, it has said nothing, and Omni would
  // go on showing whatever it held.
  if (snapshot.contacts === undefined && idle.contacts === true) {
    into.add("snapshot.contacts.required", `${path}.contacts`,
      "the manifest declares contacts, so every snapshot carries the contribution: [] when there are none");
  }
  if (snapshot.scheduledActivities === undefined && idle.calendar === true) {
    into.add("snapshot.calendar.required", `${path}.scheduledActivities`,
      "the manifest declares calendar, so every snapshot carries the contribution: [] when there are none");
  }
  if (snapshot.contacts !== undefined) {
    into.require(idle.contacts === true, "snapshot.contacts.capability", `${path}.contacts`,
      "contacts require the contacts idle capability");
    if (Array.isArray(snapshot.contacts)) {
      snapshot.contacts.forEach((contact: unknown, index: number) =>
        validateContactInto(contact, `${path}.contacts[${index}]`, into));
    } else {
      into.add("snapshot.contacts.shape", `${path}.contacts`, "contacts must be an array when present");
    }
  }
  if (snapshot.scheduledActivities !== undefined) {
    into.require(idle.calendar === true, "snapshot.calendar.capability", `${path}.scheduledActivities`,
      "scheduled activities require the calendar idle capability");
    if (Array.isArray(snapshot.scheduledActivities)) {
      const seen = new Set<string>();
      snapshot.scheduledActivities.forEach((activity: unknown, index: number) => {
        validateScheduledActivityInto(activity, `${path}.scheduledActivities[${index}]`, into);
        if (isPlainObject(activity) && isFilled(activity.id)) {
          if (seen.has(activity.id as string)) {
            into.add("activity.id.unique", `${path}.scheduledActivities[${index}].id`, `duplicate activity id: ${activity.id}`);
          }
          seen.add(activity.id as string);
        }
      });
    } else {
      into.add("snapshot.calendar.shape", `${path}.scheduledActivities`, "scheduledActivities must be an array when present");
    }
  }
  // The login is the permission: a lead's snapshot carries a roster, `[]` included. The other
  // direction -- a roster to a login that does not lead -- is the roster's own rule.
  if (context.capabilities?.team !== undefined && snapshot.team === undefined) {
    into.add("team.required", `${path}.team`,
      "the login declares capabilities.team, so every snapshot carries a roster: [] when nobody is in it");
  }
  if (snapshot.team !== undefined) validateTeamRosterInto(snapshot.team, `${path}.team`, { ...context, levels }, into);

  return into.violations;
}

// ---------------------------------------------------------------------------
// Events.
// ---------------------------------------------------------------------------

function validateTaskOutcome(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("event.taskEnded.outcome.shape", path, "an outcome must be an object");
    return;
  }
  switch (value.type) {
    case "completed":
      into.oneOf(value.by, COMPLETED_BY, "event.taskEnded.outcome.completed", `${path}.by`);
      break;
    case "transferred":
      if (value.destination !== undefined) {
        into.filled(value.destination, "event.taskEnded.outcome.transferred", `${path}.destination`,
          "a destination must not be empty when present");
      }
      break;
    case "cancelled":
      if (value.reason !== undefined) {
        into.filled(value.reason, "event.taskEnded.outcome.cancelled", `${path}.reason`,
          "a reason must not be empty when present");
      }
      break;
    case "expired":
      // Only the phases in which a task is still waiting on somebody can expire.
      into.oneOf(value.phase, EXPIRABLE_PHASES, "event.taskEnded.outcome.expired", `${path}.phase`);
      break;
    case "left":
      break;
    case "failed":
      if (!isPlainObject(value.failure)) {
        into.add("event.taskEnded.outcome.failed", `${path}.failure`, "a failed outcome must carry a failure");
      } else {
        validateFailureInto(value.failure, `${path}.failure`, into);
      }
      break;
    default:
      into.add("event.taskEnded.outcome.type", `${path}.type`, `unsupported outcome: ${String(value.type)}`);
  }
}

function validateQueueSummary(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("event.summary.shape", path, "a provider summary must be an object");
    return;
  }
  into.filled(value.title, "event.summary.title", `${path}.title`, "a summary needs a title");
  if (value.subtitle !== undefined) {
    into.filled(value.subtitle, "event.summary.subtitle", `${path}.subtitle`, "a subtitle must not be empty when present");
  }
  into.require(typeof value.waitingCount === "number" && Number.isInteger(value.waitingCount) && value.waitingCount >= 0,
    "event.summary.waitingCount", `${path}.waitingCount`, "waitingCount must be a whole number, zero or more");
  into.timestamp(value.updatedAt, "event.summary.updatedAt", `${path}.updatedAt`);
  if (value.metrics === undefined) return;
  if (!Array.isArray(value.metrics)) {
    into.add("event.summary.metrics.shape", `${path}.metrics`, "metrics must be an array when present");
    return;
  }
  const ids = new Set<string>();
  value.metrics.forEach((metric: unknown, index: number) => {
    if (isPlainObject(metric) && isFilled(metric.id)) {
      if (ids.has(metric.id as string)) into.add("event.summary.metric.unique", `${path}.metrics[${index}].id`, `duplicate metric id: ${metric.id}`);
      ids.add(metric.id as string);
    }
    const at = `${path}.metrics[${index}]`;
    if (!isPlainObject(metric)) {
      into.add("event.summary.metric.shape", at, "each metric must be an object");
      return;
    }
    into.filled(metric.id, "event.summary.metric.id", `${at}.id`, "a metric needs an id");
    into.filled(metric.label, "event.summary.metric.label", `${at}.label`, "a metric needs a label");
    into.require(typeof metric.value === "string", "event.summary.metric.value", `${at}.value`,
      "a metric value must be a string; the provider decides how it reads");
  });
}

export function validateEventEnvelope(envelope: unknown, manifest: unknown, path = "event", context: ReaderContext = {}): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(envelope)) {
    into.add("event.shape", path, "an event envelope must be an object");
    return into.violations;
  }
  const channel = isPlainObject(manifest) && typeof manifest.channel === "string" ? manifest.channel : "voice";
  const levels = context.levels ?? manifestLevels(manifest);

  into.filled(envelope.id, "event.id", `${path}.id`, "an event needs an id");
  if (into.filled(envelope.loginId, "event.loginId", `${path}.loginId`, "an event needs the login id it belongs to")
    && context.loginId !== undefined) {
    into.require(envelope.loginId === context.loginId, "event.loginId.mismatch", `${path}.loginId`,
      `an event for session ${String(envelope.loginId)} on a login whose session is ${context.loginId}`);
  }
  const idle = isPlainObject(manifest) && isPlainObject(manifest.idleCapabilities) ? manifest.idleCapabilities : {};
  into.timestamp(envelope.occurredAt, "event.occurredAt", `${path}.occurredAt`);

  const event = envelope.event;
  if (!isPlainObject(event)) {
    into.add("event.payload.shape", `${path}.event`, "an envelope must carry an event");
    return into.violations;
  }
  const at = `${path}.event`;

  switch (event.type) {
    case "snapshot":
      into.oneOf(event.reason, SNAPSHOT_REASONS, "event.snapshot.reason", `${at}.reason`);
      into.violations.push(...validateSnapshot(event.snapshot, manifest, `${at}.snapshot`, { ...context, levels }));
      break;
    case "transport-status":
      into.oneOf(event.status, TRANSPORT_STATUSES, "event.transportStatus.status", `${at}.status`);
      // An error says how to revive it; any other status has nothing to revive.
      if (event.status === "error") {
        if (into.require(event.recovery !== undefined, "event.transportStatus.recovery.required", `${at}.recovery`,
          "an error names its recovery: reconnect, or reauthenticate")) {
          into.oneOf(event.recovery, TRANSPORT_RECOVERIES, "event.transportStatus.recovery", `${at}.recovery`);
        }
      } else {
        into.require(event.recovery === undefined, "event.transportStatus.recovery.unexpected", `${at}.recovery`,
          "recovery goes with an error; nothing needs reviving here");
      }
      if (event.message !== undefined) {
        into.filled(event.message, "event.transportStatus.message", `${at}.message`, "a message must not be empty when present");
      }
      break;
    case "break-state":
      validateBreakState(event.break, `${at}.break`, into);
      break;
    case "task-offered":
      validateTaskInto(event.task, { channel, levels }, `${at}.task`, into);
      // An offer introduces work that is not yet under way; work in progress arrives only on a snapshot.
      if (isPlainObject(event.task) && typeof event.task.phase === "string") {
        into.require((OFFERABLE_PHASES as readonly string[]).includes(event.task.phase), "event.taskOffered.phase", `${at}.task.phase`,
          `task-offered introduces a task as ${OFFERABLE_PHASES.join(", ")}, never as ${event.task.phase}`);
      }
      if (event.acceptanceMode !== undefined) {
        into.oneOf(event.acceptanceMode, ACCEPTANCE_MODES, "event.taskOffered.acceptanceMode", `${at}.acceptanceMode`);
      }
      // The mode travels exactly when Omni said tasks may be auto-accepted.
      if (context.autoAcceptTasks === true) {
        into.require(event.acceptanceMode !== undefined, "event.taskOffered.acceptanceMode.required", `${at}.acceptanceMode`,
          "autoAcceptTasks is on, so task-offered carries an acceptanceMode");
      } else if (context.autoAcceptTasks === false) {
        into.require(event.acceptanceMode === undefined, "event.taskOffered.acceptanceMode.unexpected", `${at}.acceptanceMode`,
          "autoAcceptTasks is off, so every task requires agent acceptance and task-offered carries no acceptanceMode");
      }
      for (const field of ["allocationExpiresAt", "preparationEndsAt"] as const) {
        if (event[field] !== undefined) into.timestamp(event[field], `event.taskOffered.${field}`, `${at}.${field}`);
      }
      break;
    case "task-updated":
      validateTaskInto(event.task, { channel, levels }, `${at}.task`, into);
      break;
    case "task-media-started":
      into.require(isTaskId(event.taskId), "event.taskMediaStarted.taskId", `${at}.taskId`, "a task id is required");
      break;
    case "task-media-ended":
      into.require(isTaskId(event.taskId), "event.taskMediaEnded.taskId", `${at}.taskId`, "a task id is required");
      break;
    case "task-ended":
      into.require(isTaskId(event.taskId), "event.taskEnded.taskId", `${at}.taskId`, "a task id is required");
      validateTaskOutcome(event.outcome, `${at}.outcome`, into);
      break;
    case "announcement":
      into.filled(event.text, "event.announcement.text", `${at}.text`, "an announcement needs text");
      into.timestamp(event.announcedAt, "event.announcement.announcedAt", `${at}.announcedAt`);
      if (event.expiresAt !== undefined) into.timestamp(event.expiresAt, "event.announcement.expiresAt", `${at}.expiresAt`);
      if (event.html !== undefined) {
        into.require(typeof event.html === "string", "event.announcement.html", `${at}.html`, "html must be a string when present");
      }
      break;
    case "queue-summary":
      validateQueueSummary(event.summary, `${at}.summary`, into);
      break;
    case "team-updated":
      validateTeamRosterInto(event.team, `${at}.team`, { ...context, levels }, into);
      break;
    case "contacts-updated":
      into.require(idle.contacts === true, "event.contacts.capability", `${at}.contacts`,
        "contacts-updated requires the contacts idle capability");
      if (!Array.isArray(event.contacts)) {
        into.add("event.contacts.shape", `${at}.contacts`, "contacts must be an array");
      } else {
        event.contacts.forEach((contact: unknown, index: number) =>
          validateContactInto(contact, `${at}.contacts[${index}]`, into));
      }
      break;
    case "calendar-updated":
      into.require(idle.calendar === true, "event.calendar.capability", `${at}.scheduledActivities`,
        "calendar-updated requires the calendar idle capability");
      if (!Array.isArray(event.scheduledActivities)) {
        into.add("event.calendar.shape", `${at}.scheduledActivities`, "scheduledActivities must be an array");
      } else {
        const ids = new Set<string>();
        event.scheduledActivities.forEach((activity: unknown, index: number) => {
          validateScheduledActivityInto(activity, `${at}.scheduledActivities[${index}]`, into);
          if (isPlainObject(activity) && isFilled(activity.id)) {
            if (ids.has(activity.id as string)) into.add("activity.id.unique", `${at}.scheduledActivities[${index}].id`, `duplicate activity id: ${activity.id}`);
            ids.add(activity.id as string);
          }
        });
      }
      break;
    default:
      into.add("event.type", `${at}.type`, `unsupported event type: ${String(event.type)}`);
  }
  return into.violations;
}

// ---------------------------------------------------------------------------
// Results. A result crosses the same boundary a snapshot does, from an adapter that may be
// compiled against another version, and Omni shows the agent what it says.
// ---------------------------------------------------------------------------

const PREFERENCE_ID = /^(hold|mute|skill:.+)$/;

/** The choices left to the person, each with where it stands. */
function validatePreferencesInto(value: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!Array.isArray(value)) {
    into.add("preferences.shape", path, "preferences must be an array");
    return;
  }
  const seen = new Set<string>();
  value.forEach((preference: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(preference)) {
      into.add("preference.shape", at, "each preference must be an object");
      return;
    }
    if (into.require(typeof preference.id === "string" && PREFERENCE_ID.test(preference.id), "preference.id", `${at}.id`,
      "a preference is hold, mute, or skill:<id>: nothing else is the person's to set")) {
      if (seen.has(preference.id as string)) into.add("preference.unique", `${at}.id`, `duplicate preference: ${preference.id}`);
      seen.add(preference.id as string);
    }
    into.filled(preference.label, "preference.label", `${at}.label`, "a preference needs a label");
    into.require(typeof preference.enabled === "boolean", "preference.enabled", `${at}.enabled`, "a preference says where it stands");
    validateResolvedInto(preference, "preference", at, levels, into);
  });
}

/** The team's policy per capability as the lead sees it: the setting, who set it, who locked it. */
function validateTeamPoliciesInto(value: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!isPlainObject(value)) {
    into.add("team.policies.shape", path, "policies must be an object keyed by capability");
    return;
  }
  for (const [key, policy] of Object.entries(value)) {
    if (policy === undefined) continue;
    const at = `${path}.${key}`;
    if (!into.require(POLICY_KEYS.has(key) || /^skill:.+$/.test(key), "team.policy.key", at,
      `${key} is not a control a policy can name: a task control, dial, or skill:<id>`)) continue;
    if (!isPlainObject(policy)) {
      into.add("team.policy.shape", at, "each policy carries its setting, who set it, and who locked it if anyone");
      continue;
    }
    if (into.oneOf(policy.setting, POLICY_SETTINGS, "team.policy.setting", `${at}.setting`)) {
      into.require(policy.setting !== "agent" || AGENT_SETTABLE.test(key), "team.policy.agent", `${at}.setting`,
        `${key} is the team's, on or off; only hold, mute and skills may be left to the person`);
    }
    validateResolvedInto(policy, "team.policy", at, levels, into);
    into.require(policy.setBy !== "person", "team.policy.setBy", `${at}.setBy`, "a team policy is not set by a person");
  }
}

/** A `ProtocolFailure`, wherever one appears: on a result, or on a task's failed outcome. */
function validateFailureInto(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("failure.shape", path, "a failure must be an object");
    return;
  }
  if (into.filled(value.code, "failure.code", `${path}.code`, "a failure needs a code")) {
    // A provider names its own codes freely; the `omni.` namespace is the contract's, and a code
    // in it that the contract lacks is one Omni would show without knowing what it means.
    if ((value.code as string).startsWith("omni.")) {
      into.require((OMNI_FAILURE_CODES as readonly string[]).includes(value.code as string), "failure.code.unknown",
        `${path}.code`, `not a contract failure code: ${value.code}`);
    }
  }
  into.filled(value.message, "failure.message", `${path}.message`, "a failure needs a message");
  into.require(typeof value.retryable === "boolean", "failure.retryable", `${path}.retryable`,
    "a failure must say whether it is retryable");
  if (value.retryAfterMs !== undefined) {
    into.require(typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0,
      "failure.retryAfterMs", `${path}.retryAfterMs`, "retryAfterMs must be a non-negative number when present");
  }
}

const URL_VISIBILITIES = membersOf<UrlVisibility>({ full: true, domain: true, hidden: true });
const HOST_AUDIO_REASONS = membersOf<HostAudioUnavailableReason>({ "no-device": true, denied: true, "not-asked": true, "in-use": true, lost: true });
const HOST_OUTPUT_REASONS = membersOf<HostOutputUnavailableReason>({ "no-device": true, lost: true });

function validateUnavailable(value: Record<string, unknown>, rule: string, path: string, into: Collector): void {
  if (value.failure === undefined) {
    into.add(`${rule}.failure.required`, `${path}.failure`, "unavailable carries the failure that says why");
  } else {
    validateFailureInto(value.failure, `${path}.failure`, into);
  }
}

/**
 * Validates the host's report as Omni publishes it to an adapter. This is Omni's output, so the
 * check belongs to the host's own tests and to the harness, which validates whatever host a test
 * hands the adapter.
 */
export function validateHostReport(report: unknown, path = "host"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(report)) {
    into.add("host.shape", path, "a host report must be an object");
    return into.violations;
  }
  into.require(typeof report.online === "boolean", "host.online", `${path}.online`, "a host report says whether it has a network");
  if (report.audio === undefined) return into.violations;
  if (!isPlainObject(report.audio)) {
    into.add("host.audio.shape", `${path}.audio`, "audio must be an object when present, with input and output");
    return into.violations;
  }
  const input = report.audio.input;
  const at = `${path}.audio.input`;
  if (!isPlainObject(input)) {
    into.add("host.audio.input.shape", at, "audio carries its input");
  } else if (input.status === "ready") {
    into.require(typeof input.localAudio === "object" && input.localAudio !== null, "host.audio.input.localAudio", `${at}.localAudio`,
      "a ready input carries the captured microphone");
    into.require(typeof input.flowing === "boolean", "host.audio.input.flowing", `${at}.flowing`,
      "a ready input says whether audio is flowing through it");
    into.require(input.failure === undefined, "host.audio.input.failure.unexpected", `${at}.failure`, "a ready input carries no failure");
    into.require(input.reason === undefined, "host.audio.input.reason.unexpected", `${at}.reason`, "a ready input has no reason to be unavailable");
  } else if (input.status === "unavailable") {
    into.oneOf(input.reason, HOST_AUDIO_REASONS, "host.audio.input.reason", `${at}.reason`);
    validateUnavailable(input, "host.audio.input", at, into);
    into.require(input.localAudio === undefined, "host.audio.input.localAudio.unexpected", `${at}.localAudio`,
      "an unavailable input carries no microphone");
    into.require(input.flowing === undefined, "host.audio.input.flowing.unexpected", `${at}.flowing`,
      "an unavailable input has nothing to flow");
  } else {
    into.add("host.audio.input.status", `${at}.status`, `an input is ready or unavailable, not ${String(input.status)}`);
  }
  const output = report.audio.output;
  const out = `${path}.audio.output`;
  if (!isPlainObject(output)) {
    into.add("host.audio.output.shape", out, "audio carries its output");
  } else if (output.status === "ready") {
    into.require(output.failure === undefined, "host.audio.output.failure.unexpected", `${out}.failure`, "a ready output carries no failure");
    into.require(output.reason === undefined, "host.audio.output.reason.unexpected", `${out}.reason`, "a ready output has no reason to be unavailable");
  } else if (output.status === "unavailable") {
    into.oneOf(output.reason, HOST_OUTPUT_REASONS, "host.audio.output.reason", `${out}.reason`);
    validateUnavailable(output, "host.audio.output", out, into);
  } else {
    into.add("host.audio.output.status", `${out}.status`, `an output is ready or unavailable, not ${String(output.status)}`);
  }
  return into.violations;
}

/** The connection methods whose results `validateResult` knows. */
export type ResultMethod =
  | "execute"
  | "dial"
  | "setCapacity"
  | "requestBreak"
  | "commitBreak"
  | "cancelBreak"
  | "endBreak"
  | "executeTeamBreak"
  | "executeTeamConsult"
  | "openMedia"
  | "setPreference"
  | "executeTeamPolicy";

// Pinned to the result unions: each method's one success status, and the status that carries a
// failure. A method added to `Connection` without a row here is a compile error at the call site.
const RESULT_STATUSES: Record<ResultMethod, { success: string; failure: string }> = {
  execute: { success: "applied", failure: "failed" },
  dial: { success: "dialled", failure: "failed" },
  setCapacity: { success: "accepted", failure: "failed" },
  requestBreak: { success: "requested", failure: "failed" },
  commitBreak: { success: "committed", failure: "failed" },
  cancelBreak: { success: "cancelled", failure: "failed" },
  endBreak: { success: "ended", failure: "failed" },
  executeTeamBreak: { success: "applied", failure: "failed" },
  executeTeamConsult: { success: "applied", failure: "failed" },
  openMedia: { success: "opened", failure: "unavailable" },
  setPreference: { success: "applied", failure: "failed" },
  executeTeamPolicy: { success: "applied", failure: "failed" },
};

/**
 * Validates what a connection method answered. A result is untrusted for the same reason a
 * snapshot is: it comes from an adapter that may be compiled against another version, and Omni
 * shows the agent what it says. A status the method does not answer, a failure status without a
 * failure, a success carrying one, or an `omni.` code the contract lacks are each refused.
 */
export function validateResult(result: unknown, method: ResultMethod, path = "result"): ProtocolViolation[] {
  const into = new Collector();
  const statuses = RESULT_STATUSES[method];
  if (!isPlainObject(result)) {
    into.add("result.shape", path, `${method} must answer an object`);
    return into.violations;
  }
  if (result.status === statuses.success) {
    into.require(result.failure === undefined, "result.failure.unexpected", `${path}.failure`,
      `${statuses.success} carries no failure`);
    if (method === "openMedia") {
      into.require(isPlainObject(result.session), "result.session", `${path}.session`, "opened carries the media session");
    }
  } else if (result.status === statuses.failure) {
    if (result.failure === undefined) {
      into.add("result.failure.required", `${path}.failure`, `${statuses.failure} carries the failure that says why`);
    } else {
      validateFailureInto(result.failure, `${path}.failure`, into);
    }
  } else {
    into.add("result.status", `${path}.status`,
      `${method} answers ${statuses.success} or ${statuses.failure}, not ${String(result.status)}`);
  }
  return into.violations;
}

// ---------------------------------------------------------------------------
// Authentication.
// ---------------------------------------------------------------------------

function validateUser(value: unknown, rule: string, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add(rule, path, "an identity must be an object");
    return;
  }
  into.require(isUserId(value.id), `${rule}.id`, `${path}.id`, "an identity needs a provider-issued user id");
  into.filled(value.displayName, `${rule}.displayName`, `${path}.displayName`, "an identity needs a display name");
}

function validateUserCapabilitiesInto(value: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!isPlainObject(value)) {
    into.add("authentication.capabilities.shape", path,
      "a usable login declares its capabilities: an object, {} when it has none");
    return;
  }
  for (const [name, declared] of Object.entries(value)) {
    if (declared === undefined) continue;
    if (!into.require((SESSION_CAPABILITIES as readonly string[]).includes(name), "authentication.capability.unknown",
      `${path}.${name}`, `unsupported session capability: ${name}`)) continue;
    if (name === "preferences") {
      if (Array.isArray(declared) && declared.length === 0) {
        into.add("authentication.capability.preferences.empty", `${path}.preferences`,
          "a login with nothing left to the person omits preferences rather than declaring an empty list");
      }
      validatePreferencesInto(declared, `${path}.preferences`, into, levels);
      continue;
    }
    if (name === "team") {
      if (!isPlainObject(declared)) {
        into.add("authentication.capability.team.shape", `${path}.team`,
          "team names what the lead may do: an object, {} for a lead with no controls");
        continue;
      }
      for (const [control, on] of Object.entries(declared)) {
        if (on === undefined) continue;
        if (!into.require((TEAM_CAPABILITIES as readonly string[]).includes(control), "authentication.capability.team.unknown",
          `${path}.team.${control}`, `unsupported team capability: ${control}`)) continue;
        into.require(on === true, "authentication.capability.value", `${path}.team.${control}`,
          `${control} is declared by presence: send true or omit it`);
      }
      continue;
    }
    into.require(declared === true, "authentication.capability.value", `${path}.${name}`,
      `${name} is declared by presence: send true or omit it`);
  }
}

/** What a login is validated against beyond its own shape. */
export interface LoginValidationContext {
  /** The level ids in force, from the manifest. The defaults when absent. */
  levels?: readonly string[];
}

export function validateAuthenticationState(state: unknown, path = "authentication", context: LoginValidationContext = {}): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(state)) {
    into.add("authentication.shape", path, "an authentication state must be an object");
    return into.violations;
  }
  if (!into.oneOf(state.status, AUTHENTICATION_STATUSES, "authentication.status", `${path}.status`)) {
    return into.violations;
  }

  // Only `authenticated` may carry an expiry, and only the states that know who the agent is
  // may carry an identity. Anything else is a state claiming knowledge it does not have.
  if (state.status === "authenticated" || state.status === "refreshing") {
    validateUser(state.identity, "authentication.identity", `${path}.identity`, into);
    validateUserCapabilitiesInto(state.capabilities, `${path}.capabilities`, into, context.levels);
  } else if (state.status === "expired") {
    if (state.identity !== undefined) validateUser(state.identity, "authentication.identity", `${path}.identity`, into);
    if (state.failure !== undefined) {
      if (!isPlainObject(state.failure)) {
        into.add("authentication.failure.shape", `${path}.failure`, "a failure must be an object when present");
      } else {
        into.filled(state.failure.code, "authentication.failure.code", `${path}.failure.code`, "a failure needs a code");
        into.filled(state.failure.message, "authentication.failure.message", `${path}.failure.message`, "a failure needs a message");
        into.require(typeof state.failure.retryable === "boolean", "authentication.failure.retryable",
          `${path}.failure.retryable`, "a failure must say whether it is retryable");
      }
    }
  } else {
    into.require(state.identity === undefined, "authentication.identity.unexpected", `${path}.identity`,
      `${state.status} must not carry an identity`);
  }

  if (state.failure !== undefined) {
    into.require(state.status === "expired", "authentication.failure.unexpected", `${path}.failure`,
      "only an expired state may carry a failure");
  }
  if (state.expiresAt !== undefined) {
    into.require(state.status === "authenticated", "authentication.expiresAt.unexpected", `${path}.expiresAt`,
      "only an authenticated state may carry an expiry");
    into.timestamp(state.expiresAt, "authentication.expiresAt", `${path}.expiresAt`);
  }
  if (state.status !== "authenticated" && state.status !== "refreshing") {
    into.require(state.capabilities === undefined, "authentication.capabilities.unexpected", `${path}.capabilities`,
      `${state.status} must not carry capabilities`);
  }
  return into.violations;
}
