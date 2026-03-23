/**
 * CompletionPlanView — "Neural Completion Strategy" page.
 *
 * Displays real data from backend analysis.
 * Users select which AI actions to apply and click "Apply Selected"
 * to kick off the compile job (POST /apply-mutations).
 *
 * Lifecycle cases:
 *   A: No project in DB       → not-found state
 *   B: Project has no file    → "Upload ALS first" CTA
 *   C: Analysis running       → live progress display
 *   D: Plan exists            → real action cards with selection UI
 *   E: Pipeline failed        → failure reason + retry CTA
 *   F: File uploaded, not analysed → "Run Pipeline" CTA
 */
import { useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin, AlertTriangle, Loader2, RefreshCw, UploadCloud,
  Brain, ChevronRight, Play, CheckSquare, Square, Zap,
  XCircle, ListChecks,
} from "lucide-react";
import {
  useGetCompletionPlan,
  getGetProjectQueryKey,
  getGetCompletionPlanQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectPolling } from "@/hooks/use-polling";
import { PipelineStatus } from "@/components/PipelineStatus";
import { formatScore, cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";
import { ANIMATION_VARIANTS } from "@/lib/design";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  critical: { color: "text-[#ef4444] border-red-500/30 bg-red-500/10", label: "Critical" },
  high:     { color: "text-primary border-primary/30 bg-primary/10", label: "High" },
  medium:   { color: "text-[#94a3b8] border-[#94a3b8]/30 bg-[#94a3b8]/10", label: "Medium" },
  low:      { color: "text-[#64748b] border-[#64748b]/30 bg-[#64748b]/10", label: "Low" },
};

const ANALYZING_STATUSES = new Set([
  "uploaded", "parsing", "analyzing", "generating", "exporting", "queued", "applying",
]);

export default function CompletionPlanView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string | null>(null);
  const [initiating, setInitiating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const { projectDetail: project, isLoading: projectLoading } = useProjectPolling(id);

  const shouldFetchPlan = project?.status === "exported" || project?.status === "analyzed"
    || project?.status === "generating" || project?.status === "exporting"
    || project?.status === "applying";
  const { data: plan, isLoading: planLoading } = useGetCompletionPlan(id, {
    query: {
      enabled: !!id && shouldFetchPlan,
      refetchOnMount: true,
    },
  });

  const isAnalyzing = ANALYZING_STATUSES.has(project?.status ?? "");
  const isFailed = project?.status === "failed";
  const hasFile = !!project?.originalFileName;

  const actions: any[] = plan?.actions ?? [];
  const safeActions = actions.filter((a: any) => !a.manualOnly);
  const selectedSafeCount = [...selectedIds].filter(
    (sid) => safeActions.find((a) => a.id === sid)
  ).length;

  // Toggle single action
  const toggleAction = useCallback((actionId: string, isSafe: boolean) => {
    if (!isSafe) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  }, []);

  // Select / deselect all safe actions
  const toggleAllSafe = useCallback(() => {
    if (selectedSafeCount === safeActions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(safeActions.map((a) => a.id)));
    }
  }, [safeActions, selectedSafeCount]);

  // Initiate Pipeline
  const initiatePipeline = async () => {
    if (!id || initiating) return;
    setInitiating(true);
    try {
      const res = await fetch(`${BASE}/api/projects/${id}/initiate-pipeline`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) }),
        queryClient.invalidateQueries({ queryKey: getGetCompletionPlanQueryKey(id) }),
      ]);
    } catch (err) {
      console.error("initiate-pipeline failed:", err);
    } finally {
      setInitiating(false);
    }
  };

  // Apply selected mutations
  const applySelected = async () => {
    if (!id || applying || selectedIds.size === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`${BASE}/api/projects/${id}/apply-mutations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedActionIds: [...selectedIds] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setApplyError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Navigate to export view to show compilation progress
      navigate(`/projects/${id}/export`);
    } catch (err: any) {
      setApplyError(err.message ?? "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (projectLoading) {
    return (
      <div className="p-4 md:p-8 flex items-center gap-3 text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="font-label text-[11px] uppercase tracking-widest">Loading project…</span>
      </div>
    );
  }

  // ── Case A: Project not found ─────────────────────────────────────────────
  if (!project) {
    return (
      <div className="p-4 md:p-8 max-w-xl mx-auto mt-12 text-center">
        <div
          className="rounded-xl p-6 md:p-8"
          style={{ background: "var(--bg-panel)", border: "1px solid rgba(81,69,50,0.1)" }}
        >
          <AlertTriangle className="w-8 h-8 mx-auto mb-4 text-[var(--amber)]" />
          <h2 className="text-[18px] font-display font-bold text-[var(--text-primary)] mb-2">
            Project Not Found
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)]">
            This project doesn't exist or was deleted.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-6 btn-ghost px-5 py-2.5 rounded-lg text-[12px] font-label uppercase tracking-wider"
          >
            Back to Hub
          </button>
        </div>
      </div>
    );
  }

  // ── Case B: No file ───────────────────────────────────────────────────────
  if (!hasFile) {
    return (
      <EmptyState
        icon={<UploadCloud className="w-8 h-8 mx-auto mb-4 text-[var(--amber)]" />}
        title="No ALS File Uploaded"
        body="Upload an Ableton Live Set from the Hub to begin structural analysis and strategy generation."
        action={
          <button
            onClick={() => navigate("/")}
            className="btn-primary px-5 py-2.5 rounded-lg text-[12px] font-label uppercase tracking-wider flex items-center gap-2"
          >
            <UploadCloud className="w-3.5 h-3.5" /> Go to Upload Hub
          </button>
        }
      />
    );
  }

  // ── Case C: Analysis in progress ─────────────────────────────────────────
  if (isAnalyzing && !plan) {
    return (
      <motion.div
        className="p-4 md:p-8 max-w-3xl mx-auto space-y-6"
        variants={ANIMATION_VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
      >
        <div>
          <p className="text-[10px] font-label uppercase tracking-[1.5px] text-[var(--text-muted)] mb-3">
            Neural Completion Strategy
          </p>
          <h1 className="text-[22px] md:text-[28px] font-display font-bold tracking-[-1.2px] text-[var(--text-primary)] mb-2">
            Analysis in Progress
          </h1>
          <p className="text-[var(--text-secondary)] text-[14px]">
            The AI engine is parsing{" "}
            <span className="text-[var(--amber)] font-mono">{project.originalFileName}</span> and
            building your completion strategy.
          </p>
        </div>
        <div
          className="rounded-xl p-6"
          style={{ background: "var(--bg-panel)", border: "1px solid rgba(255,183,3,0.15)" }}
        >
          <PipelineStatus status={project.status} jobs={project.jobs ?? []} />
        </div>
        <p className="text-[10px] text-[var(--text-muted)] font-label uppercase tracking-widest text-center">
          This page will update automatically when analysis completes
        </p>
      </motion.div>
    );
  }

  // ── Case E: Pipeline failed ───────────────────────────────────────────────
  if (isFailed) {
    const latestError = (project.jobs ?? []).find((j: any) => j.error)?.error;
    return (
      <motion.div
        className="p-4 md:p-8 max-w-3xl mx-auto space-y-6"
        variants={ANIMATION_VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
      >
        <div>
          <p className="text-[10px] font-label uppercase tracking-[1.5px] text-[var(--text-muted)] mb-3">
            Neural Completion Strategy
          </p>
          <h1 className="text-[22px] md:text-[28px] font-display font-bold tracking-[-1.2px] text-[var(--text-primary)] mb-2">
            Pipeline Failed
          </h1>
        </div>
        <div
          className="rounded-xl p-6 space-y-4"
          style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <PipelineStatus status={project.status} jobs={project.jobs ?? []} />
          {latestError && (
            <div className="p-3 rounded bg-[rgba(239,68,68,0.08)]">
              <p className="text-[11px] font-mono text-red-400 leading-relaxed">{latestError}</p>
            </div>
          )}
        </div>
        <button
          onClick={initiatePipeline}
          disabled={initiating}
          className="btn-primary px-6 py-3 rounded-lg flex items-center gap-2 text-[13px] font-label uppercase tracking-wider"
        >
          {initiating ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> Retry Pipeline</>
          )}
        </button>
      </motion.div>
    );
  }

  // ── Case F: File uploaded but pipeline not started ────────────────────────
  if (!plan && !isAnalyzing && !planLoading && project.status === "uploaded") {
    return (
      <EmptyState
        icon={<Brain className="w-8 h-8 mx-auto mb-4 text-[var(--amber)]" />}
        title="Ready for Analysis"
        body={`${project.originalFileName} has been uploaded. Start the analysis pipeline to generate your AI completion strategy.`}
        action={
          <button
            onClick={initiatePipeline}
            disabled={initiating}
            className="btn-primary px-5 py-2.5 rounded-lg text-[12px] font-label uppercase tracking-wider flex items-center gap-2"
          >
            {initiating ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting…</>
            ) : (
              <><Play className="w-3.5 h-3.5" /> Initiate Analysis Pipeline</>
            )}
          </button>
        }
      />
    );
  }

  // ── Loading plan ──────────────────────────────────────────────────────────
  if (planLoading) {
    return (
      <div className="p-4 md:p-8 flex items-center gap-3 text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="font-label text-[11px] uppercase tracking-widest">Loading strategy…</span>
      </div>
    );
  }

  // ── No plan ───────────────────────────────────────────────────────────────
  if (!plan) {
    return (
      <EmptyState
        icon={<Brain className="w-8 h-8 mx-auto mb-4 text-[var(--text-muted)]" />}
        title="No Strategy Available"
        body="The analysis completed but no completion strategy was generated. Try re-running the pipeline."
        action={
          <button
            onClick={initiatePipeline}
            disabled={initiating}
            className="btn-ghost px-5 py-2.5 rounded-lg text-[12px] font-label uppercase tracking-wider flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-run Pipeline
          </button>
        }
      />
    );
  }

  // ── Case D: Plan exists ───────────────────────────────────────────────────
  const categories = [...new Set(actions.map((a: any) => a.category))] as string[];
  const filteredActions = filter ? actions.filter((a: any) => a.category === filter) : actions;

  return (
    <motion.div
      className="p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6 md:space-y-8 mb-12 pb-20 md:pb-12"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Header panel */}
      <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel p-4 md:p-8 rounded-2xl md:rounded-3xl relative overflow-hidden bg-[var(--bg-panel)]">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-primary/20 blur-[80px] rounded-full pointer-events-none" />

        <p className="text-[10px] font-label uppercase tracking-[1.5px] text-[var(--text-muted)] mb-3">
          Neural Completion Strategy
        </p>
        <h1 className="text-[24px] md:text-[32px] font-display font-bold mb-3 tracking-[-1px] text-white">
          {project.name}
        </h1>
        <p className="text-[var(--text-secondary)] text-[14px] max-w-2xl leading-relaxed">
          {plan.summary}
        </p>

        <div className="flex flex-wrap gap-3 md:gap-4 mt-6 md:mt-8">
          {plan.completionScore != null && (
            <div className="px-5 py-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--amber-border)]">
              <span className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] block mb-1">
                Completion Score
              </span>
              <span className="text-2xl font-display font-bold text-[#22c55e]">
                {formatScore(plan.completionScore)}
              </span>
            </div>
          )}
          {plan.confidence != null && (
            <div className="px-5 py-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--amber-border)]">
              <span className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] block mb-1">
                AI Confidence
              </span>
              <span className="text-2xl font-display font-bold text-primary">
                {formatScore(plan.confidence)}
              </span>
            </div>
          )}
          <div className="px-5 py-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--amber-border)]">
            <span className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] block mb-1">
              Actions Generated
            </span>
            <span className="text-2xl font-display font-bold text-white">
              {actions.length}
            </span>
          </div>
          <div className="px-5 py-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--amber-border)]">
            <span className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] block mb-1">
              Auto-Exportable
            </span>
            <span className="text-2xl font-display font-bold text-primary">
              {safeActions.length}
            </span>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-[var(--amber-border)]">
          <PipelineStatus status={project.status} jobs={project.jobs ?? []} compact />
        </div>
      </motion.div>

      {safeActions.length > 0 && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp}>
          <div
            className="rounded-xl p-4 hidden md:flex items-center justify-between gap-4 flex-wrap"
            style={{
              background: "var(--bg-panel)",
              border: selectedIds.size > 0
                ? "1px solid rgba(255,183,3,0.3)"
                : "1px solid rgba(81,69,50,0.15)",
            }}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={toggleAllSafe}
                className="flex items-center gap-2 text-[11px] font-label uppercase tracking-widest transition-colors min-h-[44px]"
                style={{ color: selectedSafeCount === safeActions.length ? "var(--amber)" : "var(--text-muted)" }}
              >
                {selectedSafeCount === safeActions.length ? (
                  <CheckSquare className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {selectedSafeCount === safeActions.length ? "Deselect All" : "Select All Exportable"}
              </button>
              {selectedIds.size > 0 && (
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{
                    background: "rgba(255,183,3,0.12)",
                    color: "var(--amber)",
                    border: "1px solid rgba(255,183,3,0.2)",
                  }}
                >
                  {selectedIds.size} selected
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {applyError && (
                <span className="text-[11px] text-red-400 flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> {applyError}
                </span>
              )}
              <button
                onClick={applySelected}
                disabled={selectedIds.size === 0 || applying}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-display font-bold text-[12px] uppercase tracking-wider transition-all min-h-[44px]"
                style={
                  selectedIds.size > 0 && !applying
                    ? {
                        background: "linear-gradient(135deg, #ffdba0 0%, #ffb703 100%)",
                        color: "#271900",
                        cursor: "pointer",
                      }
                    : {
                        background: "var(--bg-overlay)",
                        color: "var(--text-muted)",
                        cursor: "not-allowed",
                      }
                }
              >
                {applying ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…</>
                ) : (
                  <><Zap className="w-3.5 h-3.5" /> Apply Selected ({selectedIds.size})</>
                )}
              </button>
            </div>
          </div>

          <div className="flex md:hidden flex-col gap-3 rounded-xl p-3" style={{
            background: "var(--bg-panel)",
            border: selectedIds.size > 0 ? "1px solid rgba(255,183,3,0.3)" : "1px solid rgba(81,69,50,0.15)",
          }}>
            <div className="flex items-center justify-between">
              <button
                onClick={toggleAllSafe}
                className="flex items-center gap-2 text-[11px] font-label uppercase tracking-widest transition-colors min-h-[44px]"
                style={{ color: selectedSafeCount === safeActions.length ? "var(--amber)" : "var(--text-muted)" }}
              >
                {selectedSafeCount === safeActions.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                {selectedSafeCount === safeActions.length ? "Deselect All" : "Select All"}
              </button>
              {selectedIds.size > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(255,183,3,0.12)", color: "var(--amber)", border: "1px solid rgba(255,183,3,0.2)" }}>
                  {selectedIds.size} selected
                </span>
              )}
            </div>
            {applyError && (
              <span className="text-[11px] text-red-400 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> {applyError}
              </span>
            )}
          </div>
        </motion.div>
      )}

      {safeActions.length > 0 && selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-[var(--bg-card)] border-t border-[var(--amber-border-strong)] md:hidden">
          <button
            onClick={applySelected}
            disabled={selectedIds.size === 0 || applying}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-display font-bold text-[13px] uppercase tracking-wider min-h-[48px]"
            style={{
              background: "linear-gradient(135deg, #ffdba0 0%, #ffb703 100%)",
              color: "#271900",
            }}
          >
            {applying ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Applying…</>
            ) : (
              <><Zap className="w-4 h-4" /> Apply Selected ({selectedIds.size})</>
            )}
          </button>
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
          <button
            onClick={() => setFilter(null)}
            className={cn(
              "px-4 py-2 rounded-full text-[10px] font-label uppercase tracking-widest transition-all font-semibold whitespace-nowrap shrink-0 min-h-[36px]",
              !filter ? "bg-white text-black" : "bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-white"
            )}
          >
            All Actions
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                "px-4 py-2 rounded-full text-[10px] font-label uppercase tracking-widest transition-all font-semibold whitespace-nowrap shrink-0 min-h-[36px]",
                filter === c
                  ? "bg-primary text-[#271900] shadow-[0_0_15px_rgba(255,183,3,0.4)]"
                  : "bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-white"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Action cards */}
      <motion.div layout className="grid gap-4">
        <AnimatePresence>
          {filteredActions.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm py-8 text-center">
              No actions in this category.
            </p>
          ) : (
            filteredActions.map((action: any) => (
              <ActionCard
                key={action.id}
                action={action}
                projectId={id}
                selected={selectedIds.has(action.id)}
                onToggle={toggleAction}
              />
            ))
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ icon, title, body, action }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto mt-8 md:mt-12 text-center">
      <div
        className="rounded-xl p-6 md:p-10"
        style={{ background: "var(--bg-panel)", border: "1px solid rgba(81,69,50,0.1)" }}
      >
        {icon}
        <h2 className="text-[18px] font-display font-bold text-[var(--text-primary)] mb-3">{title}</h2>
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-6">{body}</p>
        {action && <div className="flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

// ─── Action Card ──────────────────────────────────────────────────────────────

function ActionCard({
  action,
  projectId,
  selected,
  onToggle,
}: {
  action: any;
  projectId: string;
  selected: boolean;
  onToggle: (id: string, safe: boolean) => void;
}) {
  const { setLocateAtBeat } = useStudioStore();
  const [, navigate] = useLocation();
  const prio = PRIORITY_CONFIG[action.priority] || PRIORITY_CONFIG.medium;
  const locatable = action.mutationPayloads?.[0]?.startBeat ?? action.startBeat;
  const isSafe = !action.manualOnly;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className={cn(
        "glass-panel rounded-xl p-4 md:p-6 border-l-[3px] transition-all",
        selected && isSafe
          ? "border-l-primary shadow-[0_0_0_1px_rgba(255,183,3,0.25)]"
          : action.priority === "critical" || action.priority === "high"
          ? "border-l-primary"
          : "border-l-[var(--amber-border-strong)]"
      )}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Checkbox */}
          <button
            onClick={() => onToggle(action.id, isSafe)}
            className={cn(
              "shrink-0 mt-1 w-5 h-5 rounded flex items-center justify-center transition-all",
              isSafe
                ? selected
                  ? "bg-primary border-primary text-[#271900]"
                  : "border border-[var(--amber-border)] hover:border-primary"
                : "border border-[rgba(81,69,50,0.2)] cursor-not-allowed opacity-40"
            )}
            disabled={!isSafe}
            title={isSafe ? (selected ? "Deselect action" : "Select action") : "Manual-only — cannot auto-export"}
          >
            {selected && isSafe && <CheckSquare className="w-3.5 h-3.5" />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold font-label uppercase tracking-widest border", prio.color)}>
                {action.priority}
              </span>
              <span className="text-[10px] font-mono text-[var(--text-code)] uppercase bg-[var(--bg-overlay)] px-2 py-0.5 rounded-sm">
                {action.category}
              </span>
              {isSafe ? (
                <span
                  className="text-[9px] font-label uppercase tracking-widest px-2 py-0.5 rounded font-bold"
                  style={{
                    color: "#22c55e",
                    background: "rgba(34,197,94,0.08)",
                    border: "1px solid rgba(34,197,94,0.2)",
                  }}
                >
                  Auto-Export
                </span>
              ) : (
                <span
                  className="text-[9px] font-label uppercase tracking-widest px-2 py-0.5 rounded font-bold"
                  style={{
                    color: "#94a3b8",
                    background: "rgba(148,163,184,0.08)",
                    border: "1px solid rgba(148,163,184,0.2)",
                  }}
                >
                  Manual Only
                </span>
              )}
            </div>
            <h3 className="text-base md:text-xl font-display font-bold text-white mb-2">{action.title}</h3>
            <p className="text-sm text-[var(--text-secondary)] leading-[24px] max-w-3xl">{action.description}</p>
          </div>
        </div>

        {locatable != null && (
          <button
            onClick={() => {
              setLocateAtBeat(locatable, action.id);
              navigate(`/projects/${projectId}/timeline`);
            }}
            className="shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-[#271900] transition-all group shadow-[0_0_15px_rgba(255,183,3,0.1)] hover:shadow-[0_0_20px_rgba(255,183,3,0.4)]"
          >
            <MapPin className="w-4 h-4 mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-[8px] font-bold font-label uppercase tracking-widest">Locate</span>
          </button>
        )}
      </div>

      {(action.affectedBars || action.affectedTracks?.length > 0) && (
        <div className="mt-6 pt-4 border-t border-[var(--amber-border)] grid grid-cols-2 md:grid-cols-4 gap-4">
          {action.affectedBars && (
            <div>
              <div className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-widest mb-1.5">Target Area</div>
              <div className="text-[12px] font-mono text-[var(--amber-light)]">{action.affectedBars}</div>
            </div>
          )}
          {action.affectedTracks?.length > 0 && (
            <div className="col-span-2">
              <div className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-widest mb-1.5">Affected Tracks</div>
              <div className="flex flex-wrap gap-1.5">
                {action.affectedTracks.map((t: string) => (
                  <span key={t} className="px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--amber-border)] rounded text-[10px] font-mono text-[var(--text-code)]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
