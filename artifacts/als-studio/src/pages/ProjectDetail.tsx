import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Activity, Clock, Layers, Waves, AlertTriangle, ArrowRight } from "lucide-react";
import { useProjectPolling } from "@/hooks/use-polling";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { getStatusColor, getStatusLabel, formatScore, formatBars, isJobRunning, getRoleColor, cn } from "@/lib/utils";
import { ANIMATION_VARIANTS } from "@/lib/design";

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();

  const { projectDetail: project, isLoading } = useProjectPolling(id);
  const { data: graph } = useGetProjectGraph(id);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (!project) {
    return (
      <div className="p-8 text-center text-muted-foreground h-full flex items-center justify-center">
        <div className="glass-panel p-8 rounded-2xl">Project anomaly: Not found in databanks.</div>
      </div>
    );
  }

  const latestJob = project.jobs?.[0];
  const running = latestJob ? isJobRunning(latestJob.state) : false;
  const statusColor = getStatusColor(project.status);

  return (
    <motion.div 
      className="p-8 max-w-6xl mx-auto space-y-8 w-full"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Hero Header */}
      <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-3xl p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-display font-bold text-foreground">{project.name}</h1>
              <div className={cn("px-2.5 py-1 rounded-full border text-[10px] font-mono uppercase tracking-widest font-semibold flex items-center gap-2 bg-background/50 backdrop-blur", statusColor.replace('text-', 'border-').replace('400', '500/30'), statusColor)}>
                {running && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                {getStatusLabel(project.status)}
              </div>
            </div>
            {project.originalFileName && (
              <p className="text-sm font-mono text-muted-foreground flex items-center gap-2">
                <Layers className="w-4 h-4" /> {project.originalFileName}
              </p>
            )}
          </div>
          
          {project.status === "exported" && (
            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/projects/${id}/timeline`)}
                className="px-5 py-2.5 bg-card border border-primary/20 text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary hover:border-primary transition-all shadow-lg flex items-center gap-2"
              >
                <Waves className="w-4 h-4" /> Timeline
              </button>
              <button
                onClick={() => navigate(`/projects/${id}/plan`)}
                className="px-5 py-2.5 bg-gradient-to-r from-primary to-accent text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-primary/30 transition-all flex items-center gap-2"
              >
                Completion Plan <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Stats Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-border/50">
          <StatBox label="Completion Score" value={formatScore(project.completionScore)} valueClass={project.completionScore > 0.7 ? "text-emerald-400" : "text-primary"} />
          <StatBox label="Tempo" value={graph ? `${graph.tempo} BPM` : "—"} icon={<Activity className="w-3 h-3 text-muted-foreground" />} />
          <StatBox label="Arrangement" value={graph ? formatBars(Math.max(graph.arrangementLength ?? 0, 0)) : "—"} icon={<Clock className="w-3 h-3 text-muted-foreground" />} />
          <StatBox label="Tracks" value={graph ? String(graph.tracks?.length ?? 0) : "—"} icon={<Layers className="w-3 h-3 text-muted-foreground" />} />
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Tracks List */}
          {graph?.tracks && graph.tracks.length > 0 && (
            <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
                <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest font-semibold">
                  Track Analysis ({graph.tracks.length})
                </h2>
              </div>
              <div className="divide-y divide-border/50">
                {graph.tracks.map((track: any) => (
                  <TrackRow key={track.id} track={track} />
                ))}
              </div>
            </motion.div>
          )}
        </div>

        <div className="space-y-8">
          {/* Style Tags */}
          {project.styleTags?.length > 0 && (
            <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl p-6">
              <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest font-semibold mb-4">Detected Style</h2>
              <div className="flex flex-wrap gap-2">
                {project.styleTags.map((tag: string) => (
                  <span key={tag} className="px-3 py-1.5 bg-primary/10 text-primary-foreground border border-primary/20 rounded-lg text-xs font-medium shadow-[0_0_10px_rgba(139,92,246,0.1)]">
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {/* Job History */}
          {project.jobs?.length > 0 && (
            <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border/50 bg-muted/20">
                <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest font-semibold">Operation Log</h2>
              </div>
              <div className="divide-y divide-border/50">
                {project.jobs.map((job: any) => (
                  <div key={job.id} className="px-6 py-4 text-sm bg-background/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs text-foreground uppercase tracking-wider">{job.type}</span>
                      <span className={cn("text-[10px] font-mono font-bold uppercase", getStatusColor(job.state))}>
                        {getStatusLabel(job.state)}
                      </span>
                    </div>
                    {job.message && <p className="text-xs text-muted-foreground">{job.message}</p>}
                    {job.error && <p className="text-xs text-destructive mt-1 bg-destructive/10 p-2 rounded">{job.error}</p>}
                    {job.progress != null && isJobRunning(job.state) && (
                      <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${job.progress}%` }}
                          transition={{ ease: "linear", duration: 0.5 }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Warnings */}
          {project.warnings?.length > 0 && (
            <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl p-6 border-amber-500/20 bg-amber-500/5">
              <h2 className="text-xs font-mono text-amber-500/80 uppercase tracking-widest font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Parser Warnings
              </h2>
              <div className="space-y-2">
                {project.warnings.slice(0, 5).map((w: string, i: number) => (
                  <p key={i} className="text-[11px] text-amber-500/70 font-mono leading-relaxed">
                    {w}
                  </p>
                ))}
                {project.warnings.length > 5 && (
                  <p className="text-[10px] text-amber-500/50 uppercase font-bold mt-2">
                    +{project.warnings.length - 5} additional warnings hidden
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatBox({ label, value, valueClass = "text-foreground", icon }: any) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-mono uppercase tracking-widest">{label}</span>
      </div>
      <p className={cn("text-2xl font-display font-bold", valueClass)}>{value}</p>
    </div>
  );
}

function TrackRow({ track }: { track: any }) {
  const roleColor = getRoleColor(track.inferredRole);
  return (
    <div className="px-6 py-4 flex items-center gap-4 text-sm hover:bg-muted/30 transition-colors group">
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-lg"
        style={{ backgroundColor: roleColor, boxShadow: `0 0 10px ${roleColor}80` }}
      />
      <span className="text-foreground font-medium w-48 truncate group-hover:text-primary transition-colors">{track.name}</span>
      <div className="w-32 shrink-0">
        <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded bg-muted text-muted-foreground">
          {track.inferredRole}
        </span>
      </div>
      <span className="text-muted-foreground text-[11px] font-mono w-16 uppercase">{track.type}</span>
      <div className="flex gap-4 ml-auto text-[11px] text-muted-foreground font-mono">
        <span className="bg-background/50 px-2 py-1 rounded border border-border/50">{track.clipCount} clips</span>
        <span className="bg-background/50 px-2 py-1 rounded border border-border/50">{track.deviceCount} fx</span>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 w-full">
      <div className="h-48 glass-panel rounded-3xl animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 h-96 glass-panel rounded-2xl animate-pulse" />
        <div className="h-96 glass-panel rounded-2xl animate-pulse" />
      </div>
    </div>
  );
}
