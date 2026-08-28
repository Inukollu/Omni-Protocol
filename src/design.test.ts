import { describe, expect, it } from "vitest";
import {
  defineDesignLanguage,
  designTokenProperties,
  type ControlKind,
  type DesignTokens,
} from "./design.js";

const tokens: DesignTokens = {
  accent: "#2563eb", accentText: "#fff", surface: "#fff", surfaceMuted: "#f8fafc",
  selected: "#dbeafe", text: "#0f172a", mutedText: "#64748b", border: "#cbd5e1",
  info: "#0284c7", success: "#16a34a", warning: "#ca8a04", danger: "#dc2626",
  radius: ".5rem", radiusLarge: ".75rem", shadow: "0 1px 3px #0002",
  controlFont: "system-ui", controlWeight: "600", controlTracking: "normal",
  controlHeight: "2.5rem",
};

describe("design-language protocol", () => {
  it("keeps framework control types inferred", async () => {
    class NativeControl {}
    const adapter = defineDesignLanguage({
      language: {
        manifest: {
          id: "sample", displayName: "Sample", supportedThemes: ["light", "dark"],
          supportedControls: ["button"], defaultDensity: "comfortable",
        },
        tokens: { light: tokens, dark: { ...tokens, surface: "#020617", text: "#f8fafc" } },
      },
      resolveControl: async (_kind: ControlKind) => NativeControl,
    });
    expect(await adapter.resolveControl("button")).toBe(NativeControl);
  });

  it("maps styles to stable Omni properties", () => {
    expect(designTokenProperties(tokens)["--omni-control-height"]).toBe("2.5rem");
  });
});
