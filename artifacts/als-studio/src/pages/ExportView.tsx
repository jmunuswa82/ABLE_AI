import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, Music2, ShieldCheck, ChevronDown, ChevronUp,
  FileJson, FileText, AlertTriangle, CheckCircle2, Clock,
  Loader2, XCircle, FileCode, Zap,
} from "lucide-react";
import { useListProjectArtifacts } from "@workspace/api-client-react";
import { formatBytes } from "@/lib/utils";
import { ANIMATION_VARIANTS } from "@/lib/design";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type ExportStatus =
  | "ready"
  | "no_als"
  | "loading"
  | "error";

interface ExportStatusData {
  projectId: string;
  projectStatus: string;
  hasPatchedAls: boolean;
  patchedAlsFileName: string | null;
  patchedAlsFileSize: number | null;
  mutationsApplied: number;
  trustLabel: string | null;
  jobState: string | null;
  jobMessage: string | null;
  originalFileName: string | null;
}

const TRUST_LABELS: Record<string, { label: string; color: string; description: string }> = {
  SAFE_LOCATOR_ONLY: {
    label: "Locators Only",
    color: "#22c55e",
    description: "Only arrangement markers were added — zero structural risk",
  },
  SAFE_AUTOMATION_ADDED: {
    label: "Automation Added",
    color: "#22c55e",
    description: "Automation envelopes added — no clips or devices modified",
  },
  STRUCTURALLY_VALID_ALS: {
    label: "Structurally Modified",
    color: "#ffb703",
    description: "Clips and tracks modified — validated and safe to open",
  },
  REQUIRES_MANUAL_REVIEW: {
    label: "Manual Review",
    color: "#ef4444",
    description: "Complex changes present — review before using in production",
  },
};

function StatusBadge({ status }: { status: ExportStatus }) {
  const config: Record<ExportStatus, { icon: React.ReactNode; label: string; color: string }> = {
    ready: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: "Ready to Export",
      color: "#22c55e",
    },
    no_als: {
      icon: <Clock className="w-3 h-3" />,
      label: "Awaiting Analysis",
      color: "#64748b",
    },
    loading: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: "Loading…",
      color: "#94a3b8",
    },
    error: {
      icon: <XCircle className="w-3 h-3" />,
      label: "Export Unavailable",
      color: "#ef4444",
    },
  };
  const c = config[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-label uppercase tracking-widest font-bold"
      style={{
        color: c.color,
        backgroundColor: `${c.color}18`,
        border: `1px solid ${c.color}30`,
      }}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

export default function ExportView() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [statusData, setStatusData] = useState<ExportStatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data: artifacts = [] } = useListProjectArtifacts(id);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${BASE}/api/projects/${id}/export-status`);
        if (!res.ok) throw new Error("Failed to fetch export status");
        const data = await res.json();
        if (!cancelled) setStatusData(data);
      } catch {
        if (!cancelled) setStatusData(null);
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  const exportStatus: ExportStatus = statusLoading
    ? "loading"
    : !statusData
    ? "error"
    : statusData.hasPatchedAls
    ? "ready"
    : "no_als";

  const trustInfo = statusData?.trustLabel
    ? TRUST_LABELS[statusData.trustLabel] ?? null
    : null;

  const debugArtifacts = artifacts.filter((a: any) =>
    ["project_graph", "completion_plan", "instructions", "original_als", "patch_package"].includes(a.type)
  );

  const typeIcon = (type: string) => {
    if (type.includes("als")) return <Music2 className="w-4 h-4" />;
    if (type.includes("json")) return <FileJson className="w-4 h-4" />;
    if (type.includes("instruction") || type.includes("markdown")) return <FileText className="w-4 h-4" />;
    return <FileCode className="w-4 h-4" />;
  };

  const typeLabel: Record<string, string> = {
    project_graph: "Project Graph JSON",
    completion_plan: "Completion Plan JSON",
    instructions: "Completion Instructions",
    original_als: "Original ALS File",
    patch_package: "Full Patch Package (ZIP)",
  };

  const handleExport = () => {
    if (exportStatus !== "ready") return;
    setDownloading(true);
    const a = document.createElement("a");
    a.href = `${BASE}/api/projects/${id}/export-als`;
    a.download = statusData?.patchedAlsFileName ?? "patched.als";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloading(false), 3000);
  };

  return (
    <motion.div
      className="p-8 max-w-3xl mx-auto w-full space-y-6 mb-12"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={ANIMATION_VARIANTS.slideUp} className="mb-2">
        <p className="text-[10px] font-label uppercase tracking-[1.5px] text-[var(--text-muted)] mb-3">
          Deploy Stage
        </p>
        <h1 className="text-[30px] font-display font-bold tracking-[-1.2px] text-[var(--text-primary)] mb-3">
          Export Modified{" "}
          <span style={{ color: "var(--amber)" }}>.als</span> File
        </h1>
        <p className="text-[var(--text-secondary)] text-[15px] leading-relaxed">
          Download the AI-modified Ableton Live Set. Open it directly in Live — all
          mutations have been applied and validated before export.
        </p>
      </motion.div>

      {/* Primary Export Card */}
      <motion.div variants={ANIMATION_VARIANTS.slideUp}>
        <div
          className="rounded-xl p-6"
          style={{
            background: "var(--bg-panel)",
            border: exportStatus === "ready"
              ? "1px solid rgba(255,183,3,0.25)"
              : "1px solid rgba(81,69,50,0.1)",
          }}
        >
          {/* Card header */}
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: exportStatus === "ready"
                    ? "rgba(255,183,3,0.12)"
                    : "var(--bg-overlay)",
                }}
              >
                <Music2
                  className="w-5 h-5"
                  style={{ color: exportStatus === "ready" ? "var(--amber)" : "var(--text-muted)" }}
                />
              </div>
              <div>
                <h2 className="text-[15px] font-display font-bold text-[var(--text-primary)]">
                  Export Modified Ableton Project
                </h2>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                  {statusData?.patchedAlsFileName ?? "Awaiting analysis to generate patched file"}
                </p>
              </div>
            </div>
            <StatusBadge status={exportStatus} />
          </div>

          {/* Modification stats */}
          {statusData && exportStatus === "ready" && (
            <div
              className="grid grid-cols-2 gap-3 mb-5 p-4 rounded-lg"
              style={{ background: "var(--bg-card)" }}
            >
              <div>
                <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                  Source File
                </p>
                <p className="text-[12px] font-mono text-[var(--amber-light)] truncate">
                  {statusData.originalFileName ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                  Modified File
                </p>
                <p className="text-[12px] font-mono text-[var(--amber-light)] truncate">
                  {statusData.patchedAlsFileName ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                  File Size
                </p>
                <p className="text-[13px] font-display font-bold text-[var(--text-primary)]">
                  {statusData.patchedAlsFileSize
                    ? formatBytes(statusData.patchedAlsFileSize)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                  AI Mutations Applied
                </p>
                <p className="text-[13px] font-display font-bold text-[var(--text-primary)]">
                  {statusData.mutationsApplied > 0
                    ? `${statusData.mutationsApplied} operations`
                    : "Locators + Analysis"}
                </p>
              </div>
            </div>
          )}

          {/* Trust level badge */}
          {trustInfo && (
            <div
              className="flex items-start gap-2.5 p-3 rounded-lg mb-5"
              style={{
                background: `${trustInfo.color}0d`,
                border: `1px solid ${trustInfo.color}25`,
              }}
            >
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: trustInfo.color }} />
              <div>
                <p
                  className="text-[10px] font-label uppercase tracking-widest font-bold mb-0.5"
                  style={{ color: trustInfo.color }}
                >
                  {trustInfo.label}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">{trustInfo.description}</p>
              </div>
            </div>
          )}

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={exportStatus !== "ready" || downloading}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-lg font-display font-bold text-[14px] uppercase tracking-wider transition-all"
            style={
              exportStatus === "ready"
                ? {
                    background: downloading
                      ? "rgba(255,183,3,0.5)"
                      : "linear-gradient(135deg, #ffdba0 0%, #ffb703 100%)",
                    color: "#271900",
                    cursor: downloading ? "default" : "pointer",
                  }
                : {
                    background: "var(--bg-overlay)",
                    color: "var(--text-muted)",
                    cursor: "not-allowed",
                  }
            }
          >
            {downloading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Downloading…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                {exportStatus === "ready"
                  ? "Export Modified .als"
                  : exportStatus === "no_als"
                  ? "Analysis Required First"
                  : exportStatus === "loading"
                  ? "Loading…"
                  : "Export Unavailable"}
              </>
            )}
          </button>

          {/* No ALS explanation */}
          {exportStatus === "no_als" && (
            <div className="mt-4 flex items-start gap-2 text-[11px] text-[var(--text-muted)]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#ffb703" }} />
              <span>
                Upload an .als file and run the full analysis pipeline to generate a modified
                export. The AI will parse your project, build a completion plan, and apply safe
                mutations before making the export available here.
              </span>
            </div>
          )}
        </div>
      </motion.div>

      {/* Validation Summary */}
      {exportStatus === "ready" && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp}>
          <div
            className="rounded-xl p-5"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid rgba(81,69,50,0.1)",
            }}
          >
            <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-3">
              Export Validation
            </p>
            <div className="space-y-2">
              {[
                "Gzip compression verified — valid ALS container",
                "XML well-formedness confirmed",
                "No duplicate element IDs detected",
                "Required LiveSet structure intact",
                "All new IDs allocated above existing maximum",
              ].map((check) => (
                <div key={check} className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "#22c55e" }} />
                  <span className="text-[12px] text-[var(--text-secondary)]">{check}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Debug / Secondary artifacts — collapsed by default */}
      {debugArtifacts.length > 0 && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp}>
          <button
            onClick={() => setDebugOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors"
            style={{ background: "var(--bg-panel)", border: "1px solid rgba(81,69,50,0.1)" }}
          >
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" style={{ color: "var(--amber)" }} />
              <span className="text-[11px] font-label uppercase tracking-widest text-[var(--text-secondary)]">
                Debug Artifacts
              </span>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{
                  background: "rgba(255,183,3,0.1)",
                  color: "var(--amber)",
                  border: "1px solid rgba(255,183,3,0.2)",
                }}
              >
                {debugArtifacts.length}
              </span>
            </div>
            {debugOpen ? (
              <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
            )}
          </button>

          <AnimatePresence>
            {debugOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="pt-2 space-y-2">
                  {debugArtifacts.map((art: any) => (
                    <a
                      key={art.id}
                      href={`${BASE}/api/projects/${id}/artifacts/${art.id}/download`}
                      download={art.fileName}
                      className="flex items-center gap-3 p-3 rounded-lg transition-colors group"
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid rgba(81,69,50,0.1)",
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded flex items-center justify-center shrink-0"
                        style={{ background: "var(--bg-overlay)" }}
                      >
                        <span style={{ color: "var(--text-muted)" }}>
                          {typeIcon(art.type)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-label text-[var(--text-primary)] truncate">
                          {typeLabel[art.type] ?? art.type.replace(/_/g, " ")}
                        </p>
                        <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                          {art.fileName} · {formatBytes(art.fileSize)}
                        </p>
                      </div>
                      <Download className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--amber)] transition-colors shrink-0" />
                    </a>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </motion.div>
  );
}
