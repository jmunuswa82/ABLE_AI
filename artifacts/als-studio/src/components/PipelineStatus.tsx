/**
 * PipelineStatus — unified lifecycle indicator component.
 * Reused across Overview, Strategy, and Deploy pages.
 * Reads from the same project + jobs data source so all pages
 * show consistent state.
 */
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, XCircle, Clock, Upload, Search, Brain, Cpu, Package } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProjectStatus =
  | "created"
  | "uploaded"
  | "parsing"
  | "analyzed"
  | "analyzing"
  | "generating"
  | "exporting"
  | "exported"
  | "failed"
  | string;

interface StageInfo {
  key: string;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  /** Which project statuses mean this stage is active / spinning */
  activeStatuses: ProjectStatus[];
  /** Which project statuses mean this stage is complete */
  doneStatuses: ProjectStatus[];
  /** Which project statuses mean this stage failed */
  failedStatuses: ProjectStatus[];
}

const STAGES: StageInfo[] = [
  {
    key: "upload",
    icon: <Upload className="w-3 h-3" />,
    label: "Upload",
    sublabel: "ALS ingested",
    activeStatuses: [],
    doneStatuses: ["uploaded", "parsing", "analyzing", "analyzed", "generating", "exporting", "exported", "failed"],
    failedStatuses: [],
  },
  {
    key: "parse",
    icon: <Search className="w-3 h-3" />,
    label: "Parse",
    sublabel: "XML extracted",
    activeStatuses: ["parsing"],
    doneStatuses: ["analyzing", "analyzed", "generating", "exporting", "exported"],
    failedStatuses: ["failed"],
  },
  {
    key: "analyze",
    icon: <Brain className="w-3 h-3" />,
    label: "Analyze",
    sublabel: "Structural analysis",
    activeStatuses: ["analyzing"],
    doneStatuses: ["generating", "exporting", "exported"],
    failedStatuses: ["failed"],
  },
  {
    key: "plan",
    icon: <Cpu className="w-3 h-3" />,
    label: "Strategy",
    sublabel: "AI plan generated",
    activeStatuses: ["generating"],
    doneStatuses: ["exporting", "exported"],
    failedStatuses: ["failed"],
  },
  {
    key: "export",
    icon: <Package className="w-3 h-3" />,
    label: "Export",
    sublabel: "Patched .als ready",
    activeStatuses: ["exporting"],
    doneStatuses: ["exported"],
    failedStatuses: ["failed"],
  },
];

interface PipelineStatusProps {
  status: ProjectStatus;
  jobs?: Array<{
    type: string;
    state: string;
    progress?: number | null;
    message?: string | null;
    error?: string | null;
  }>;
  compact?: boolean;
  className?: string;
}

type StageState = "idle" | "active" | "done" | "failed";

function getStageState(stage: StageInfo, projectStatus: ProjectStatus): StageState {
  if (stage.failedStatuses.includes(projectStatus)) return "failed";
  if (stage.doneStatuses.includes(projectStatus)) return "done";
  if (stage.activeStatuses.includes(projectStatus)) return "active";
  return "idle";
}

const STATE_COLORS: Record<StageState, string> = {
  idle: "text-[var(--text-muted)] border-[var(--amber-border)]",
  active: "text-[var(--amber)] border-[var(--amber)]",
  done: "text-[#22c55e] border-[#22c55e]",
  failed: "text-[#ef4444] border-[#ef4444]",
};

const STATE_BG: Record<StageState, string> = {
  idle: "bg-transparent",
  active: "bg-[rgba(255,183,3,0.07)]",
  done: "bg-[rgba(34,197,94,0.07)]",
  failed: "bg-[rgba(239,68,68,0.07)]",
};

export function PipelineStatus({ status, jobs = [], compact = false, className }: PipelineStatusProps) {
  const activeJob = jobs.find(
    (j) => j.state === "running" || j.state === "queued"
  );

  const latestError = jobs
    .filter((j) => j.error)
    .sort((a, b) => 0) // already ordered by createdAt desc from API
    .find(Boolean)?.error;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {STAGES.map((stage) => {
          const state = getStageState(stage, status);
          return (
            <div key={stage.key} className="flex items-center gap-1">
              <div
                className={cn(
                  "w-5 h-5 rounded-full border flex items-center justify-center",
                  STATE_COLORS[state],
                  STATE_BG[state]
                )}
              >
                {state === "active" ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                ) : state === "done" ? (
                  <CheckCircle2 className="w-2.5 h-2.5" />
                ) : state === "failed" ? (
                  <XCircle className="w-2.5 h-2.5" />
                ) : (
                  <Clock className="w-2.5 h-2.5 opacity-40" />
                )}
              </div>
              {stage !== STAGES[STAGES.length - 1] && (
                <div
                  className="w-4 h-px"
                  style={{
                    background:
                      state === "done"
                        ? "#22c55e"
                        : state === "failed"
                        ? "#ef4444"
                        : "var(--amber-border)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Stage row */}
      <div className="grid grid-cols-5 gap-1.5">
        {STAGES.map((stage) => {
          const state = getStageState(stage, status);
          return (
            <div
              key={stage.key}
              className={cn(
                "rounded-lg p-2.5 border text-center transition-all",
                STATE_COLORS[state],
                STATE_BG[state]
              )}
            >
              <div className="flex items-center justify-center mb-1.5">
                {state === "active" ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <Loader2 className="w-3.5 h-3.5" />
                  </motion.div>
                ) : state === "done" ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : state === "failed" ? (
                  <XCircle className="w-3.5 h-3.5" />
                ) : (
                  <span className="opacity-40">{stage.icon}</span>
                )}
              </div>
              <p className="text-[9px] font-label uppercase tracking-widest font-bold leading-none">
                {stage.label}
              </p>
              <p className="text-[8px] opacity-60 mt-0.5 leading-none hidden sm:block">
                {stage.sublabel}
              </p>
            </div>
          );
        })}
      </div>

      {/* Progress bar — visible when a job is running */}
      {activeJob && activeJob.progress != null && (
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-label uppercase tracking-widest text-[var(--amber)]">
              {activeJob.message ?? "Processing…"}
            </span>
            <span className="text-[9px] font-mono text-[var(--amber)]">
              {activeJob.progress}%
            </span>
          </div>
          <div className="h-0.5 bg-[var(--bg-overlay)] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "var(--amber)" }}
              initial={{ width: 0 }}
              animate={{ width: `${activeJob.progress}%` }}
              transition={{ ease: "linear", duration: 0.5 }}
            />
          </div>
        </div>
      )}

      {/* Active job message without percentage */}
      {activeJob && activeJob.progress == null && activeJob.message && (
        <p className="text-[10px] text-[var(--amber)] font-label uppercase tracking-widest">
          {activeJob.message}
        </p>
      )}

      {/* Error display */}
      {status === "failed" && latestError && (
        <div className="p-2.5 rounded bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)]">
          <p className="text-[10px] font-mono text-red-400 leading-relaxed">{latestError}</p>
        </div>
      )}
    </div>
  );
}
