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

export function getTrackColor(colorIndex: number | null | undefined): string {
  const abletonPalette = [
    "#FF3636", "#FF6636", "#FF9936", "#FFCC36", "#FFFF36", "#CCFF36",
    "#99FF36", "#36FF36", "#36FF99", "#36FFCC", "#36FFFF", "#36CCFF",
    "#3699FF", "#3636FF", "#9936FF", "#CC36FF", "#FF36FF", "#FF36CC",
    "#FF3699", "#D45B5B", "#D48C5B", "#D4B85B", "#D4D45B", "#B8D45B",
    "#8CD45B", "#5BD45B", "#5BD48C", "#5BD4B8", "#5BD4D4", "#5BB8D4",
    "#5B8CD4", "#5B5BD4", "#8C5BD4", "#B85BD4", "#D45BD4", "#D45BB8",
  ];
  if (colorIndex == null || colorIndex < 0 || colorIndex >= abletonPalette.length) {
    return "#888888";
  }
  return abletonPalette[colorIndex];
}
