import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Layers, Zap, Target, Crosshair, MapPin } from "lucide-react";
import { useGetCompletionPlan, useGetProjectGraph } from "@workspace/api-client-react";
import { formatScore, cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";
import { ANIMATION_VARIANTS } from "@/lib/design";

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  critical: { color: "text-red-500 border-red-500/30 bg-red-500/10", label: "Critical" },
  high:     { color: "text-amber-500 border-amber-500/30 bg-amber-500/10", label: "High" },
  medium:   { color: "text-primary border-primary/30 bg-primary/10", label: "Medium" },
  low:      { color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10", label: "Low" },
};

export default function CompletionPlanView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: plan, isLoading } = useGetCompletionPlan(id);
  const { data: graph } = useGetProjectGraph(id);

  const [filter, setFilter] = useState<string | null>(null);

  if (isLoading) return <div className="p-8 font-mono text-muted-foreground uppercase">Formulating Plan...</div>;
  if (!plan) return <div className="p-8">No plan available.</div>;

  const actions = plan.actions ?? [];
  const categories = [...new Set(actions.map((a: any) => a.category))];
  const filteredActions = filter ? actions.filter((a: any) => a.category === filter) : actions;

  return (
    <motion.div 
      className="p-8 max-w-5xl mx-auto w-full space-y-8"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      <div className="glass-panel p-8 rounded-3xl relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-primary/20 blur-[80px] rounded-full" />
        <h1 className="text-3xl font-display font-bold mb-2">Completion Strategy</h1>
        <p className="text-muted-foreground max-w-2xl">{plan.summary}</p>
        
        <div className="flex gap-4 mt-8">
          <div className="px-4 py-2 bg-background/50 rounded-lg border border-border/50">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">Target Score</span>
            <span className="text-xl font-display font-bold text-emerald-400">{formatScore(plan.completionScore)}</span>
          </div>
          <div className="px-4 py-2 bg-background/50 rounded-lg border border-border/50">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">AI Confidence</span>
            <span className="text-xl font-display font-bold text-primary">{formatScore(plan.confidence)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter(null)} className={cn("px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all", !filter ? "bg-white text-black" : "bg-muted text-muted-foreground hover:bg-muted/80")}>All Actions</button>
        {categories.map((c: string) => (
          <button key={c} onClick={() => setFilter(c)} className={cn("px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all", filter===c ? "bg-primary text-white shadow-[0_0_15px_rgba(139,92,246,0.4)]" : "bg-muted/50 text-muted-foreground hover:bg-muted")}>{c}</button>
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
      className={cn("glass-panel rounded-2xl p-6 border-l-4 transition-all hover:translate-x-1", prio.color.split(' ')[1].replace('border-', 'border-l-'))}
    >
      <div className="flex justify-between items-start gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border", prio.color)}>{action.priority}</span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase">{action.category}</span>
          </div>
          <h3 className="text-lg font-display font-bold text-foreground mb-2">{action.title}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{action.description}</p>
        </div>
        
        {locatable != null && (
          <button 
            onClick={() => { setLocateAtBeat(locatable, action.id); navigate(`/projects/${projectId}/timeline`); }}
            className="shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-white transition-all group"
          >
            <MapPin className="w-5 h-5 mb-1 group-hover:scale-110 transition-transform" />
            <span className="text-[8px] font-bold uppercase tracking-widest">Locate</span>
          </button>
        )}
      </div>
      
      <div className="mt-6 pt-4 border-t border-border/50 grid grid-cols-2 md:grid-cols-4 gap-4">
        {action.affectedBars && (
          <div>
            <div className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Target Area</div>
            <div className="text-sm font-semibold">{action.affectedBars}</div>
          </div>
        )}
        {action.affectedTracks?.length > 0 && (
          <div className="col-span-2">
            <div className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Affected Tracks</div>
            <div className="flex flex-wrap gap-1">
              {action.affectedTracks.map((t: string) => <span key={t} className="px-2 py-1 bg-muted rounded text-[10px] font-mono">{t}</span>)}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
