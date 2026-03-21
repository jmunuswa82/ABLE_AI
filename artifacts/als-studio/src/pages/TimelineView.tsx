import { useState, useRef, useMemo } from "react";
import { useParams } from "wouter";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { getRoleColor, formatBars, cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

type ViewMode = "arrangement" | "automation" | "sidechain";

const AUTO_LANE_HEIGHT = 40;
const TRACK_HEIGHT = 36;
const LABEL_WIDTH = 180;
const RULER_HEIGHT = 28;
const SECTION_HEIGHT = 24;

const ZOOM_LEVELS = [4, 6, 8, 12, 16, 24, 32, 48];

export default function TimelineView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: graph, isLoading } = useGetProjectGraph(id);

  const { selectedTrackId, setSelectedTrack } = useStudioStore();
  const containerRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("arrangement");
  const [zoomIdx, setZoomIdx] = useState(3);
  const [expandedAutoTracks, setExpandedAutoTracks] = useState<Set<string>>(new Set());

  const pixelsPerBar = ZOOM_LEVELS[zoomIdx] ?? 12;

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading timeline...</div>;
  }

  if (!graph) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground text-sm">No project data available yet.</p>
        <p className="text-xs text-muted-foreground mt-2">Upload and analyze an .als file first.</p>
      </div>
    );
  }

  const totalBars = Math.max(graph.arrangementLength ?? 128, 64);
  const timelineWidth = totalBars * pixelsPerBar;
  const allTracks = [...(graph.tracks ?? []), ...(graph.returnTracks ?? [])];
  const selectedTrack = allTracks.find((t: any) => t.id === selectedTrackId) ?? null;

  const toggleAutoExpand = (trackId: string) => {
    setExpandedAutoTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const zoomIn = () => setZoomIdx((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1));
  const zoomOut = () => setZoomIdx((i) => Math.max(i - 1, 0));

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card shrink-0">
          {/* View mode tabs */}
          <div className="flex items-center gap-0.5 bg-muted/30 rounded p-0.5 mr-3">
            {([
              { key: "arrangement", label: "Arrange" },
              { key: "automation", label: "Automation" },
              { key: "sidechain", label: "Sidechain" },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setViewMode(tab.key)}
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded font-medium transition-colors",
                  viewMode === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Info */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono mr-auto">
            <span>{graph.tempo} BPM</span>
            <span>{graph.timeSignatureNumerator}/{graph.timeSignatureDenominator}</span>
            <span>{formatBars(totalBars)}</span>
            <span>{allTracks.length} tracks</span>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button onClick={zoomOut} className="w-6 h-6 flex items-center justify-center rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground" title="Zoom out">−</button>
            <span className="text-[10px] text-muted-foreground font-mono w-8 text-center">{pixelsPerBar}px</span>
            <button onClick={zoomIn} className="w-6 h-6 flex items-center justify-center rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground" title="Zoom in">+</button>
          </div>
        </div>

        {/* Render selected view */}
        {viewMode === "sidechain" ? (
          <SidechainView graph={graph} />
        ) : (
          <div className="flex-1 overflow-auto" ref={containerRef}>
            <div className="inline-block min-w-full">
              {/* Ruler */}
              <div className="flex border-b border-border sticky top-0 z-20 bg-background" style={{ height: RULER_HEIGHT }}>
                <div className="shrink-0 bg-sidebar border-r border-border sticky left-0 z-30" style={{ width: LABEL_WIDTH }} />
                <div className="relative" style={{ width: timelineWidth, height: RULER_HEIGHT }}>
                  <Ruler totalBars={totalBars} pixelsPerBar={pixelsPerBar} />
                </div>
              </div>

              {/* Locator markers */}
              {graph.locators?.length > 0 && (
                <div className="flex border-b border-border sticky top-7 z-10 bg-background/80">
                  <div className="shrink-0 bg-sidebar border-r border-border sticky left-0 z-20 flex items-center px-2" style={{ width: LABEL_WIDTH, height: 20 }}>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Locators</span>
                  </div>
                  <div className="relative" style={{ width: timelineWidth, height: 20 }}>
                    {graph.locators.map((loc: any, i: number) => (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 border-l border-orange-500/50 flex items-center"
                        style={{ left: loc.time * pixelsPerBar }}
                      >
                        <span className="text-[8px] text-orange-400/70 pl-0.5 whitespace-nowrap">{loc.name || `Marker ${i + 1}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sections */}
              {graph.sections?.length > 0 && (
                <div className="flex border-b border-border">
                  <div className="shrink-0 bg-sidebar border-r border-border sticky left-0 z-20 flex items-center px-2" style={{ width: LABEL_WIDTH, height: SECTION_HEIGHT }}>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Sections</span>
                  </div>
                  <div className="relative" style={{ width: timelineWidth, height: SECTION_HEIGHT }}>
                    {graph.sections.map((section: any) => (
                      <SectionBlock key={section.id} section={section} pixelsPerBar={pixelsPerBar} />
                    ))}
                  </div>
                </div>
              )}

              {/* Tracks */}
              {allTracks.map((track: any) => {
                const hasAutoLanes = (track.automationLanes?.length ?? 0) > 0;
                const isAutoExpanded = expandedAutoTracks.has(track.id);
                const showAutoLanes = viewMode === "automation" || isAutoExpanded;

                return (
                  <div key={track.id}>
                    {/* Main track row */}
                    <div
                      className={cn(
                        "flex border-b border-border cursor-pointer",
                        selectedTrackId === track.id ? "bg-accent/20" : "hover:bg-muted/10"
                      )}
                      style={{ height: TRACK_HEIGHT }}
                      onClick={() => setSelectedTrack(selectedTrackId === track.id ? null : track.id)}
                    >
                      <div
                        className="shrink-0 border-r border-border flex items-center px-2 gap-2 sticky left-0 z-10 bg-sidebar"
                        style={{ width: LABEL_WIDTH }}
                      >
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getRoleColor(track.inferredRole) }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{track.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{track.inferredRole}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {track.muted && <span className="text-[8px] text-yellow-500">M</span>}
                          {hasAutoLanes && viewMode !== "automation" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleAutoExpand(track.id); }}
                              className={cn(
                                "w-4 h-4 flex items-center justify-center rounded text-[9px]",
                                isAutoExpanded ? "bg-primary/30 text-primary" : "text-muted-foreground hover:text-foreground"
                              )}
                              title="Toggle automation lanes"
                            >
                              ≋
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="relative" style={{ width: timelineWidth, height: TRACK_HEIGHT }}>
                        {track.clips?.map((clip: any) => (
                          <ClipBlock key={clip.id} clip={clip} track={track} pixelsPerBar={pixelsPerBar} />
                        ))}
                      </div>
                    </div>

                    {/* Automation lanes */}
                    {showAutoLanes && track.automationLanes?.map((lane: any, idx: number) => (
                      <AutomationLaneRow
                        key={`${track.id}-auto-${idx}`}
                        lane={lane}
                        track={track}
                        pixelsPerBar={pixelsPerBar}
                        timelineWidth={timelineWidth}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Inspector */}
      {selectedTrack && viewMode !== "sidechain" && (
        <TrackInspector track={selectedTrack} onClose={() => setSelectedTrack(null)} />
      )}
    </div>
  );
}

function AutomationLaneRow({ lane, track, pixelsPerBar, timelineWidth }: {
  lane: any; track: any; pixelsPerBar: number; timelineWidth: number;
}) {
  const points = lane.points ?? [];
  if (points.length === 0) return null;

  const color = getRoleColor(track.inferredRole);
  const minVal = Math.min(...points.map((p: any) => p.value));
  const maxVal = Math.max(...points.map((p: any) => p.value));
  const range = maxVal - minVal || 1;

  const pathData = points.map((p: any, i: number) => {
    const x = p.time * pixelsPerBar;
    const y = AUTO_LANE_HEIGHT - ((p.value - minVal) / range) * (AUTO_LANE_HEIGHT - 4) - 2;
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  return (
    <div className="flex border-b border-border/50 bg-background/50" style={{ height: AUTO_LANE_HEIGHT }}>
      <div
        className="shrink-0 border-r border-border/50 flex items-center px-2 gap-1.5 sticky left-0 z-10 bg-sidebar/80"
        style={{ width: LABEL_WIDTH }}
      >
        <div className="w-1 h-3 rounded-sm opacity-50" style={{ backgroundColor: color }} />
        <span className="text-[9px] text-muted-foreground truncate">{lane.parameterName}</span>
        <span className="text-[8px] text-muted-foreground/50 ml-auto shrink-0">{lane.shapeSummary}</span>
      </div>
      <div className="relative overflow-hidden" style={{ width: timelineWidth, height: AUTO_LANE_HEIGHT }}>
        <svg width={timelineWidth} height={AUTO_LANE_HEIGHT} className="absolute inset-0">
          <path d={pathData} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.6} />
          {points.map((p: any, i: number) => (
            <circle
              key={i}
              cx={p.time * pixelsPerBar}
              cy={AUTO_LANE_HEIGHT - ((p.value - minVal) / range) * (AUTO_LANE_HEIGHT - 4) - 2}
              r={1.5}
              fill={color}
              opacity={0.8}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function SidechainView({ graph }: { graph: any }) {
  const links = graph.sidechainLinks ?? [];
  const allTracks = [...(graph.tracks ?? []), ...(graph.returnTracks ?? [])];

  if (links.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground text-sm">No sidechain relationships detected</p>
          <p className="text-xs text-muted-foreground mt-2">
            Sidechain detection looks for compressors on non-kick tracks
          </p>
        </div>
      </div>
    );
  }

  const involvedIds = new Set<string>();
  links.forEach((l: any) => { involvedIds.add(l.sourceTrackId); involvedIds.add(l.targetTrackId); });
  const involvedTracks = allTracks.filter((t: any) => involvedIds.has(t.id));

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Sidechain Map</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Detected {links.length} sidechain relationship{links.length !== 1 ? "s" : ""} between {involvedTracks.length} tracks
          </p>
        </div>

        <div className="space-y-3">
          {links.map((link: any, i: number) => {
            const sourceColor = getRoleColor(
              allTracks.find((t: any) => t.id === link.sourceTrackId)?.inferredRole ?? "unknown"
            );
            const targetColor = getRoleColor(
              allTracks.find((t: any) => t.id === link.targetTrackId)?.inferredRole ?? "unknown"
            );

            return (
              <div key={i} className="bg-card border border-card-border rounded-lg p-4 flex items-center gap-4">
                {/* Source */}
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sourceColor }} />
                  <div>
                    <p className="text-xs font-medium text-foreground">{link.sourceTrackName}</p>
                    <p className="text-[9px] text-muted-foreground">Source</p>
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex-1 flex items-center justify-center gap-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-primary">→ SC →</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Target */}
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: targetColor }} />
                  <div>
                    <p className="text-xs font-medium text-foreground">{link.targetTrackName}</p>
                    <p className="text-[9px] text-muted-foreground">Target</p>
                  </div>
                </div>

                {/* Info */}
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-muted-foreground">{link.deviceClass}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {Math.round(link.confidence * 100)}% conf
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-muted/20 border border-border rounded-lg p-4">
          <h3 className="text-xs font-medium text-foreground mb-2">About Sidechain Detection</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sidechain relationships are inferred by analyzing compressor placement and track roles.
            A compressor on a bass or synth track in a project with a kick drum is likely receiving
            sidechain input from the kick for that characteristic pumping effect common in techno production.
          </p>
        </div>
      </div>
    </div>
  );
}

function Ruler({ totalBars, pixelsPerBar }: { totalBars: number; pixelsPerBar: number }) {
  const markerInterval = pixelsPerBar < 8 ? 16 : pixelsPerBar < 14 ? 8 : 4;
  const markers = [];
  for (let bar = 0; bar <= totalBars; bar += markerInterval) {
    markers.push(bar);
  }

  return (
    <>
      {markers.map((bar) => (
        <div key={bar} className="absolute top-0 bottom-0 flex items-end pb-1" style={{ left: bar * pixelsPerBar }}>
          <div className="absolute top-0 bottom-0 w-px bg-border/50" />
          <span className="text-[9px] font-mono text-muted-foreground pl-1 z-10">{bar + 1}</span>
        </div>
      ))}
    </>
  );
}

function ClipBlock({ clip, track, pixelsPerBar }: { clip: any; track: any; pixelsPerBar: number }) {
  const left = clip.start * pixelsPerBar;
  const width = Math.max((clip.end - clip.start) * pixelsPerBar, 2);
  const color = getRoleColor(track.inferredRole);

  return (
    <div
      className="absolute top-1 bottom-1 rounded-sm border border-white/10 overflow-hidden text-[9px] font-mono flex items-center px-1"
      style={{
        left, width,
        backgroundColor: color + "55",
        borderColor: color + "88",
        color: color,
      }}
      title={`${clip.clipType} · ${(clip.end - clip.start).toFixed(1)} bars${clip.midiNoteCount ? ` · ${clip.midiNoteCount} notes` : ""}`}
    >
      {width > 24 && (
        <span className="truncate opacity-80">
          {clip.clipType === "midi" ? "M" : "A"}
          {width > 60 && clip.contentSummary ? ` ${clip.contentSummary}` : ""}
        </span>
      )}
    </div>
  );
}

function SectionBlock({ section, pixelsPerBar }: { section: any; pixelsPerBar: number }) {
  const left = section.startBar * pixelsPerBar;
  const width = (section.endBar - section.startBar) * pixelsPerBar;

  const energyColors: Record<string, string> = {
    "Intro": "#4f8cd4", "Groove Establishment": "#52d4c4", "Build": "#d4c452",
    "Peak": "#e05252", "Breakdown": "#8c52d4", "Recovery": "#5284d4",
    "Second Peak": "#d47052", "Outro": "#527cd4",
  };
  const color = energyColors[section.label] ?? "#666";

  return (
    <div
      className="absolute top-0 bottom-0 border-l border-t border-b border-opacity-40 flex items-center px-1"
      style={{ left, width, borderColor: color, backgroundColor: color + "18" }}
      title={`${section.label} (energy: ${Math.round(section.energyScore * 100)}%)`}
    >
      <span className="text-[9px] font-mono truncate" style={{ color }}>{section.label}</span>
    </div>
  );
}

function TrackInspector({ track, onClose }: { track: any; onClose: () => void }) {
  const roleColor = getRoleColor(track.inferredRole);

  return (
    <div className="w-64 shrink-0 border-l border-border bg-card flex flex-col overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
        <h3 className="text-sm font-medium text-foreground">Inspector</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">×</button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Track</p>
          <p className="text-sm font-medium text-foreground">{track.name}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{track.type}</p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Inferred Role</p>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: roleColor }} />
            <span className="text-sm text-foreground">{track.inferredRole}</span>
            <span className="text-xs text-muted-foreground">{Math.round(track.inferredConfidence * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${track.inferredConfidence * 100}%`, backgroundColor: roleColor }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Clips" value={track.clipCount} />
          <MiniStat label="Devices" value={track.deviceCount} />
          <MiniStat label="Auto pts" value={track.automationPoints} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {track.muted && <Badge text="Muted" color="yellow" />}
          {track.solo && <Badge text="Solo" color="blue" />}
          {track.frozen && <Badge text="Frozen" color="sky" />}
          {track.armed && <Badge text="Armed" color="red" />}
        </div>

        {/* Automation summary */}
        {track.automationLanes?.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Automation ({track.automationLanes.length})</p>
            <div className="space-y-1">
              {track.automationLanes.map((lane: any, i: number) => (
                <div key={i} className="text-xs px-2 py-1 rounded bg-muted/30 flex items-center justify-between">
                  <span className="text-foreground truncate max-w-[100px]">{lane.parameterName}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[9px] text-muted-foreground">{lane.points?.length ?? 0} pts</span>
                    <span className={cn(
                      "text-[8px] px-1 rounded",
                      lane.shapeSummary === "static" ? "bg-red-500/10 text-red-400" :
                      lane.shapeSummary === "complex" ? "bg-green-500/10 text-green-400" :
                      "bg-yellow-500/10 text-yellow-400"
                    )}>
                      {lane.shapeSummary}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Routing */}
        {track.routing && Object.keys(track.routing).length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Routing</p>
            {track.routing.audioOutput && (
              <div className="text-xs px-2 py-1 rounded bg-muted/30 mb-1">
                <span className="text-muted-foreground">Out: </span>
                <span className="text-foreground">{track.routing.audioOutput.upper || track.routing.audioOutput.target || "Master"}</span>
              </div>
            )}
            {track.routing.sends?.length > 0 && (
              <div className="text-xs px-2 py-1 rounded bg-muted/30">
                <span className="text-muted-foreground">Sends: </span>
                <span className="text-foreground">{track.routing.sends.filter((s: any) => s.active).length} active</span>
              </div>
            )}
          </div>
        )}

        {track.devices?.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Devices</p>
            <div className="space-y-1">
              {track.devices.map((dev: any) => (
                <div key={dev.id} className={cn("text-xs px-2 py-1 rounded bg-muted/30 flex items-center justify-between", !dev.enabled && "opacity-40")}>
                  <span className="text-foreground truncate max-w-[120px]">{dev.pluginName || dev.deviceClass}</span>
                  <span className="text-muted-foreground text-[9px] shrink-0 ml-1">{dev.inferredPurpose}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {track.warnings?.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Warnings</p>
            <div className="space-y-1">
              {track.warnings.map((w: string, i: number) => (
                <p key={i} className="text-xs text-yellow-500/80">⚠ {w}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/30 rounded p-2 text-center">
      <p className="text-xs font-mono text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  const colorMap: Record<string, string> = {
    yellow: "bg-yellow-500/15 text-yellow-400",
    blue: "bg-blue-500/15 text-blue-400",
    sky: "bg-sky-500/15 text-sky-400",
    red: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${colorMap[color] ?? "bg-muted text-muted-foreground"}`}>
      {text}
    </span>
  );
}
