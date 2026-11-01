/**
 * Design engine.
 *
 * Maps a requested style/theme/palette onto the token set that the components
 * consume. No CSS is invented at assembly time: every value either comes from the
 * specification (palette) or from `knowledge/design.json` (style/theme defaults).
 */
import type { DesignSpec } from '@assembler/project-spec';
import type { DesignKnowledge } from './knowledge.js';

export interface DesignTokens {
  readonly styleName: string;
  readonly theme: string;
  /** Named colour preset applied on top of the style, or `default`. */
  readonly presetName: string;
  readonly presetLabel: string;
  readonly colorBg: string;
  readonly colorBgGradient: string;
  readonly colorText: string;
  readonly colorTextMuted: string;
  readonly colorBorder: string;
  readonly colorSurface: string;
  readonly colorHover: string;
  readonly colorInput: string;
  readonly colorPrimary: string;
  readonly colorPrimaryHover: string;
  readonly colorPrimaryContrast: string;
  readonly colorFocus: string;
  readonly colorDanger: string;
  readonly colorSuccess: string;
  readonly radiusSm: string;
  readonly radiusMd: string;
  readonly radiusLg: string;
  readonly spaceXs: string;
  readonly spaceSm: string;
  readonly spaceMd: string;
  readonly spaceLg: string;
  readonly spaceXl: string;
  readonly shadowSm: string;
  readonly shadowMd: string;
  readonly blur: string;
  readonly borderStrength: string;
  readonly fontSans: string;
  readonly fontSerif: string;
  readonly fontXs: string;
  readonly fontSm: string;
  readonly fontMd: string;
  readonly fontLg: string;
  readonly fontXl: string;
  readonly fontXxl: string;
  readonly transition: string;
  readonly headerHeight: string;
  readonly sidebarWidth: string;
  readonly contentMaxWidth: string;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match?.[1] === undefined) return null;
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');
}

/** WCAG relative luminance, used to pick a readable foreground colour. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (rgb === null) return 0.5;
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function rgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (rgb === null) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function mix(hex: string, other: string, ratio: number): string {
  const a = parseHex(hex);
  const b = parseHex(other);
  if (a === null || b === null) return hex;
  return `#${toHex(a.r + (b.r - a.r) * ratio)}${toHex(a.g + (b.g - a.g) * ratio)}${toHex(a.b + (b.b - a.b) * ratio)}`;
}

export interface ComputedDesign {
  readonly tokens: DesignTokens;
  readonly palette: readonly string[];
  readonly styleSearchTags: readonly string[];
}

const STYLE_SEARCH_TAGS: Readonly<Record<string, readonly string[]>> = {
  editorial: ['editorial', 'serif', 'publication'],
  glassmorphism: ['glass', 'translucent', 'blur'],
  neumorphism: ['neumorphic', 'soft'],
  minimal: ['minimal', 'clean'],
  material: ['material', 'elevation'],
  default: [],
};

export function computeDesign(design: DesignSpec, knowledge: DesignKnowledge): ComputedDesign {
  const theme = design.theme === 'system' ? 'dark' : design.theme;
  const themeTokens = knowledge.themes[theme] ?? knowledge.themes.dark;
  const style = knowledge.styles[design.style] ?? knowledge.styles.default;
  if (themeTokens === undefined || style === undefined) {
    throw new Error('Design knowledge is missing a theme or style definition');
  }

  const requestedPreset = design.preset === '' ? 'default' : design.preset;
  const preset = knowledge.presets?.[requestedPreset];
  const presetPalette = preset?.recommendedPalettes[theme] ?? preset?.recommendedPalettes.dark;

  // Precedence: colours the user named explicitly, then the named preset for the
  // active theme, then the style's recommended palette. A preset never silently
  // overrides a colour the request asked for.
  const palette =
    design.palette.length > 0
      ? design.palette
      : (presetPalette ?? style.recommendedPalettes[theme] ?? style.recommendedPalettes.dark ?? ['#0f172a', '#3b82f6']);
  const colorBg = palette[0] ?? themeTokens.colorBg;
  const colorPrimary = palette[1] ?? '#6366f1';
  const colorFocus = palette[2] ?? colorPrimary;
  const isDark = theme === 'dark';
  const surfaceAlpha = Number(themeTokens.surfaceOpacity);
  // A preset owns its background, so it also owns the gradient laid over it;
  // keeping the theme's navy gradient under a nord background would fight it.
  const colorBgGradient =
    preset === undefined
      ? themeTokens.colorBgGradient
      : isDark
        ? `radial-gradient(circle at 20% 0%, ${mix(colorBg, colorPrimary, 0.24)} 0%, ${colorBg} 55%)`
        : `linear-gradient(180deg, #ffffff 0%, ${colorBg} 100%)`;

  const tokens: DesignTokens = {
    styleName: design.style,
    theme,
    presetName: preset === undefined ? 'default' : requestedPreset,
    presetLabel: preset?.label ?? 'Default',
    colorBg,
    colorBgGradient,
    colorText: themeTokens.colorText,
    colorTextMuted: themeTokens.colorTextMuted,
    colorBorder: themeTokens.colorBorder,
    colorSurface: rgba(isDark ? '#ffffff' : '#ffffff', isDark ? surfaceAlpha : 0.72),
    colorHover: rgba(colorPrimary, isDark ? 0.18 : 0.12),
    colorInput: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.85)',
    colorPrimary,
    colorPrimaryHover: mix(colorPrimary, isDark ? '#ffffff' : '#000000', 0.16),
    colorPrimaryContrast: relativeLuminance(colorPrimary) > 0.55 ? '#0b1020' : '#ffffff',
    colorFocus,
    colorDanger: themeTokens.colorDanger,
    colorSuccess: themeTokens.colorSuccess,
    radiusSm: style.radiusSm,
    radiusMd: style.radiusMd,
    radiusLg: style.radiusLg,
    spaceXs: knowledge.spacing['xs'] ?? '4px',
    spaceSm: knowledge.spacing['sm'] ?? '8px',
    spaceMd: knowledge.spacing['md'] ?? '16px',
    spaceLg: knowledge.spacing['lg'] ?? '24px',
    spaceXl: knowledge.spacing['xl'] ?? '40px',
    shadowSm: style.shadowSm,
    shadowMd: style.shadowMd,
    blur: design.style === 'glassmorphism' ? style.blur : '0px',
    borderStrength: style.borderStrength,
    fontSans: knowledge.type.fontSans,
    fontSerif: knowledge.type.fontSerif ?? "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    fontXs: knowledge.type.scale.xs,
    fontSm: knowledge.type.scale.sm,
    fontMd: knowledge.type.scale.md,
    fontLg: knowledge.type.scale.lg,
    fontXl: knowledge.type.scale.xl,
    fontXxl: knowledge.type.scale.xxl,
    transition: knowledge.motion.transition,
    headerHeight: knowledge.layout.headerHeight,
    sidebarWidth: knowledge.layout.sidebarWidth,
    contentMaxWidth: knowledge.layout.contentMaxWidth,
  };

  return {
    tokens,
    palette,
    styleSearchTags: [...(STYLE_SEARCH_TAGS[design.style] ?? []), ...(preset === undefined ? [] : [requestedPreset])],
  };
}
