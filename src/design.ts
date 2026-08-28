export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export type Density = "compact" | "comfortable" | "spacious";

/** Semantic values consumed by Omni's layout, independent of a CSS framework. */
export interface DesignTokens {
  accent: string;
  accentText: string;
  surface: string;
  surfaceMuted: string;
  selected: string;
  text: string;
  mutedText: string;
  border: string;
  info: string;
  success: string;
  warning: string;
  danger: string;
  radius: string;
  radiusLarge: string;
  shadow: string;
  controlFont: string;
  controlWeight: string;
  controlTracking: string;
  controlHeight: string;
}

export type ControlKind =
  | "button"
  | "icon-button"
  | "checkbox"
  | "input"
  | "textarea"
  | "select"
  | "tabs"
  | "menu"
  | "badge"
  | "card"
  | "progress";

export interface DesignLanguageManifest {
  id: string;
  displayName: string;
  supportedThemes: ReadonlyArray<ResolvedTheme>;
  supportedControls: ReadonlyArray<ControlKind>;
  defaultDensity: Density;
}

export interface DesignLanguage {
  manifest: DesignLanguageManifest;
  tokens: Record<ResolvedTheme, DesignTokens>;
}

/**
 * A framework bridge can use any native control representation: an Angular
 * component type, a React component, or an Omni DOM renderer. The protocol
 * deliberately does not make one UI framework part of the ABI.
 */
export interface DesignLanguageAdapter<TControl = unknown> {
  readonly language: DesignLanguage;
  resolveControl(kind: ControlKind): TControl | Promise<TControl>;
}

export function defineDesignLanguage<TControl, T extends DesignLanguageAdapter<TControl>>(adapter: T): T {
  return adapter;
}

/** Maps semantic tokens to the stable CSS custom properties understood by Omni. */
export function designTokenProperties(tokens: DesignTokens): Record<string, string> {
  return {
    "--omni-accent": tokens.accent,
    "--omni-accent-text": tokens.accentText,
    "--omni-surface": tokens.surface,
    "--omni-surface-muted": tokens.surfaceMuted,
    "--omni-selected": tokens.selected,
    "--omni-text": tokens.text,
    "--omni-muted-text": tokens.mutedText,
    "--omni-border": tokens.border,
    "--omni-info": tokens.info,
    "--omni-success": tokens.success,
    "--omni-warning": tokens.warning,
    "--omni-danger": tokens.danger,
    "--omni-radius": tokens.radius,
    "--omni-radius-large": tokens.radiusLarge,
    "--omni-shadow": tokens.shadow,
    "--omni-control-font": tokens.controlFont,
    "--omni-control-weight": tokens.controlWeight,
    "--omni-control-tracking": tokens.controlTracking,
    "--omni-control-height": tokens.controlHeight,
  };
}
