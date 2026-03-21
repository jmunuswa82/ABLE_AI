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

export function beatsToPixel(beat: number, pixelsPerBar: number): number {
  return (beat / 4) * pixelsPerBar;
}

export function pixelToBeats(px: number, pixelsPerBar: number): number {
  return (px / pixelsPerBar) * 4;
}

export function snapToBar(beat: number): number {
  return Math.round(beat / 4) * 4;
}

export function beatToBarNumber(beat: number): number {
  return Math.floor(beat / 4) + 1;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return `${Math.round(score * 100)}%`;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "parsing": case "queued": return "text-[#94a3b8]";
    case "parsed": case "analyzed": case "generated": return "text-[#ffb703]";
    case "exporting": case "generating": return "text-[#ffdba0]";
    case "exported": return "text-[#22c55e]";
    case "failed": return "text-[#ef4444]";
    case "uploaded": return "text-[#ffb703]";
    default: return "text-[#64748b]";
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
    kick: "#FF3636", snare: "#FF6236", hihat: "#ffb703", ride: "#ffdba0",
    clap: "#FF5E36", percussion: "#FF8836", bass: "#3b82f6", rumble: "#3660FF",
    synth_stab: "#8b5cf6", lead: "#C840FF", drone: "#845BFF", texture: "#6E5BFF",
    fx: "#36D4C4", vocal: "#FF36B4", return_fx: "#36A0FF", transition: "#FFD836",
    pad: "#D45BFF", acid: "#C8FF36", atmo: "#C880FF",
    utility: "#888888", unknown: "#666666",
  };
  return roleColors[role] ?? "#888888";
}

const ABLETON_PALETTE_70: string[] = [
  "#FF3636", "#FF7600", "#ffb703", "#FFE100", "#D4FF00", "#73FF00",
  "#00FF6B", "#00FFCC", "#00EEFF", "#00AAFF", "#0055FF", "#6B00FF",
  "#CC00FF", "#FF00CC", "#FF0077", "#FF0000",
  "#C82800", "#C85E00", "#C88C00", "#C8B400", "#A0C800", "#5AC800",
  "#00C872", "#00C8A0", "#00B4C8", "#0087C8", "#0050C8", "#5000C8",
  "#9600C8", "#C800A0", "#C80055", "#C80000",
  "#8C1A00", "#8C4200", "#8C6600", "#8C7A00", "#6E8C00", "#3C8C00",
  "#008C47", "#008C72", "#007A8C", "#005A8C", "#00368C", "#36008C",
  "#64008C", "#8C0064", "#8C0036", "#8C0000",
  "#FF9B9B", "#FFCC9B", "#FFE09B", "#FFEE9B", "#F0FF9B", "#CCFF9B",
  "#9BFFBB", "#9BFFE6", "#9BFFFF", "#9BE6FF", "#9BBBFF", "#9B9BFF",
  "#C49BFF", "#E09BFF", "#FF9BE0", "#FF9BB2",
  "#FFFFFF", "#D4D4D4", "#AAAAAA", "#808080",
  "#505050", "#282828",
];

export function getAbletonColor(colorIndex: number | null | undefined, fallback = "#888888"): string {
  if (colorIndex == null || colorIndex < 0) return fallback;
  const base = colorIndex % 70;
  return ABLETON_PALETTE_70[base] ?? fallback;
}

export function getTrackColor(colorIndex: number | null | undefined): string {
  return getAbletonColor(colorIndex, "#888888");
}
