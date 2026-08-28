// Compile-time assertions on the contract's channel arms and unions. Nothing here runs; every
// `@ts-expect-error` is a shape the contract must refuse, paired with the shape it must accept.
import {
  BROWSER_ISOLATION_SCHEMES,
  OMNI_PROTOCOL_VERSION,
  type Manifest,
  type Task,
  type TaskBrowser,
  type TaskCommand,
} from "./index.js";

export const voiceManifest = {
  id: "voice-provider",
  displayName: "Voice Provider",
  channel: "voice",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: ["browser-sso"],
  idleCapabilities: {
    dial: { destinationPolicy: "any-number" },
  },
} satisfies Manifest<"voice">;

export const chatManifest = {
  id: "chat-provider",
  displayName: "Chat Provider",
  channel: "chat",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: ["credentials"],
  idleCapabilities: {
    contacts: true,
    // @ts-expect-error Dial is available only to a voice provider.
    dial: { destinationPolicy: "any-number" },
  },
} satisfies Manifest<"chat">;

export const emailTask = {
  id: "email-1",
  title: "Reply to customer",
  channel: "email",
  taskType: "Customer Support",
  capabilities: { browsers: true, dispositions: true },
  phase: "in-progress",
  browsers: [],
  completionMode: "agent-command",
  completionAllowance: 60,
} satisfies Task<"email">;

export const invalidEmailTask = {
  id: "email-2",
  title: "Reply to customer",
  channel: "email",
  taskType: "Customer Support",
  capabilities: {
    // @ts-expect-error Hold is not an email task capability.
    hold: true,
  },
  phase: "in-progress",
  browsers: [],
  completionMode: "agent-command",
  completionAllowance: 60,
} satisfies Task<"email">;

// A reusing browser declares its scheme, and a browser that does not reuse declares none.
// There is no default: sharing a signed-in session is a decision, not something to inherit.
export const reusingBrowser = {
  id: "crm", name: "CRM", purpose: "Contact record", url: "https://crm.example.com/contact/42",
  reuse: true,
  isolationScheme: BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME,
} satisfies TaskBrowser;

export const isolatedBrowser = {
  id: "kb", name: "Knowledge", purpose: "Article lookup", url: "https://kb.example.com/",
  reuse: false,
} satisfies TaskBrowser;

// Each refused shape sits on one line so the directive above it covers wherever tsc anchors it.
// @ts-expect-error A reusing browser with no isolation scheme does not compile.
export const reusingBrowserWithoutAScheme: TaskBrowser = { id: "crm", name: "CRM", purpose: "Contact record", url: "https://crm.example.com/contact/42", reuse: true };
// @ts-expect-error A browser that does not reuse has no scheme to declare.
export const isolatedBrowserWithAScheme: TaskBrowser = { id: "kb", name: "Knowledge", purpose: "Article lookup", url: "https://kb.example.com/", reuse: false, isolationScheme: BROWSER_ISOLATION_SCHEMES.TAB_NAME };

// Every command reaches the provider through `execute`; the union is the channel's whole set.
export const voiceMute: TaskCommand<"voice"> = { type: "mute", muted: true };
export const chatPause: TaskCommand<"chat"> = { type: "pause" };
// @ts-expect-error Chat has no microphone to mute.
export const chatMute: TaskCommand<"chat"> = { type: "mute", muted: true };
// @ts-expect-error DTMF is not a task command: the tones travel with the audio, which is Omni's.
export const voiceDtmf: TaskCommand<"voice"> = { type: "dtmf", digits: "12" };

// The allowance is coupled to the mode: a provider that completes the task itself must say when;
// one waiting for `complete` may leave the deadline open.
export const untimedAgentCommandTask = { ...emailTask, id: "email-3", completionMode: "agent-command", completionAllowance: undefined } satisfies Task<"email">;
export const timedProviderAutomaticTask = { ...emailTask, id: "email-4", completionMode: "provider-automatic", completionAllowance: 0 } satisfies Task<"email">;
// @ts-expect-error provider-automatic completion needs an allowance to act on.
export const untimedProviderAutomaticTask: Task<"email"> = { ...emailTask, id: "email-5", completionMode: "provider-automatic", completionAllowance: undefined };
