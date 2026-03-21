import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin } from "lucide-react";
import { useGetCompletionPlan, useGetProjectGraph } from "@workspace/api-client-react";
import { formatScore, cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";
import { ANIMATION_VARIANTS } from "@/lib/design";

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  critical: { color: "text-[#ef4444] border-red-500/30 bg-red-500/10", label: "Critical" },
  high:     { color: "text-primary border-primary/30 bg-primary/10", label: "High" },
  medium:   { color: "text-[#94a3b8] border-[#94a3b8]/30 bg-[#94a3b8]/10", label: "Medium" },
  low:      { color: "text-[#64748b] border-[#64748b]/30 bg-[#64748b]/10", label: "Low" },
};

export default function CompletionPlanView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: plan, isLoading } = useGetCompletionPlan(id);
  const { data: graph } = useGetProjectGraph(id);

  const [filter, setFilter] = useState<string | null>(null);

  if (isLoading) return <div className="p-8 font-mono text-[var(--text-muted)] uppercase">Formulating Neural Strategy...</div>;
  if (!plan) return <div className="p-8 font-sans text-[var(--text-secondary)]">No strategy payload available.</div>;

  const actions = plan.actions ?? [];
  const categories = [...new Set(actions.map((a: any) => a.category))];
  const filteredActions = filter ? actions.filter((a: any) => a.category === filter) : actions;

  return (
    <motion.div 
      className="p-8 max-w-5xl mx-auto w-full space-y-8 mb-12"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      <div className="glass-panel p-8 rounded-3xl relative overflow-hidden bg-[var(--bg-panel)]">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-primary/20 blur-[80px] rounded-full pointer-events-none" />
        <h1 className="text-[32px] font-display font-bold mb-4 tracking-[-1px] text-white">Neural Completion Strategy</h1>
        <p className="text-[var(--text-secondary)] text-base max-w-2xl leading-relaxed">{plan.summary}</p>
        
        <div className="flex gap-4 mt-8">
          <div className="px-5 py-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--amber-border)]">
            <span className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] block mb-1">Target Score</span>
            <span className="text-2xl font-display font-bold text-[#22c55e]">{formatScore(plan.completionScore)}</span>
          </div>
          <div className="px-5 py-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--amber-border)]">
            <span className="text-[9px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] block mb-1">AI Confidence</span>
            <span className="text-2xl font-display font-bold text-primary">{formatScore(plan.confidence)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button 
          onClick={() => setFilter(null)} 
          className={cn("px-4 py-2 rounded-full text-[10px] font-label uppercase tracking-widest transition-all font-semibold", !filter ? "bg-white text-black" : "bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-white")}
        >
          All Actions
        </button>
        {categories.map((c: string) => (
          <button 
            key={c} 
            onClick={() => setFilter(c)} 
            className={cn("px-4 py-2 rounded-full text-[10px] font-label uppercase tracking-widest transition-all font-semibold", filter===c ? "bg-primary text-[#271900] shadow-[0_0_15px_rgba(255,183,3,0.4)]" : "bg-[var(--bg-overlay)] text-[var(--text-muted)] hover:text-white")}
          >
            {c}
          </button>
        ))}
      </div>

      <motion.div layout className="grid gap-4">
        <AnimatePresence>
          {filteredActions.map((action: any) => (
            <ActionCard key={action.id} action={action} projectId={id} />
          ))}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

function ActionCard({ action, projectId }: any) {
  const { setLocateAtBeat } = useStudioStore();
  const [, navigate] = useLocation();
  const prio = PRIORITY_CONFIG[action.priority] || PRIORITY_CONFIG.medium;
  const locatable = action.mutationPayloads?.[0]?.startBeat ?? action.startBeat;

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className={cn("glass-panel rounded-xl p-6 border-l-[3px] transition-all hover:translate-x-1", action.priority === 'critical' || action.priority === 'high' ? "border-l-primary" : "border-l-[var(--amber-border-strong)]")}
    >
      <div className="flex justify-between items-start gap-4">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold font-label uppercase tracking-widest border", prio.color)}>{action.priority}</span>
            <span className="text-[10px] font-mono text-[var(--text-code)] uppercase bg-[var(--bg-overlay)] px-2 py-0.5 rounded-sm">{action.category}</span>
          </div>
          <h3 className="text-xl font-display font-bold text-white mb-2">{action.title}</h3>
          <p className="text-sm text-[var(--text-secondary)] leading-[24px] max-w-3xl">{action.description}</p>
        </div>
        
        {locatable != null && (
          <button 
            onClick={() => { setLocateAtBeat(locatable, action.id); navigate(`/projects/${projectId}/timeline`); }}
            className="shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-[#271900] transition-all group shadow-[0_0_15px_rgba(255,183,3,0.1)] hover:shadow-[0_0_20px_rgba(255,183,3,0.4)]"
          >
            <MapPin className="w-5 h-5 mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-[8px] font-bold font-label uppercase tracking-widest">Locate</span>
          </button>
        )}
      </div>
      
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
              {action.affectedTracks.map((t: string) => <span key={t} className="px-2 py-1 bg-[var(--bg-elevated)] border border-[var(--amber-border)] rounded text-[10px] font-mono text-[var(--text-code)]">{t}</span>)}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
