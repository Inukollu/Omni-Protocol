import {
  BackendAuthenticationMethod,
  OMNI_PROTOCOL_VERSION,
  type BackendManifest,
  type BackendTask,
} from "./index.js";

export const voiceManifest = {
  id: "voice-provider",
  displayName: "Voice Provider",
  channel: "voice",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: [BackendAuthenticationMethod.BrowserSSO],
  idleCapabilities: {
    dial: { enabled: true, destinationPolicy: "any-number" },
  },
} satisfies BackendManifest<"voice">;

export const chatManifest = {
  id: "chat-provider",
  displayName: "Chat Provider",
  channel: "chat",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: [BackendAuthenticationMethod.Credentials],
  idleCapabilities: {
    contacts: true,
    // @ts-expect-error Dial is available only to a voice backend.
    dial: { enabled: true, destinationPolicy: "any-number" },
  },
} satisfies BackendManifest<"chat">;

export const emailTask = {
  id: "email-1",
  title: "Reply to customer",
  channel: "email",
  taskType: "Customer Support",
  capabilities: { browsers: true, dispositions: true },
  phase: "active",
  browsers: [],
  wrapSeconds: 60,
} satisfies BackendTask<"email">;

export const invalidEmailTask = {
  id: "email-2",
  title: "Reply to customer",
  channel: "email",
  taskType: "Customer Support",
  capabilities: {
    // @ts-expect-error Hold is not an email task capability.
    hold: true,
  },
  phase: "active",
  browsers: [],
  wrapSeconds: 60,
} satisfies BackendTask<"email">;
