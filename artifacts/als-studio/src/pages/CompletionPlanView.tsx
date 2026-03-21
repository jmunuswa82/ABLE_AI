import { useState } from "react";
import { useParams } from "wouter";
import { useGetCompletionPlan, useGetProjectGraph } from "@workspace/api-client-react";
import { formatScore, getRoleColor, getTrackColor, cn } from "@/lib/utils";

const PRIORITY_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  critical: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", dot: "#FF3636" },
  high: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", dot: "#FF8836" },
  medium: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", dot: "#FFCC36" },
  low: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400", dot: "#36CC36" },
};

const CATEGORY_ICONS: Record<string, string> = {
  structure: "⊞",
  drums: "◉",
  bass: "⊔",
  automation: "≋",
  transitions: "→",
  ending: "◁",
  texture: "∿",
  mixing: "⊕",
  arrangement: "⊞",
};

export default function CompletionPlanView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: plan, isLoading } = useGetCompletionPlan(id);
  const { data: graph } = useGetProjectGraph(id);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading completion plan...</div>;
  }

  if (!plan) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground text-sm">No completion plan available yet.</p>
        <p className="text-xs text-muted-foreground mt-2">Analysis must complete first.</p>
      </div>
    );
  }

  const actions = plan.actions ?? [];
  const categories = [...new Set(actions.map((a: any) => a.category))];
  const filtered = selectedCategory
    ? actions.filter((a: any) => a.category === selectedCategory)
    : actions;

  const criticalCount = actions.filter((a: any) => a.priority === "critical").length;
  const highCount = actions.filter((a: any) => a.priority === "high").length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Completion Plan</h1>
        <p className="text-sm text-muted-foreground mt-1">{plan.summary}</p>
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Completion Score"
          value={formatScore(plan.completionScore)}
          valueClass={plan.completionScore > 0.7 ? "text-green-400" : plan.completionScore > 0.4 ? "text-yellow-400" : "text-red-400"}
        />
        <MetricCard label="Confidence" value={formatScore(plan.confidence)} />
        <MetricCard label="Actions" value={String(actions.length)} />
        <MetricCard
          label="Critical / High"
          value={`${criticalCount} / ${highCount}`}
          valueClass="text-orange-400"
        />
      </div>

      {/* Timeline overview — graphical plan map */}
      {graph && actions.length > 0 && (
        <PlanTimeline graph={graph} actions={actions} expandedId={expandedId} onSelect={(id) => setExpandedId(expandedId === id ? null : id)} />
      )}

      {/* Priority distribution bar */}
      <PriorityBar actions={actions} />

      {/* Weaknesses */}
      {plan.weaknesses?.length > 0 && (
        <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-4">
          <h2 className="text-xs text-[#888] uppercase tracking-wider mb-3">
            Detected Weaknesses ({plan.weaknesses.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {plan.weaknesses.map((w: string, i: number) => (
              <div key={i} className="flex gap-2 text-xs bg-[#252525] rounded p-2">
                <span className="text-yellow-500 shrink-0">▲</span>
                <span className="text-[#bbb]">{w}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <FilterButton
          label="All"
          active={selectedCategory === null}
          onClick={() => setSelectedCategory(null)}
          count={actions.length}
        />
        {categories.map((cat: string) => (
          <FilterButton
            key={cat}
            label={`${CATEGORY_ICONS[cat] ?? "◆"} ${cat}`}
            active={selectedCategory === cat}
            onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
            count={actions.filter((a: any) => a.category === cat).length}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {filtered.map((action: any) => (
          <ActionCard
            key={action.id}
            action={action}
            graph={graph}
            expanded={expandedId === action.id}
            onToggle={() => setExpandedId(expandedId === action.id ? null : action.id)}
          />
        ))}
      </div>

      {/* Rationale */}
      <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-4">
        <h2 className="text-xs text-[#888] uppercase tracking-wider mb-2">Analysis Rationale</h2>
        <p className="text-xs text-[#999] leading-relaxed">{plan.rationale}</p>
      </div>
    </div>
  );
}

function PlanTimeline({ graph, actions, expandedId, onSelect }: {
  graph: any; actions: any[]; expandedId: string | null; onSelect: (id: string) => void;
}) {
  const allTracks = [...(graph.tracks ?? []), ...(graph.returnTracks ?? [])];
  const maxClipEnd = allTracks.reduce((max: number, t: any) =>
    (t.clips ?? []).reduce((m: number, c: any) => Math.max(m, c.end ?? 0), max), 0);
  const totalBeats = Math.max(graph.arrangementLength ?? 128, maxClipEnd, 64);

  const actionsWithBars = actions.filter((a: any) => a.affectedBars);
  const actionsWithTracks = actions.filter((a: any) => a.affectedTracks?.length > 0);

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-[#333] bg-[#1e1e1e] flex items-center justify-between">
        <h2 className="text-xs text-[#888] uppercase tracking-wider">Plan Timeline</h2>
        <span className="text-[10px] text-[#666] font-mono">{Math.ceil(totalBeats / 4)} bars · {allTracks.length} tracks</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Mini bar ruler */}
          <div className="h-5 relative bg-[#1e1e1e] border-b border-[#333]" style={{ paddingLeft: 120 }}>
            <div className="relative h-full">
              {Array.from({ length: Math.ceil(totalBeats / 4 / 16) + 1 }, (_, i) => i * 16).map((barNum) => (
                <div key={barNum} className="absolute top-0 bottom-0" style={{ left: `${(barNum * 4 / totalBeats) * 100}%` }}>
                  <span className="text-[8px] text-[#666] font-mono">{barNum + 1}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Section bar */}
          {graph.sections?.length > 0 && (
            <div className="h-5 relative border-b border-[#333]" style={{ paddingLeft: 120 }}>
              <div className="relative h-full">
                {graph.sections.map((section: any) => {
                  const left = (section.startBar / totalBeats) * 100;
                  const width = ((section.endBar - section.startBar) / totalBeats) * 100;
                  return (
                    <div
                      key={section.id}
                      className="absolute top-0 bottom-0 flex items-center px-1 border-l border-[#555]"
                      style={{ left: `${left}%`, width: `${width}%`, backgroundColor: "rgba(100,100,100,0.1)" }}
                    >
                      <span className="text-[8px] text-[#888] uppercase truncate">{section.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Track lanes with action highlights */}
          {allTracks.slice(0, 12).map((track: any) => {
            const trackColor = track.color != null ? getTrackColor(track.color) : getRoleColor(track.inferredRole);
            const trackActions = actionsWithTracks.filter((a: any) =>
              a.affectedTracks.some((t: string) => t === track.name || t === track.id)
            );

            return (
              <div key={track.id} className="flex items-center h-6 border-b border-[#222]">
                <div className="w-[120px] shrink-0 flex items-center gap-1.5 px-2 bg-[#1e1e1e] border-r border-[#333]">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
                  <span className="text-[9px] text-[#888] truncate">{track.name}</span>
                </div>
                <div className="relative flex-1 h-full bg-[#1a1a1a]">
                  {/* Existing clips (dimmed) */}
                  {track.clips?.map((clip: any) => {
                    const left = (clip.start / totalBeats) * 100;
                    const width = Math.max(((clip.end - clip.start) / totalBeats) * 100, 0.3);
                    return (
                      <div
                        key={clip.id}
                        className="absolute top-1 bottom-1 rounded-sm opacity-25"
                        style={{ left: `${left}%`, width: `${width}%`, backgroundColor: trackColor }}
                      />
                    );
                  })}

                  {/* Action highlights */}
                  {trackActions.map((action: any) => {
                    const prio = PRIORITY_COLORS[action.priority] ?? PRIORITY_COLORS.medium;
                    const barRange = parseBarRange(action.affectedBars, totalBeats);
                    const left = barRange ? (barRange[0] / totalBeats) * 100 : 0;
                    const width = barRange ? ((barRange[1] - barRange[0]) / totalBeats) * 100 : 100;

                    return (
                      <div
                        key={action.id}
                        className={cn(
                          "absolute top-0 bottom-0 border-t-2 cursor-pointer transition-opacity",
                          expandedId === action.id ? "opacity-100" : "opacity-60 hover:opacity-90",
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 1)}%`,
                          borderTopColor: prio.dot,
                          backgroundColor: `${prio.dot}15`,
                        }}
                        onClick={() => onSelect(action.id)}
                        title={action.title}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {allTracks.length > 12 && (
            <div className="h-4 flex items-center justify-center text-[9px] text-[#555]">
              +{allTracks.length - 12} more tracks
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="px-3 py-2 border-t border-[#333] flex items-center gap-4 bg-[#1e1e1e]">
        <span className="text-[9px] text-[#666]">Priority:</span>
        {Object.entries(PRIORITY_COLORS).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: val.dot }} />
            <span className="text-[9px] text-[#888] capitalize">{key}</span>
          </div>
        ))}
        <span className="text-[9px] text-[#555] ml-auto">Click highlights to expand action</span>
      </div>
    </div>
  );
}

function PriorityBar({ actions }: { actions: any[] }) {
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  actions.forEach((a: any) => { counts[a.priority] = (counts[a.priority] || 0) + 1; });
  const total = actions.length || 1;

  return (
    <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-[#888] uppercase tracking-wider">Priority Distribution</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-[#252525]">
        {Object.entries(counts).filter(([, c]) => c > 0).map(([key, count]) => (
          <div
            key={key}
            className="h-full transition-all"
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: PRIORITY_COLORS[key]?.dot ?? "#666",
            }}
            title={`${key}: ${count}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 mt-2">
        {Object.entries(counts).filter(([, c]) => c > 0).map(([key, count]) => (
          <span key={key} className="text-[10px] text-[#888]">
            <span className="font-mono text-[#ccc]">{count}</span> {key}
          </span>
        ))}
      </div>
    </div>
  );
}

function parseBarRange(barStr: string | null | undefined, totalBeats: number): [number, number] | null {
  if (!barStr) return null;
  const match = barStr.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (match) {
    const startBeat = Math.max(0, (parseInt(match[1]) - 1) * 4);
    const endBeat = Math.min(totalBeats, parseInt(match[2]) * 4);
    return [startBeat, endBeat];
  }
  const single = barStr.match(/bar\s*(\d+)/i);
  if (single) {
    const startBeat = (parseInt(single[1]) - 1) * 4;
    return [startBeat, startBeat + 4];
  }
  return null;
}

function ActionCard({ action, graph, expanded, onToggle }: {
  action: any; graph: any; expanded: boolean; onToggle: () => void;
}) {
  const prio = PRIORITY_COLORS[action.priority] ?? PRIORITY_COLORS.medium;

  return (
    <div className={cn(
      "rounded-lg overflow-hidden transition-all border",
      expanded ? `${prio.bg} ${prio.border}` : "bg-[#1e1e1e] border-[#2a2a2a] hover:border-[#444]",
    )}>
      <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={onToggle}>
        {/* Priority dot */}
        <div className="shrink-0 mt-1">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: prio.dot }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-medium text-[#ddd]">{action.title}</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", prio.bg, prio.border, prio.text)}>
              {action.priority}
            </span>
            <span className="text-[10px] text-[#666]">
              {CATEGORY_ICONS[action.category] ?? "◆"} {action.category}
            </span>
          </div>

          <p className="text-xs text-[#999] line-clamp-2">{action.description}</p>

          {/* Inline visual bar */}
          <div className="mt-2 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 bg-[#333] rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${action.confidence * 100}%`, backgroundColor: prio.dot }} />
              </div>
              <span className="text-[10px] text-[#777]">{Math.round(action.confidence * 100)}%</span>
            </div>
            {action.affectedBars && (
              <span className="text-[10px] text-[#666] font-mono">bars {action.affectedBars}</span>
            )}
            {action.expectedImpact && (
              <span className="text-[10px] text-[#666]">impact: {action.expectedImpact}</span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-[#555] text-sm">{expanded ? "▲" : "▼"}</div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-[#333]/50 ml-6">
          <p className="text-sm text-[#bbb] leading-relaxed">{action.description}</p>

          {/* Affected tracks visual */}
          {action.affectedTracks?.length > 0 && graph && (
            <div>
              <span className="text-[10px] text-[#666] block mb-1.5">Affected Tracks</span>
              <div className="flex flex-wrap gap-1.5">
                {action.affectedTracks.map((t: string) => {
                  const allTracks = [...(graph.tracks ?? []), ...(graph.returnTracks ?? [])];
                  const matchedTrack = allTracks.find((tr: any) => tr.name === t || tr.id === t);
                  const color = matchedTrack
                    ? (matchedTrack.color != null ? getTrackColor(matchedTrack.color) : getRoleColor(matchedTrack.inferredRole))
                    : "#666";
                  return (
                    <div key={t} className="flex items-center gap-1 px-2 py-1 bg-[#252525] rounded">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[10px] text-[#aaa]">{t}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {action.affectedBars && (
            <div className="flex gap-2 text-xs">
              <span className="text-[#666]">Bars:</span>
              <span className="text-[#aaa] font-mono">{action.affectedBars}</span>
            </div>
          )}

          <div className="p-3 bg-[#1a1a1a] rounded border border-[#333]">
            <p className="text-xs text-[#999] leading-relaxed">
              <span className="text-[#bbb] font-medium">Rationale: </span>
              {action.rationale}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterButton({ label, active, onClick, count }: {
  label: string; active: boolean; onClick: () => void; count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5",
        active
          ? "bg-[#555] text-white"
          : "bg-[#252525] text-[#888] hover:bg-[#333] hover:text-[#ccc]"
      )}
    >
      {label}
      <span className={`text-[10px] ${active ? "opacity-70" : "opacity-50"}`}>({count})</span>
    </button>
  );
}

function MetricCard({ label, value, valueClass = "text-[#ccc]" }: {
  label: string; value: string; valueClass?: string;
}) {
  return (
    <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-3">
      <p className="text-[10px] text-[#666] mb-1">{label}</p>
      <p className={`text-base font-semibold font-mono ${valueClass}`}>{value}</p>
    </div>
  );
}
