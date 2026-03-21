import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "wouter";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { getRoleColor, getTrackColor, formatBars, cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

type ViewMode = "arrangement" | "automation" | "sidechain";

const TRACK_HEIGHT = 48;
const AUTO_LANE_HEIGHT = 40;
const LABEL_WIDTH = 200;
const RULER_HEIGHT = 32;
const SECTION_HEIGHT = 22;
const MIN_PX_PER_BAR = 2;
const MAX_PX_PER_BAR = 80;

export default function TimelineView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: graph, isLoading } = useGetProjectGraph(id);
  const { selectedTrackId, setSelectedTrack } = useStudioStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("arrangement");
  const [pixelsPerBar, setPixelsPerBar] = useState(12);
  const [expandedAutoTracks, setExpandedAutoTracks] = useState<Set<string>>(new Set());

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPixelsPerBar((prev) => {
        const delta = e.deltaY > 0 ? -1 : 1;
        const factor = 1 + delta * 0.15;
        return Math.min(MAX_PX_PER_BAR, Math.max(MIN_PX_PER_BAR, Math.round(prev * factor)));
      });
    }
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

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

  const allTracks = [...(graph.tracks ?? []), ...(graph.returnTracks ?? [])];
  const maxClipEnd = allTracks.reduce((max: number, t: any) =>
    (t.clips ?? []).reduce((m: number, c: any) => Math.max(m, c.end ?? 0), max), 0);
  const totalBeats = Math.max(graph.arrangementLength ?? 128, maxClipEnd, 64);
  const timelineWidth = totalBeats * pixelsPerBar;
  const selectedTrack = allTracks.find((t: any) => t.id === selectedTrackId) ?? null;

  const toggleAutoExpand = (trackId: string) => {
    setExpandedAutoTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const zoomIn = () => setPixelsPerBar((p) => Math.min(MAX_PX_PER_BAR, Math.round(p * 1.3)));
  const zoomOut = () => setPixelsPerBar((p) => Math.max(MIN_PX_PER_BAR, Math.round(p / 1.3)));

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <Toolbar
          viewMode={viewMode}
          setViewMode={setViewMode}
          graph={graph}
          totalBeats={totalBeats}
          allTracks={allTracks}
          pixelsPerBar={pixelsPerBar}
          zoomIn={zoomIn}
          zoomOut={zoomOut}
        />

        {viewMode === "sidechain" ? (
          <SidechainView graph={graph} />
        ) : (
          <div className="flex-1 overflow-auto" ref={scrollContainerRef}>
            <div className="inline-block min-w-full">
              {/* Ruler */}
              <div className="flex sticky top-0 z-20 bg-[#1a1a1a] border-b border-[#333]" style={{ height: RULER_HEIGHT }}>
                <div className="shrink-0 bg-[#1e1e1e] border-r border-[#333] sticky left-0 z-30" style={{ width: LABEL_WIDTH }} />
                <div className="relative" style={{ width: timelineWidth, height: RULER_HEIGHT }}>
                  <Ruler totalBeats={totalBeats} pixelsPerBar={pixelsPerBar} />
                </div>
              </div>

              {/* Section markers */}
              {graph.sections?.length > 0 && (
                <div className="flex sticky top-8 z-10 bg-[#1e1e1e] border-b border-[#444]">
                  <div className="shrink-0 bg-[#1e1e1e] border-r border-[#333] sticky left-0 z-20" style={{ width: LABEL_WIDTH, height: SECTION_HEIGHT }} />
                  <div className="relative" style={{ width: timelineWidth, height: SECTION_HEIGHT }}>
                    {graph.sections.map((section: any) => (
                      <SectionMarker key={section.id} section={section} pixelsPerBar={pixelsPerBar} />
                    ))}
                  </div>
                </div>
              )}

              {/* Locators */}
              {graph.locators?.length > 0 && (
                <div className="flex bg-[#1a1a1a] border-b border-[#333]">
                  <div className="shrink-0 bg-[#1e1e1e] border-r border-[#333] sticky left-0 z-20" style={{ width: LABEL_WIDTH, height: 18 }} />
                  <div className="relative" style={{ width: timelineWidth, height: 18 }}>
                    {graph.locators.map((loc: any, i: number) => (
                      <div key={i} className="absolute top-0 bottom-0" style={{ left: loc.time * pixelsPerBar }}>
                        <div className="absolute top-0 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-orange-500" />
                        {pixelsPerBar > 4 && (
                          <span className="absolute top-0 left-2 text-[8px] text-orange-400 whitespace-nowrap">{loc.name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tracks */}
              {allTracks.map((track: any) => {
                const hasAutoLanes = (track.automationLanes?.length ?? 0) > 0;
                const isAutoExpanded = expandedAutoTracks.has(track.id);
                const showAutoLanes = viewMode === "automation" || isAutoExpanded;
                const trackColor = track.color != null ? getTrackColor(track.color) : getRoleColor(track.inferredRole);
                const isGroup = track.type === "group";
                const isReturn = track.type === "return";
                const isSelected = selectedTrackId === track.id;

                return (
                  <div key={track.id}>
                    <div
                      className={cn(
                        "flex border-b cursor-pointer",
                        isSelected ? "border-[#555]" : "border-[#2a2a2a]",
                        isGroup && "bg-[#222]",
                      )}
                      style={{ height: TRACK_HEIGHT }}
                      onClick={() => setSelectedTrack(isSelected ? null : track.id)}
                    >
                      {/* Track label */}
                      <div
                        className={cn(
                          "shrink-0 border-r border-[#333] flex items-center gap-2 px-2 sticky left-0 z-10",
                          isSelected ? "bg-[#2a2a3a]" : "bg-[#1e1e1e]",
                        )}
                        style={{ width: LABEL_WIDTH }}
                      >
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: trackColor }} />
                        <div className="min-w-0 flex-1">
                          <p className={cn(
                            "text-[11px] font-medium truncate",
                            track.muted ? "text-[#666]" : "text-[#ccc]",
                          )}>
                            {track.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {track.muted && <span className="text-[9px] text-yellow-600 font-bold">M</span>}
                          {track.solo && <span className="text-[9px] text-blue-400 font-bold">S</span>}
                          {isReturn && <span className="text-[8px] text-muted-foreground">Ret</span>}
                          {hasAutoLanes && viewMode !== "automation" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleAutoExpand(track.id); }}
                              className={cn(
                                "w-4 h-4 flex items-center justify-center rounded text-[8px]",
                                isAutoExpanded ? "bg-primary/30 text-primary" : "text-[#555] hover:text-[#999]"
                              )}
                              title="Toggle automation"
                            >
                              A
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Clip area */}
                      <div className="relative bg-[#1a1a1a]" style={{ width: timelineWidth, height: TRACK_HEIGHT }}>
                        {/* Grid lines */}
                        <GridLines totalBeats={totalBeats} pixelsPerBar={pixelsPerBar} />
                        {/* Clips */}
                        {track.clips?.map((clip: any) => (
                          <ClipBlock key={clip.id} clip={clip} trackColor={trackColor} pixelsPerBar={pixelsPerBar} muted={track.muted} />
                        ))}
                      </div>
                    </div>

                    {/* Automation lanes */}
                    {showAutoLanes && track.automationLanes?.map((lane: any, idx: number) => (
                      <AutomationLaneRow
                        key={`${track.id}-auto-${idx}`}
                        lane={lane}
                        trackColor={trackColor}
                        pixelsPerBar={pixelsPerBar}
                        timelineWidth={timelineWidth}
                        totalBeats={totalBeats}
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

function Toolbar({
  viewMode, setViewMode, graph, totalBeats, allTracks, pixelsPerBar, zoomIn, zoomOut,
}: {
  viewMode: ViewMode; setViewMode: (m: ViewMode) => void;
  graph: any; totalBeats: number; allTracks: any[]; pixelsPerBar: number;
  zoomIn: () => void; zoomOut: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#333] bg-[#1e1e1e] shrink-0">
      <div className="flex items-center gap-0.5 bg-[#2a2a2a] rounded p-0.5 mr-3">
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
                ? "bg-[#555] text-white"
                : "text-[#888] hover:text-[#ccc]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-[#888] font-mono mr-auto">
        <span className="text-[#ccc]">{graph.tempo} BPM</span>
        <span>{graph.timeSignatureNumerator}/{graph.timeSignatureDenominator}</span>
        <span>{formatBars(totalBeats)}</span>
        <span>{allTracks.length} tracks</span>
      </div>

      <div className="flex items-center gap-1">
        <button onClick={zoomOut} className="w-6 h-6 flex items-center justify-center rounded text-xs text-[#888] hover:bg-[#333] hover:text-white" title="Zoom out">−</button>
        <span className="text-[10px] text-[#666] font-mono w-10 text-center">{pixelsPerBar * 4}px/bar</span>
        <button onClick={zoomIn} className="w-6 h-6 flex items-center justify-center rounded text-xs text-[#888] hover:bg-[#333] hover:text-white" title="Zoom in">+</button>
      </div>
    </div>
  );
}

function GridLines({ totalBeats, pixelsPerBar }: { totalBeats: number; pixelsPerBar: number }) {
  const barPx = pixelsPerBar * 4;
  const totalBarCount = Math.ceil(totalBeats / 4);
  const barInterval = barPx < 24 ? 16 : barPx < 48 ? 8 : barPx < 80 ? 4 : barPx < 160 ? 2 : 1;
  const lines = [];
  for (let bar = 0; bar <= totalBarCount; bar += barInterval) {
    lines.push(
      <div key={bar} className="absolute top-0 bottom-0 w-px bg-[#2a2a2a]" style={{ left: bar * 4 * pixelsPerBar }} />
    );
  }
  return <>{lines}</>;
}

function Ruler({ totalBeats, pixelsPerBar }: { totalBeats: number; pixelsPerBar: number }) {
  const barPx = pixelsPerBar * 4;
  const totalBarCount = Math.ceil(totalBeats / 4);
  const barInterval = barPx < 24 ? 16 : barPx < 48 ? 8 : barPx < 80 ? 4 : barPx < 160 ? 2 : 1;
  const markers = [];
  for (let bar = 0; bar <= totalBarCount; bar += barInterval) {
    markers.push(
      <div key={bar} className="absolute top-0 bottom-0" style={{ left: bar * 4 * pixelsPerBar }}>
        <div className="absolute top-0 bottom-0 w-px bg-[#444]" />
        <span className="absolute bottom-1 left-1 text-[9px] font-mono text-[#888]">{bar + 1}</span>
      </div>
    );
  }
  return <>{markers}</>;
}

function ClipBlock({ clip, trackColor, pixelsPerBar, muted }: {
  clip: any; trackColor: string; pixelsPerBar: number; muted: boolean;
}) {
  const left = clip.start * pixelsPerBar;
  const width = Math.max((clip.end - clip.start) * pixelsPerBar, 2);
  const isMidi = clip.clipType === "midi";
  const opacity = muted ? 0.35 : 1;

  return (
    <div
      className="absolute top-[2px] bottom-[2px] overflow-hidden"
      style={{
        left, width, opacity,
        backgroundColor: trackColor,
        borderRadius: 2,
        borderLeft: `2px solid ${trackColor}`,
        borderRight: `1px solid rgba(0,0,0,0.3)`,
        borderBottom: `1px solid rgba(0,0,0,0.3)`,
      }}
      title={`${clip.clipType} · ${((clip.end - clip.start) / 4).toFixed(1)} bars${clip.midiNoteCount ? ` · ${clip.midiNoteCount} notes` : ""}`}
    >
      {/* Clip header */}
      <div
        className="h-[12px] flex items-center px-1 overflow-hidden"
        style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
      >
        {width > 20 && (
          <span className="text-[8px] font-medium text-white/80 truncate">
            {isMidi ? "M" : "♪"}
            {width > 50 && clip.contentSummary ? ` ${clip.contentSummary}` : ""}
          </span>
        )}
      </div>

      {/* Clip body — simulated MIDI notes or waveform */}
      {width > 10 && (
        <div className="relative flex-1" style={{ height: TRACK_HEIGHT - 16 }}>
          {isMidi && clip.midiNoteCount > 0 ? (
            <MidiPreview noteCount={clip.midiNoteCount} width={width} height={TRACK_HEIGHT - 16} color={trackColor} />
          ) : (
            <WaveformPreview width={width} height={TRACK_HEIGHT - 16} color={trackColor} />
          )}
        </div>
      )}
    </div>
  );
}

function MidiPreview({ noteCount, width, height, color }: {
  noteCount: number; width: number; height: number; color: string;
}) {
  const noteLines = Math.min(noteCount, Math.floor(width / 3));
  const rects = [];
  for (let i = 0; i < noteLines; i++) {
    const x = (i / noteLines) * width;
    const y = (Math.sin(i * 1.5) * 0.3 + 0.5) * height * 0.7;
    const w = Math.max(width / noteLines - 1, 1);
    const h = 2 + Math.random() * 3;
    rects.push(
      <rect key={i} x={x} y={y} width={w} height={h} fill="rgba(0,0,0,0.4)" rx={0.5} />
    );
  }
  return (
    <svg width={width} height={height} className="absolute inset-0">
      {rects}
    </svg>
  );
}

function WaveformPreview({ width, height, color }: { width: number; height: number; color: string }) {
  const mid = height / 2;
  const points = Math.min(Math.floor(width / 2), 60);
  let d = `M 0 ${mid}`;
  for (let i = 0; i <= points; i++) {
    const x = (i / points) * width;
    const amp = (Math.sin(i * 0.8) * 0.3 + Math.sin(i * 2.1) * 0.2 + 0.5) * height * 0.4;
    d += ` L ${x} ${mid - amp}`;
  }
  for (let i = points; i >= 0; i--) {
    const x = (i / points) * width;
    const amp = (Math.sin(i * 0.8) * 0.3 + Math.sin(i * 2.1) * 0.2 + 0.5) * height * 0.35;
    d += ` L ${x} ${mid + amp}`;
  }
  d += " Z";
  return (
    <svg width={width} height={height} className="absolute inset-0">
      <path d={d} fill="rgba(0,0,0,0.3)" />
    </svg>
  );
}

function SectionMarker({ section, pixelsPerBar }: { section: any; pixelsPerBar: number }) {
  const left = section.startBar * pixelsPerBar;
  const width = (section.endBar - section.startBar) * pixelsPerBar;

  return (
    <div className="absolute top-0 bottom-0 flex items-center" style={{ left, width }}>
      <div className="absolute top-0 bottom-0 left-0 w-px bg-[#666]" />
      <div className="absolute top-0 left-0 w-0 h-0 border-l-[4px] border-r-[4px] border-b-[5px] border-l-transparent border-r-transparent border-b-[#999]" />
      {pixelsPerBar > 3 && (
        <span className="pl-2 text-[9px] font-medium text-[#aaa] uppercase tracking-wider truncate">
          {section.label}
        </span>
      )}
    </div>
  );
}

function AutomationLaneRow({ lane, trackColor, pixelsPerBar, timelineWidth, totalBeats }: {
  lane: any; trackColor: string; pixelsPerBar: number; timelineWidth: number; totalBeats: number;
}) {
  const points = lane.points ?? [];
  if (points.length === 0) return null;

  const minVal = Math.min(...points.map((p: any) => p.value));
  const maxVal = Math.max(...points.map((p: any) => p.value));
  const range = maxVal - minVal || 1;

  const pathData = points.map((p: any, i: number) => {
    const x = p.time * pixelsPerBar;
    const y = AUTO_LANE_HEIGHT - ((p.value - minVal) / range) * (AUTO_LANE_HEIGHT - 6) - 3;
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  return (
    <div className="flex border-b border-[#222]" style={{ height: AUTO_LANE_HEIGHT }}>
      <div
        className="shrink-0 border-r border-[#333] flex items-center px-2 gap-1.5 sticky left-0 z-10 bg-[#1a1a1a]"
        style={{ width: LABEL_WIDTH }}
      >
        <div className="w-1.5 h-3 rounded-sm opacity-60" style={{ backgroundColor: trackColor }} />
        <span className="text-[9px] text-[#777] truncate">{lane.parameterName}</span>
        <span className="text-[8px] text-[#555] ml-auto shrink-0">{lane.shapeSummary}</span>
      </div>
      <div className="relative overflow-hidden bg-[#161616]" style={{ width: timelineWidth, height: AUTO_LANE_HEIGHT }}>
        <GridLines totalBeats={totalBeats} pixelsPerBar={pixelsPerBar} />
        <svg width={timelineWidth} height={AUTO_LANE_HEIGHT} className="absolute inset-0">
          <path d={pathData} fill="none" stroke={trackColor} strokeWidth={1.5} strokeOpacity={0.7} />
          {points.map((p: any, i: number) => (
            <circle
              key={i}
              cx={p.time * pixelsPerBar}
              cy={AUTO_LANE_HEIGHT - ((p.value - minVal) / range) * (AUTO_LANE_HEIGHT - 6) - 3}
              r={2}
              fill={trackColor}
              opacity={0.9}
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
          <p className="text-[#888] text-sm">No sidechain relationships detected</p>
          <p className="text-xs text-[#555] mt-2">Sidechain detection looks for compressors on non-kick tracks near kick sources</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <p className="text-xs text-[#888]">
          {links.length} sidechain relationship{links.length !== 1 ? "s" : ""} detected
        </p>
        <div className="space-y-3">
          {links.map((link: any, i: number) => {
            const src = allTracks.find((t: any) => t.id === link.sourceTrackId);
            const tgt = allTracks.find((t: any) => t.id === link.targetTrackId);
            const srcColor = src ? (src.color != null ? getTrackColor(src.color) : getRoleColor(src.inferredRole)) : "#666";
            const tgtColor = tgt ? (tgt.color != null ? getTrackColor(tgt.color) : getRoleColor(tgt.inferredRole)) : "#666";

            return (
              <div key={i} className="bg-[#1e1e1e] border border-[#333] rounded-lg p-4 flex items-center gap-4">
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: srcColor }} />
                  <div>
                    <p className="text-xs font-medium text-[#ccc]">{link.sourceTrackName}</p>
                    <p className="text-[9px] text-[#666]">Source</p>
                  </div>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="h-px flex-1 bg-[#444]" />
                  <span className="text-xs text-primary font-mono">→ SC →</span>
                  <div className="h-px flex-1 bg-[#444]" />
                </div>
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tgtColor }} />
                  <div>
                    <p className="text-xs font-medium text-[#ccc]">{link.targetTrackName}</p>
                    <p className="text-[9px] text-[#666]">Target</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-[#777]">{link.deviceClass}</p>
                  <p className="text-[10px] text-[#666]">{Math.round(link.confidence * 100)}%</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TrackInspector({ track, onClose }: { track: any; onClose: () => void }) {
  const trackColor = track.color != null ? getTrackColor(track.color) : getRoleColor(track.inferredRole);

  return (
    <div className="w-64 shrink-0 border-l border-[#333] bg-[#1e1e1e] flex flex-col overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#333] sticky top-0 bg-[#1e1e1e] z-10">
        <h3 className="text-sm font-medium text-[#ccc]">Inspector</h3>
        <button onClick={onClose} className="text-[#666] hover:text-[#ccc] text-lg leading-none">×</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: trackColor }} />
          <div>
            <p className="text-sm font-medium text-[#ddd]">{track.name}</p>
            <p className="text-[10px] text-[#777] font-mono">{track.type}</p>
          </div>
        </div>

        <div>
          <p className="text-[10px] text-[#666] mb-1.5">Role</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#ccc]">{track.inferredRole}</span>
            <span className="text-[10px] text-[#777]">{Math.round(track.inferredConfidence * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1 bg-[#333] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${track.inferredConfidence * 100}%`, backgroundColor: trackColor }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Clips" value={track.clipCount} />
          <MiniStat label="Devices" value={track.deviceCount} />
          <MiniStat label="Auto" value={track.automationPoints} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {track.muted && <Badge text="Muted" cls="bg-yellow-500/15 text-yellow-400" />}
          {track.solo && <Badge text="Solo" cls="bg-blue-500/15 text-blue-400" />}
          {track.frozen && <Badge text="Frozen" cls="bg-sky-500/15 text-sky-400" />}
          {track.armed && <Badge text="Armed" cls="bg-red-500/15 text-red-400" />}
        </div>

        {track.automationLanes?.length > 0 && (
          <div>
            <p className="text-[10px] text-[#666] mb-2">Automation ({track.automationLanes.length})</p>
            <div className="space-y-1">
              {track.automationLanes.map((lane: any, i: number) => (
                <div key={i} className="text-xs px-2 py-1 rounded bg-[#252525] flex items-center justify-between">
                  <span className="text-[#aaa] truncate max-w-[100px]">{lane.parameterName}</span>
                  <span className="text-[8px] text-[#666] shrink-0">{lane.points?.length ?? 0} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {track.routing && (track.routing.audioOutput || track.routing.sends?.length > 0) && (
          <div>
            <p className="text-[10px] text-[#666] mb-2">Routing</p>
            {track.routing.audioOutput && (
              <div className="text-xs px-2 py-1 rounded bg-[#252525] mb-1">
                <span className="text-[#666]">Out: </span>
                <span className="text-[#aaa]">{track.routing.audioOutput.upper || "Master"}</span>
              </div>
            )}
            {track.routing.sends?.length > 0 && (
              <div className="text-xs px-2 py-1 rounded bg-[#252525]">
                <span className="text-[#666]">Sends: </span>
                <span className="text-[#aaa]">{track.routing.sends.filter((s: any) => s.active).length} active</span>
              </div>
            )}
          </div>
        )}

        {track.devices?.length > 0 && (
          <div>
            <p className="text-[10px] text-[#666] mb-2">Devices ({track.devices.length})</p>
            <div className="space-y-1">
              {track.devices.map((dev: any) => (
                <div key={dev.id} className={cn("text-xs px-2 py-1 rounded bg-[#252525] flex items-center justify-between", !dev.enabled && "opacity-35")}>
                  <span className="text-[#aaa] truncate max-w-[110px]">{dev.pluginName || dev.deviceClass}</span>
                  <span className="text-[8px] text-[#555] shrink-0 ml-1">{dev.inferredPurpose}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {track.warnings?.length > 0 && (
          <div>
            <p className="text-[10px] text-[#666] mb-2">Warnings</p>
            {track.warnings.map((w: string, i: number) => (
              <p key={i} className="text-[10px] text-yellow-500/80">⚠ {w}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#252525] rounded p-2 text-center">
      <p className="text-xs font-mono text-[#ccc]">{value}</p>
      <p className="text-[9px] text-[#666]">{label}</p>
    </div>
  );
}

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>{text}</span>;
}
