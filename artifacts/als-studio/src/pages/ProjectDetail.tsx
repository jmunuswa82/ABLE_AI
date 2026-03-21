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
      <div className="p-8 text-center text-[var(--text-muted)] h-full flex items-center justify-center">
        <div className="glass-panel p-8 rounded-2xl">Project anomaly: Not found in databanks.</div>
      </div>
    );
  }

  const latestJob = project.jobs?.[0];
  const running = latestJob ? isJobRunning(latestJob.state) : false;
  const statusColor = getStatusColor(project.status);

  return (
    <motion.div 
      className="p-8 max-w-6xl mx-auto space-y-8 w-full mb-12"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      {/* Hero Header */}
      <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="text-[10px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] mb-2">Structural Overview</div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-[32px] font-display font-bold text-white tracking-[-1px]">{project.name}</h1>
              <div className={cn("px-2.5 py-1 rounded bg-[var(--bg-elevated)] border text-[9px] font-label uppercase tracking-widest font-semibold flex items-center gap-2", statusColor.replace('text-', 'border-').replace('400', '500/30'), statusColor)}>
                {running && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                {getStatusLabel(project.status)}
              </div>
            </div>
            {project.originalFileName && (
              <p className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-2">
                <Layers className="w-3.5 h-3.5" /> {project.originalFileName}
              </p>
            )}
          </div>
          
          {project.status === "exported" && (
            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/projects/${id}/timeline`)}
                className="btn-ghost px-6 py-3 rounded-md flex items-center gap-2"
              >
                <Waves className="w-4 h-4" /> Arrangement Matrix
              </button>
              <button
                onClick={() => navigate(`/projects/${id}/plan`)}
                className="btn-primary px-6 py-3 rounded-md flex items-center gap-2"
              >
                Neural Strategy <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Stats Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-[var(--amber-border)]">
          <StatBox label="Target Index" value={formatScore(project.completionScore)} valueClass={project.completionScore > 0.7 ? "text-emerald-400" : "text-primary"} />
          <StatBox label="Tempo Sync" value={graph ? `${graph.tempo} BPM` : "—"} icon={<Activity className="w-3 h-3 text-[var(--text-muted)]" />} />
          <StatBox label="Structure Array" value={graph ? formatBars(Math.max(graph.arrangementLength ?? 0, 0)) : "—"} icon={<Clock className="w-3 h-3 text-[var(--text-muted)]" />} />
          <StatBox label="Track Vectors" value={graph ? String(graph.tracks?.length ?? 0) : "—"} icon={<Layers className="w-3 h-3 text-[var(--text-muted)]" />} />
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Tracks List */}
          {graph?.tracks && graph.tracks.length > 0 && (
            <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--amber-border)] bg-[var(--bg-card)]">
                <h2 className="text-[10px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] font-semibold">
                  Track Topology ({graph.tracks.length})
                </h2>
              </div>
              <div className="divide-y divide-[var(--amber-border)]">
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
              <h2 className="text-[10px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] font-semibold mb-4">Aesthetic Model</h2>
              <div className="flex flex-wrap gap-2">
                {project.styleTags.map((tag: string) => (
                  <span key={tag} className="px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded text-[10px] font-mono shadow-[0_0_10px_rgba(255,183,3,0.1)]">
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {/* Job History */}
          {project.jobs?.length > 0 && (
            <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--amber-border)] bg-[var(--bg-card)]">
                <h2 className="text-[10px] font-label text-[var(--text-muted)] uppercase tracking-[1.8px] font-semibold">Operation Log</h2>
              </div>
              <div className="divide-y divide-[var(--amber-border)]">
                {project.jobs.map((job: any) => (
                  <div key={job.id} className="px-6 py-4 text-sm bg-[var(--bg-panel)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[11px] text-white uppercase tracking-wider">{job.type}</span>
                      <span className={cn("text-[9px] font-label font-bold uppercase", getStatusColor(job.state))}>
                        {getStatusLabel(job.state)}
                      </span>
                    </div>
                    {job.message && <p className="text-[12px] font-sans text-[var(--text-secondary)]">{job.message}</p>}
                    {job.error && <p className="text-[11px] text-red-400 mt-2 bg-red-400/10 p-2 rounded border border-red-400/20">{job.error}</p>}
                    {job.progress != null && isJobRunning(job.state) && (
                      <div className="mt-3 h-1 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-primary shadow-[0_0_8px_var(--amber)]"
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
            <motion.div variants={ANIMATION_VARIANTS.slideUp} className="glass-panel rounded-2xl p-6 border-red-500/20 bg-red-500/5">
              <h2 className="text-[10px] font-label text-red-400/80 uppercase tracking-[1.8px] font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" /> Integrity Warnings
              </h2>
              <div className="space-y-2">
                {project.warnings.slice(0, 5).map((w: string, i: number) => (
                  <p key={i} className="text-[11px] text-red-400/70 font-mono leading-relaxed">
                    {w}
                  </p>
                ))}
                {project.warnings.length > 5 && (
                  <p className="text-[9px] font-label text-red-400/50 uppercase font-bold mt-3">
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

function StatBox({ label, value, valueClass = "text-white", icon }: any) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 text-[var(--text-muted)]">
        {icon}
        <span className="text-[9px] font-label uppercase tracking-[1.8px]">{label}</span>
      </div>
      <p className={cn("text-[28px] font-display font-bold", valueClass)}>{value}</p>
    </div>
  );
}

function TrackRow({ track }: { track: any }) {
  const roleColor = getRoleColor(track.inferredRole);
  return (
    <div className="px-6 py-4 flex items-center gap-4 text-sm hover:bg-[var(--bg-elevated)] transition-colors group">
      <div
        className="w-2.5 h-2.5 rounded-sm shrink-0 shadow-lg"
        style={{ backgroundColor: roleColor, boxShadow: `0 0 10px ${roleColor}80` }}
      />
      <span className="text-white font-display font-medium w-48 truncate group-hover:text-primary transition-colors">{track.name}</span>
      <div className="w-32 shrink-0">
        <span className="text-[9px] font-label uppercase tracking-widest px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--amber-border)] text-[var(--text-secondary)]">
          {track.inferredRole}
        </span>
      </div>
      <span className="text-[var(--text-code)] text-[11px] font-mono w-16 uppercase">{track.type}</span>
      <div className="flex gap-4 ml-auto text-[11px] text-[var(--amber-light)] font-mono">
        <span className="bg-[var(--bg-overlay)] px-2 py-1 rounded border border-[var(--amber-border)]">{track.clipCount} clips</span>
        <span className="bg-[var(--bg-overlay)] px-2 py-1 rounded border border-[var(--amber-border)]">{track.deviceCount} fx</span>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 w-full">
      <div className="h-48 glass-panel animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 h-96 glass-panel animate-pulse" />
        <div className="h-96 glass-panel animate-pulse" />
      </div>
    </div>
  );
}
