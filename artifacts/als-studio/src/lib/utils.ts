import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function beatsToBar(beats: number): number {
  return beats / 4;
}

export function formatBars(beats: number): string {
  return `${Math.round(beatsToBar(beats))} bars`;
}

/**
 * Canonical beat → pixel conversion.
 * All timeline geometry must go through this function.
 * @param beat - position in beats (quarter notes)
 * @param pixelsPerBar - zoom level in px/bar (1 bar = 4 beats)
 * @returns pixel offset from timeline origin
 */
export function beatsToPixel(beat: number, pixelsPerBar: number): number {
  return (beat / 4) * pixelsPerBar;
}

/**
 * Pixel → beat conversion (inverse of beatsToPixel).
 */
export function pixelToBeats(px: number, pixelsPerBar: number): number {
  return (px / pixelsPerBar) * 4;
}

/**
 * Snap a beat value to the nearest bar boundary (multiple of 4 beats).
 */
export function snapToBar(beat: number): number {
  return Math.round(beat / 4) * 4;
}

/**
 * Return the bar number (1-indexed) for a given beat position.
 */
export function beatToBarNumber(beat: number): number {
  return Math.floor(beat / 4) + 1;
}

/**
 * Format a beat range as a bar label, e.g. "Bars 5–12".
 */
export function formatBarRange(startBeat: number, endBeat: number): string {
  const s = beatToBarNumber(startBeat);
  const e = beatToBarNumber(endBeat);
  if (s === e) return `Bar ${s}`;
  return `Bars ${s}–${e}`;
}

/**
 * Compute a set of bar ruler tick marks for the given beat range and pixel width.
 * Returns every Nth bar so labels don't crowd.
 */
export function computeBarTicks(
  startBeat: number,
  endBeat: number,
  pixelsPerBar: number,
  minLabelSpacingPx = 48,
): Array<{ beat: number; bar: number; px: number; label: boolean }> {
  const totalBars = Math.ceil((endBeat - startBeat) / 4);
  // How often to show a label (every 1, 2, 4, 8, 16 bars)
  const step = [1, 2, 4, 8, 16].find(n => n * pixelsPerBar >= minLabelSpacingPx) ?? 16;

  const ticks = [];
  for (let bar = 0; bar <= totalBars; bar++) {
    const beat = startBeat + bar * 4;
    ticks.push({
      beat,
      bar: beatToBarNumber(beat),
      px: beatsToPixel(beat - startBeat, pixelsPerBar),
      label: bar % step === 0,
    });
  }
  return ticks;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return `${Math.round(score * 100)}%`;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "parsing": case "queued": return "text-blue-400";
    case "parsed": case "analyzed": case "generated": return "text-green-400";
    case "exporting": case "generating": return "text-yellow-400";
    case "exported": return "text-emerald-400";
    case "failed": return "text-red-400";
    case "uploaded": return "text-sky-400";
    default: return "text-gray-400";
  }
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: "Created", uploaded: "Uploaded", queued: "Queued",
    parsing: "Parsing...", parsed: "Parsed", analyzing: "Analyzing...",
    analyzed: "Analyzed", generating: "Generating...", generated: "Generated",
    exporting: "Exporting...", exported: "Complete", failed: "Failed",
    partial_success: "Partial",
  };
  return labels[status] ?? status;
}

export function isJobRunning(state: string): boolean {
  return ["queued", "parsing", "analyzing", "generating", "exporting"].includes(state);
}

export function getRoleColor(role: string): string {
  const roleColors: Record<string, string> = {
    kick: "#FF3636", snare: "#FF6236", hihat: "#FFA336", ride: "#FFCC36",
    clap: "#FF5E36", percussion: "#FF8836", bass: "#5B8CFF", rumble: "#3660FF",
    synth_stab: "#D45BFF", lead: "#C840FF", drone: "#845BFF", texture: "#6E5BFF",
    fx: "#36D4C4", vocal: "#FF36B4", return_fx: "#36A0FF", transition: "#FFD836",
    pad: "#D45BFF", acid: "#C8FF36", atmo: "#C880FF",
    utility: "#888888", unknown: "#666666",
  };
  return roleColors[role] ?? "#888888";
}

// Full Ableton Live color palette (70 base colors + extended)
// Derived from analyzing ALS files and comparing to Ableton's UI.
// The 70 "base" colors correspond to Ableton's clip/track color picker.
// Extended indices (70-209) are darker/secondary variants.
// Track ColorIndex in Ableton 11+ can be 140-209 (dark section of picker).
const ABLETON_PALETTE_70: string[] = [
  // Row 0 — Vivid warm (reds, oranges, yellows)
  "#FF3636", "#FF7600", "#FFAA00", "#FFE100", "#D4FF00", "#73FF00",  // 0–5
  // Row 0 — Vivid cool (greens, teals, blues, purples)
  "#00FF6B", "#00FFCC", "#00EEFF", "#00AAFF", "#0055FF", "#6B00FF",  // 6–11
  // Row 0 — Vivid pink/magenta
  "#CC00FF", "#FF00CC", "#FF0077", "#FF0000",                         // 12–15
  // Row 1 — Medium warm
  "#C82800", "#C85E00", "#C88C00", "#C8B400", "#A0C800", "#5AC800",  // 16–21
  // Row 1 — Medium cool
  "#00C872", "#00C8A0", "#00B4C8", "#0087C8", "#0050C8", "#5000C8",  // 22–27
  // Row 1 — Medium purple/pink
  "#9600C8", "#C800A0", "#C80055", "#C80000",                         // 28–31
  // Row 2 — Saturated warm (more orange/amber range)
  "#8C1A00", "#8C4200", "#8C6600", "#8C7A00", "#6E8C00", "#3C8C00",  // 32–37
  // Row 2 — Saturated cool
  "#008C47", "#008C72", "#007A8C", "#005A8C", "#00368C", "#36008C",  // 38–43
  // Row 2 — Saturated purple/pink
  "#64008C", "#8C0064", "#8C0036", "#8C0000",                         // 44–47
  // Row 3 — Pastel/light warm
  "#FF9B9B", "#FFCC9B", "#FFE09B", "#FFEE9B", "#F0FF9B", "#CCFF9B",  // 48–53
  // Row 3 — Pastel/light cool
  "#9BFFBB", "#9BFFE6", "#9BFFFF", "#9BE6FF", "#9BBBFF", "#9B9BFF",  // 54–59
  // Row 3 — Pastel purple/pink
  "#C49BFF", "#E09BFF", "#FF9BE0", "#FF9BB2",                         // 60–63
  // Row 4 — Neutral/grey
  "#FFFFFF", "#D4D4D4", "#AAAAAA", "#808080",                         // 64–67
  "#505050", "#282828",                                                // 68–69
];

export function getAbletonColor(colorIndex: number | null | undefined, fallback = "#888888"): string {
  if (colorIndex == null || colorIndex < 0) return fallback;
  const base = colorIndex % 70;
  return ABLETON_PALETTE_70[base] ?? fallback;
}

export function getTrackColor(colorIndex: number | null | undefined): string {
  return getAbletonColor(colorIndex, "#888888");
}
