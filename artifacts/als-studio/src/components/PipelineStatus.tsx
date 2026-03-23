import { motion } from "framer-motion";
import { CheckCircle2, Loader2, XCircle, Clock, Upload, Search, Brain, Cpu, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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
  activeStatuses: ProjectStatus[];
  doneStatuses: ProjectStatus[];
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

function StageIcon({ state }: { state: StageState }) {
  if (state === "active") return (
    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
      <Loader2 className="w-3.5 h-3.5" />
    </motion.div>
  );
  if (state === "done") return <CheckCircle2 className="w-3.5 h-3.5" />;
  if (state === "failed") return <XCircle className="w-3.5 h-3.5" />;
  return <Clock className="w-3 h-3 opacity-40" />;
}

export function PipelineStatus({ status, jobs = [], compact = false, className }: PipelineStatusProps) {
  const isMobile = useIsMobile();
  const activeJob = jobs.find((j) => j.state === "running" || j.state === "queued");
  const latestError = jobs.filter((j) => j.error).find(Boolean)?.error;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 flex-wrap", className)}>
        {STAGES.map((stage) => {
          const state = getStageState(stage, status);
          return (
            <div key={stage.key} className="flex items-center gap-1">
              <div className={cn("w-5 h-5 rounded-full border flex items-center justify-center", STATE_COLORS[state], STATE_BG[state])}>
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
                  className="w-3 md:w-4 h-px"
                  style={{
                    background: state === "done" ? "#22c55e" : state === "failed" ? "#ef4444" : "var(--amber-border)",
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
      {isMobile ? (
        <div className="space-y-2">
          {STAGES.map((stage, i) => {
            const state = getStageState(stage, status);
            return (
              <div key={stage.key} className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center shrink-0", STATE_COLORS[state], STATE_BG[state])}>
                  <StageIcon state={state} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-[10px] font-label uppercase tracking-widest font-bold", STATE_COLORS[state].split(" ")[0])}>
                    {stage.label}
                  </p>
                  <p className="text-[9px] text-[var(--text-muted)] mt-0.5">{stage.sublabel}</p>
                </div>
                {state === "done" && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#22c55e] shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
          {STAGES.map((stage) => {
            const state = getStageState(stage, status);
            return (
              <div
                key={stage.key}
                className={cn("rounded-lg p-2.5 border text-center transition-all", STATE_COLORS[state], STATE_BG[state])}
              >
                <div className="flex items-center justify-center mb-1.5">
                  <StageIcon state={state} />
                </div>
                <p className="text-[9px] font-label uppercase tracking-widest font-bold leading-none">{stage.label}</p>
                <p className="text-[8px] opacity-60 mt-0.5 leading-none">{stage.sublabel}</p>
              </div>
            );
          })}
        </div>
      )}

      {activeJob && activeJob.progress != null && (
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-label uppercase tracking-widest text-[var(--amber)]">
              {activeJob.message ?? "Processing…"}
            </span>
            <span className="text-[9px] font-mono text-[var(--amber)]">{activeJob.progress}%</span>
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

      {activeJob && activeJob.progress == null && activeJob.message && (
        <p className="text-[10px] text-[var(--amber)] font-label uppercase tracking-widest">
          {activeJob.message}
        </p>
      )}

      {status === "failed" && latestError && (
        <div className="p-2.5 rounded bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)]">
          <p className="text-[10px] font-mono text-red-400 leading-relaxed break-words">{latestError}</p>
        </div>
      )}
    </div>
  );
}
