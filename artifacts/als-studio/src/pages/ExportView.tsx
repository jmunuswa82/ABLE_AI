/**
 * ExportView — "Deploy" page.
 *
 * Lifecycle states:
 *   PIPELINE_PENDING   — analysis still running
 *   AWAITING_SELECTION — pipeline done, no mutations applied yet
 *   COMPILING          — apply job running
 *   READY              — patched ALS available for download
 *   FAILED             — apply job failed
 */
import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download, Music2, ShieldCheck, ChevronDown, ChevronUp,
  FileJson, FileText, AlertTriangle, CheckCircle2,
  Loader2, XCircle, FileCode, Zap, Play, Brain, ListChecks,
  RotateCcw,
} from "lucide-react";
import { useListProjectArtifacts } from "@workspace/api-client-react";
import { useProjectPolling } from "@/hooks/use-polling";
import { PipelineStatus } from "@/components/PipelineStatus";
import { formatBytes } from "@/lib/utils";
import { ANIMATION_VARIANTS } from "@/lib/design";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface ExportStatusData {
  projectStatus: string;
  hasPatchedAls: boolean;
  patchedAlsFileName: string | null;
  patchedAlsFileSize: number | null;
  mutationsApplied: number;
  trustLabel: string | null;
  applyJobState: string | null;
  applyJobMessage: string | null;
  applyJobError: string | null;
  jobState: string | null;
}

type ExportLifecycle =
  | "LOADING"
  | "PIPELINE_PENDING"
  | "AWAITING_SELECTION"
  | "COMPILING"
  | "READY"
  | "FAILED";

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
    description: "Clips and tracks modified — validated and safe to open in Live",
  },
  REQUIRES_MANUAL_REVIEW: {
    label: "Manual Review",
    color: "#ef4444",
    description: "Complex changes present — review before using in production",
  },
};

const PIPELINE_IN_PROGRESS = new Set([
  "uploaded", "parsing", "analyzing", "generating", "exporting", "queued",
]);

function deriveLifecycle(
  projectStatus: string | undefined,
  exportStatus: ExportStatusData | null
): ExportLifecycle {
  if (!projectStatus) return "LOADING";
  if (PIPELINE_IN_PROGRESS.has(projectStatus)) return "PIPELINE_PENDING";

  if (!exportStatus) return "LOADING";

  if (exportStatus.hasPatchedAls) return "READY";

  const applyState = exportStatus.applyJobState;
  if (applyState === "queued" || applyState === "applying") return "COMPILING";
  if (applyState === "failed") return "FAILED";

  // project is "exported" but no patched ALS and no apply job — await selection
  return "AWAITING_SELECTION";
}

export default function ExportView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();

  const { projectDetail: project } = useProjectPolling(id);
  const { data: artifacts = [] } = useListProjectArtifacts(id);

  const [exportStatus, setExportStatus] = useState<ExportStatusData | null>(null);
  const [exportStatusLoading, setExportStatusLoading] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lifecycle = deriveLifecycle(project?.status, exportStatus);

  // Poll export-status — more frequently when compiling
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const r = await fetch(`${BASE}/api/projects/${id}/export-status`);
        if (!cancelled && r.ok) {
          const data = await r.json();
          setExportStatus(data);
          setExportStatusLoading(false);
        }
      } catch {
        if (!cancelled) setExportStatusLoading(false);
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = lifecycle === "COMPILING" ? 2000 : 5000;
      pollTimerRef.current = setTimeout(async () => {
        await fetchStatus();
        scheduleNext();
      }, delay);
    };

    fetchStatus().then(scheduleNext);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [id, lifecycle === "COMPILING"]);

  const trustInfo = exportStatus?.trustLabel
    ? TRUST_LABELS[exportStatus.trustLabel] ?? null
    : null;

  const debugArtifacts = (artifacts as any[]).filter((a) =>
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
    if (lifecycle !== "READY") return;
    setDownloading(true);
    const a = document.createElement("a");
    a.href = `${BASE}/api/projects/${id}/export-als`;
    a.download = exportStatus?.patchedAlsFileName ?? "patched.als";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setDownloading(false), 3000);
  };

  if (!project || lifecycle === "LOADING") {
    return (
      <div className="p-4 md:p-8 flex items-center gap-3 text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="font-label text-[11px] uppercase tracking-widest">Loading…</span>
      </div>
    );
  }

  return (
    <motion.div
      className="p-4 md:p-8 max-w-3xl mx-auto w-full space-y-5 md:space-y-6 mb-12"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={ANIMATION_VARIANTS.slideUp} className="mb-2">
        <p className="text-[10px] font-label uppercase tracking-[1.5px] text-[var(--text-muted)] mb-3">
          Deploy Stage
        </p>
        <h1 className="text-[22px] md:text-[30px] font-display font-bold tracking-[-1.2px] text-[var(--text-primary)] mb-3">
          Export Modified{" "}
          <span style={{ color: "var(--amber)" }}>.als</span> File
        </h1>
        <p className="text-[var(--text-secondary)] text-[15px] leading-relaxed">
          Select AI completion actions, apply them to your session, then download the
          patched Ableton Live Set.
        </p>
      </motion.div>

      {/* Pipeline status strip */}
      <motion.div variants={ANIMATION_VARIANTS.slideUp}>
        <div
          className="rounded-xl p-5"
          style={{
            background: "var(--bg-panel)",
            border: lifecycle === "READY"
              ? "1px solid rgba(34,197,94,0.15)"
              : lifecycle === "COMPILING"
              ? "1px solid rgba(255,183,3,0.15)"
              : lifecycle === "FAILED"
              ? "1px solid rgba(239,68,68,0.15)"
              : "1px solid rgba(81,69,50,0.1)",
          }}
        >
          <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-4">
            Pipeline State · {project.name}
          </p>
          <PipelineStatus status={project.status} jobs={project.jobs ?? []} />
        </div>
      </motion.div>

      {/* ── PIPELINE_PENDING ─────────────────────────────────────────────── */}
      {lifecycle === "PIPELINE_PENDING" && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp}>
          <div
            className="rounded-xl p-5 flex items-start gap-3"
            style={{
              background: "rgba(255,183,3,0.05)",
              border: "1px solid rgba(255,183,3,0.15)",
            }}
          >
            <Brain className="w-4 h-4 shrink-0 mt-0.5 text-[var(--amber)]" />
            <div>
              <p className="text-[12px] font-label uppercase tracking-widest text-[var(--amber)] font-bold mb-1">
                Analysis in Progress
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                The export will become available once the full pipeline completes. This page
                refreshes automatically.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── AWAITING_SELECTION ───────────────────────────────────────────── */}
      {lifecycle === "AWAITING_SELECTION" && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp}>
          <div
            className="rounded-xl p-6 space-y-4"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid rgba(255,183,3,0.2)",
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgba(255,183,3,0.12)" }}
              >
                <ListChecks className="w-5 h-5" style={{ color: "var(--amber)" }} />
              </div>
              <div>
                <h2 className="text-[16px] font-display font-bold text-[var(--text-primary)] mb-1">
                  Select Mutations to Apply
                </h2>
                <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
                  Your project has been analysed. Go to the Completion Strategy page, choose
                  which AI actions to apply, then click "Apply Selected" to compile the patched
                  .als file.
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate(`/projects/${id}/plan`)}
              className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg font-display font-bold text-[13px] uppercase tracking-wider transition-all"
              style={{
                background: "linear-gradient(135deg, #ffdba0 0%, #ffb703 100%)",
                color: "#271900",
              }}
            >
              <ListChecks className="w-4 h-4" />
              Select Completion Actions
            </button>
          </div>
        </motion.div>
      )}

      {/* ── COMPILING ────────────────────────────────────────────────────── */}
      {lifecycle === "COMPILING" && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp}>
          <div
            className="rounded-xl p-6 space-y-3"
            style={{
              background: "rgba(255,183,3,0.05)",
              border: "1px solid rgba(255,183,3,0.25)",
            }}
          >
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--amber)" }} />
              <div>
                <p className="text-[14px] font-display font-bold text-[var(--amber)]">
                  Compiling Mutations
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {exportStatus?.applyJobMessage ?? "Applying selected AI mutations to your ALS file…"}
                </p>
              </div>
            </div>
            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ background: "var(--bg-overlay)" }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--amber)" }}
                animate={{ width: ["20%", "80%", "20%"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </div>
        </motion.div>
      )}

      {/* ── FAILED ──────────────────────────────────────────────────────── */}
      {lifecycle === "FAILED" && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp}>
          <div
            className="rounded-xl p-5 space-y-3"
            style={{
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.2)",
            }}
          >
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" />
              <div>
                <p className="text-[13px] font-display font-bold text-red-400 mb-1">
                  Compilation Failed
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {exportStatus?.applyJobError ?? "The apply job encountered an error."}
                </p>
              </div>
            </div>
            <button
              onClick={() => navigate(`/projects/${id}/plan`)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-label uppercase tracking-wider transition-colors"
              style={{
                background: "rgba(239,68,68,0.1)",
                color: "#ef4444",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Try Again — Select Mutations
            </button>
          </div>
        </motion.div>
      )}

      {/* ── READY ────────────────────────────────────────────────────────── */}
      {lifecycle === "READY" && (
        <>
          <motion.div variants={ANIMATION_VARIANTS.slideUp}>
            <div
              className="rounded-xl p-6"
              style={{
                background: "var(--bg-panel)",
                border: "1px solid rgba(255,183,3,0.25)",
              }}
            >
              {/* Card header */}
              <div className="flex items-start justify-between gap-4 mb-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "rgba(255,183,3,0.12)" }}
                  >
                    <Music2 className="w-5 h-5" style={{ color: "var(--amber)" }} />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-display font-bold text-[var(--text-primary)]">
                      Patched .als Ready
                    </h2>
                    <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                      {exportStatus?.patchedAlsFileName ?? "patched.als"}
                    </p>
                  </div>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-label uppercase tracking-widest font-bold shrink-0"
                  style={{
                    color: "#22c55e",
                    backgroundColor: "rgba(34,197,94,0.08)",
                    border: "1px solid rgba(34,197,94,0.2)",
                  }}
                >
                  <CheckCircle2 className="w-3 h-3" /> Ready
                </span>
              </div>

              {exportStatus && (
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 p-3 md:p-4 rounded-lg"
                  style={{ background: "var(--bg-card)" }}
                >
                  <div>
                    <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                      Source File
                    </p>
                    <p className="text-[12px] font-mono text-[var(--amber-light)] truncate">
                      {project.originalFileName ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                      Modified File
                    </p>
                    <p className="text-[12px] font-mono text-[var(--amber-light)] truncate">
                      {exportStatus.patchedAlsFileName ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                      File Size
                    </p>
                    <p className="text-[13px] font-display font-bold text-[var(--text-primary)]">
                      {exportStatus.patchedAlsFileSize
                        ? formatBytes(exportStatus.patchedAlsFileSize)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-1">
                      Mutations Applied
                    </p>
                    <p className="text-[13px] font-display font-bold text-[var(--text-primary)]">
                      {exportStatus.mutationsApplied > 0
                        ? `${exportStatus.mutationsApplied} operations`
                        : "Locators + Analysis"}
                    </p>
                  </div>
                </div>
              )}

              {/* Trust badge */}
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

              {/* Download button */}
              <button
                onClick={handleExport}
                disabled={downloading}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-lg font-display font-bold text-[14px] uppercase tracking-wider transition-all min-h-[48px] sticky bottom-4 z-10 md:static md:bottom-auto md:z-auto shadow-lg md:shadow-none"
                style={
                  downloading
                    ? { background: "rgba(255,183,3,0.5)", color: "#271900", cursor: "default" }
                    : {
                        background: "linear-gradient(135deg, #ffdba0 0%, #ffb703 100%)",
                        color: "#271900",
                        cursor: "pointer",
                      }
                }
              >
                {downloading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Downloading…</>
                ) : (
                  <><Download className="w-4 h-4" /> Download Patched .als</>
                )}
              </button>

              {/* Re-select link */}
              <button
                onClick={() => navigate(`/projects/${id}/plan`)}
                className="w-full mt-3 text-center text-[11px] text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors font-label uppercase tracking-wider"
              >
                Select Different Mutations
              </button>
            </div>
          </motion.div>

          {/* Validation summary */}
          <motion.div variants={ANIMATION_VARIANTS.slideUp}>
            <div
              className="rounded-xl p-5"
              style={{ background: "var(--bg-panel)", border: "1px solid rgba(81,69,50,0.1)" }}
            >
              <p className="text-[9px] font-label uppercase tracking-widest text-[var(--text-muted)] mb-3">
                Export Validation
              </p>
              <div className="space-y-2">
                {[
                  "Gzip compression verified — valid ALS container",
                  "XML well-formedness confirmed",
                  "No duplicate track or locator IDs detected",
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
        </>
      )}

      {/* Debug artifacts — always shown at bottom */}
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
                Analysis Artifacts
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
