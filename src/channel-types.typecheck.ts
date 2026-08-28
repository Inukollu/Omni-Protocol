import {
  AuthenticationMethod,
  OMNI_PROTOCOL_VERSION,
  type Manifest,
  type Task,
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
    // @ts-expect-error Dial is available only to a voice backend.
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
  completionMode: "agent-command", completionAllowance: 60,
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
  completionMode: "agent-command", completionAllowance: 60,
} satisfies Task<"email">;
