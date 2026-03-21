import { useParams, useLocation } from "wouter";
import { useProjectPolling } from "@/hooks/use-polling";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { getStatusColor, getStatusLabel, formatScore, formatBars, isJobRunning, getRoleColor } from "@/lib/utils";

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
      <div className="p-6 text-center text-muted-foreground">
        Project not found
      </div>
    );
  }

  const latestJob = project.jobs?.[0];
  const running = latestJob ? isJobRunning(latestJob.state) : false;
  const statusColor = getStatusColor(project.status);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{project.name}</h1>
          {project.originalFileName && (
            <p className="text-xs font-mono text-muted-foreground mt-1">{project.originalFileName}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {running && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
          <span className={`text-sm font-medium ${statusColor}`}>
            {getStatusLabel(project.status)}
          </span>
        </div>
      </div>

      {/* Status bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Completion Score" value={formatScore(project.completionScore)} />
        <StatCard label="Status" value={getStatusLabel(project.status)} valueClass={statusColor} />
        <StatCard label="Tracks" value={graph ? String(graph.tracks?.length ?? 0) : "—"} />
        <StatCard label="Tempo" value={graph ? `${graph.tempo} BPM` : "—"} />
      </div>

      {/* Style tags */}
      {project.styleTags?.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h2 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Detected Style</h2>
          <div className="flex flex-wrap gap-2">
            {project.styleTags.map((tag: string) => (
              <span
                key={tag}
                className="px-3 py-1 bg-primary/15 text-primary border border-primary/20 rounded-full text-xs font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Graph summary */}
      {graph && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h2 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Project Structure</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Arrangement</p>
              <p className="font-mono text-foreground">{formatBars(graph.arrangementLength ?? 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Time Sig</p>
              <p className="font-mono text-foreground">
                {graph.timeSignatureNumerator ?? 4}/{graph.timeSignatureDenominator ?? 4}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Total Clips</p>
              <p className="font-mono text-foreground">{graph.totalClips ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Parse Quality</p>
              <p className="font-mono text-foreground">{formatScore(graph.parseQuality)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {project.status === "exported" && (
        <div className="flex gap-3">
          <button
            onClick={() => navigate(`/projects/${id}/timeline`)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90"
          >
            View Timeline
          </button>
          <button
            onClick={() => navigate(`/projects/${id}/plan`)}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm hover:opacity-90"
          >
            Completion Plan
          </button>
          <button
            onClick={() => navigate(`/projects/${id}/export`)}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm hover:opacity-90"
          >
            Download Artifacts
          </button>
        </div>
      )}

      {/* Track list */}
      {graph?.tracks && graph.tracks.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs text-muted-foreground uppercase tracking-wider">
              Tracks ({graph.tracks.length})
            </h2>
          </div>
          <div className="divide-y divide-border">
            {graph.tracks.map((track: any) => (
              <TrackRow key={track.id} track={track} />
            ))}
          </div>
        </div>
      )}

      {/* Job history */}
      {project.jobs?.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs text-muted-foreground uppercase tracking-wider">Job History</h2>
          </div>
          <div className="divide-y divide-border">
            {project.jobs.map((job: any) => (
              <div key={job.id} className="px-4 py-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground font-mono text-xs">{job.type}</span>
                  {job.message && (
                    <span className="text-muted-foreground text-xs">{job.message}</span>
                  )}
                  {job.error && (
                    <span className="text-red-400 text-xs truncate max-w-xs">{job.error}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {job.progress != null && isJobRunning(job.state) && (
                    <div className="w-20 h-1 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                  )}
                  <span className={`text-xs font-mono ${getStatusColor(job.state)}`}>
                    {getStatusLabel(job.state)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {project.warnings?.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Parser Warnings ({project.warnings.length})
          </h2>
          <div className="space-y-1">
            {project.warnings.slice(0, 10).map((w: string, i: number) => (
              <p key={i} className="text-xs text-yellow-500/80 font-mono">
                ⚠ {w}
              </p>
            ))}
            {project.warnings.length > 10 && (
              <p className="text-xs text-muted-foreground">
                +{project.warnings.length - 10} more warnings
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TrackRow({ track }: { track: any }) {
  const roleColor = getRoleColor(track.inferredRole);
  return (
    <div className="px-4 py-2.5 flex items-center gap-4 text-sm hover:bg-muted/20">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: roleColor }}
      />
      <span className="text-foreground w-40 truncate">{track.name}</span>
      <span className="text-muted-foreground text-xs w-24 shrink-0">
        {track.inferredRole} <span className="opacity-50">({Math.round(track.inferredConfidence * 100)}%)</span>
      </span>
      <span className="text-muted-foreground text-xs font-mono">{track.type}</span>
      <div className="flex gap-3 ml-auto text-xs text-muted-foreground font-mono">
        <span>{track.clipCount} clips</span>
        <span>{track.deviceCount} fx</span>
        {track.muted && <span className="text-yellow-500">MUTED</span>}
      </div>
    </div>
  );
}

function StatCard({ label, value, valueClass = "text-foreground" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm font-medium font-mono ${valueClass}`}>{value}</p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-16 bg-card border border-card-border rounded-lg animate-pulse" />
      ))}
    </div>
  );
}
