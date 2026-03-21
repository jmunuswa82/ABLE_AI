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

export function formatBars(bars: number): string {
  return `${Math.round(bars)} bars`;
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
    kick: "#e05252", snare: "#e07a52", hihat: "#c4a84f", ride: "#c4c44f",
    clap: "#e08c52", percussion: "#d4804f", bass: "#4f8cd4", rumble: "#4f68d4",
    synth_stab: "#8c52d4", lead: "#a852d4", drone: "#5284d4", texture: "#527cd4",
    fx: "#52d4c4", vocal: "#d452a8", return_fx: "#528cd4", transition: "#d4c452",
    utility: "#888888", unknown: "#555555",
  };
  return roleColors[role] ?? "#666666";
}
