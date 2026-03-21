import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams } from "wouter";
import { motion } from "framer-motion";
import { useGetProjectGraph, useGetCompletionPlan } from "@workspace/api-client-react";
import { getRoleColor, getTrackColor, getAbletonColor, formatBars, cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

type ViewMode = "arrangement" | "automation" | "sidechain" | "proposed" | "diff";

const TRACK_HEIGHT = 56;
const AUTO_LANE_HEIGHT = 48;
const LABEL_WIDTH = 220;
const RULER_HEIGHT = 32;
const LOCATOR_HEIGHT = 24;
const SECTION_HEIGHT = 24;
const MIN_PX_PER_BAR = 1.5;
const MAX_PX_PER_BAR = 96;

class TimeMapper {
  readonly beatsPerBar: number;
  readonly pixelsPerBar: number;

  constructor(numerator: number, denominator: number, pixelsPerBar: number) {
    this.beatsPerBar = numerator * (4 / denominator);
    this.pixelsPerBar = pixelsPerBar;
  }
  beatsToPixels(beat: number): number { return (beat / this.beatsPerBar) * this.pixelsPerBar; }
  pixelsToBeats(px: number): number { return (px / this.pixelsPerBar) * this.beatsPerBar; }
  beatsWidth(beats: number): number { return (beats / this.beatsPerBar) * this.pixelsPerBar; }
  totalBars(totalBeats: number): number { return Math.ceil(totalBeats / this.beatsPerBar); }
}

export default function TimelineView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: graph, isLoading } = useGetProjectGraph(id);
  const { data: plan } = useGetCompletionPlan(id);
  const { selectedTrackId, setSelectedTrack, locateAtBeat, locateActionId, setLocateAtBeat } = useStudioStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("arrangement");
  const [pixelsPerBar, setPixelsPerBar] = useState(12);
  const [expandedAutoTracks, setExpandedAutoTracks] = useState<Set<string>>(new Set());

  const tsNum = (graph as any)?.timeSignatureNumerator ?? 4;
  const tsDen = (graph as any)?.timeSignatureDenominator ?? 4;
  const timeMapper = useMemo(() => new TimeMapper(tsNum, tsDen, pixelsPerBar), [tsNum, tsDen, pixelsPerBar]);

  const allMutations = useMemo(() => {
    if (!plan?.actions) return [];
    const payloads: any[] = [];
    for (const action of (plan.actions as any[])) {
      for (const mp of (action.mutationPayloads ?? [])) {
        payloads.push({ ...mp, actionId: action.id, actionTitle: action.title, priority: action.priority, category: action.category });
      }
    }
    return payloads;
  }, [plan]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPixelsPerBar((prev) => {
        const delta = e.deltaY > 0 ? -1 : 1;
        const factor = 1 + delta * 0.14;
        return Math.min(MAX_PX_PER_BAR, Math.max(MIN_PX_PER_BAR, prev * factor));
      });
    }
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    if (locateAtBeat == null || !scrollContainerRef.current) return;
    const targetX = timeMapper.beatsToPixels(locateAtBeat);
    const container = scrollContainerRef.current;
    const containerWidth = container.clientWidth;
    const scrollTo = Math.max(0, targetX - containerWidth / 4);
    container.scrollTo({ left: scrollTo, behavior: "smooth" });
    setViewMode("proposed");
    const timer = setTimeout(() => setLocateAtBeat(null), 3000);
    return () => clearTimeout(timer);
  }, [locateAtBeat, locateActionId, timeMapper, setLocateAtBeat]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-muted-foreground font-mono text-sm uppercase tracking-widest">Loading Engine...</div>;
  }

  if (!graph) return null;

  const allTracks = [...(graph.tracks ?? []), ...(graph.returnTracks ?? [])];
  const maxClipEnd = allTracks.reduce((max: number, t: any) =>
    (t.clips ?? []).reduce((m: number, c: any) => Math.max(m, c.end ?? 0), max), 0);
  const totalBeats = Math.max(graph.arrangementLength ?? 128, maxClipEnd, 64);
  const totalBars = timeMapper.totalBars(totalBeats);
  const timelineWidth = totalBars * pixelsPerBar;
  const selectedTrack = allTracks.find((t: any) => t.id === selectedTrackId) ?? null;

  const toggleAutoExpand = (trackId: string) => {
    setExpandedAutoTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const zoomIn = () => setPixelsPerBar((p) => Math.min(MAX_PX_PER_BAR, p * 1.3));
  const zoomOut = () => setPixelsPerBar((p) => Math.max(MIN_PX_PER_BAR, p / 1.3));

  const barInterval = pixelsPerBar < 6 ? 32 : pixelsPerBar < 12 ? 16 : pixelsPerBar < 24 ? 8 : pixelsPerBar < 48 ? 4 : pixelsPerBar < 96 ? 2 : 1;
  const majorInterval = barInterval * 4;

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <Toolbar viewMode={viewMode} setViewMode={setViewMode} graph={graph} plan={plan} totalBeats={totalBeats} allTracks={allTracks} zoomIn={zoomIn} zoomOut={zoomOut} />

        {viewMode === "sidechain" ? (
          <SidechainView graph={graph} />
        ) : (
          <div className="flex-1 overflow-auto bg-[#0a0b0d] relative" ref={scrollContainerRef}>
            <div className="inline-block min-w-full">
              
              {/* Ruler */}
              <div className="flex sticky top-0 z-30 bg-[#0d0e12]/90 backdrop-blur-md border-b border-border/50" style={{ height: RULER_HEIGHT }}>
                <div className="shrink-0 sticky left-0 z-40 bg-[#0d0e12] flex items-center px-4 border-r border-border" style={{ width: LABEL_WIDTH }}>
                  <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">{timeMapper.pixelsPerBar.toFixed(0)}px/bar</span>
                </div>
                <div className="relative overflow-hidden" style={{ width: timelineWidth, height: RULER_HEIGHT }}>
                  <Ruler totalBars={totalBars} timeMapper={timeMapper} barInterval={barInterval} majorInterval={majorInterval} />
                </div>
              </div>

              {/* Locators */}
              {graph.locators?.length > 0 && (
                <div className="flex sticky top-[32px] z-20 bg-background/80 backdrop-blur-sm border-b border-border/40" style={{ height: LOCATOR_HEIGHT }}>
                  <div className="shrink-0 sticky left-0 z-30 flex items-center px-4 bg-background border-r border-border" style={{ width: LABEL_WIDTH }}>
                    <span className="text-[9px] text-primary uppercase font-bold tracking-widest">Cues</span>
                  </div>
                  <div className="relative overflow-hidden" style={{ width: timelineWidth }}>
                    {graph.locators.map((loc: any, i: number) => <LocatorMarker key={i} loc={loc} timeMapper={timeMapper} />)}
                  </div>
                </div>
              )}

              {/* Sections */}
              {graph.sections?.length > 0 && (
                <div className="flex sticky top-[56px] z-20 bg-background/50 backdrop-blur-sm border-b border-border/40" style={{ height: SECTION_HEIGHT }}>
                  <div className="shrink-0 sticky left-0 z-30 flex items-center px-4 bg-background border-r border-border" style={{ width: LABEL_WIDTH }}>
                    <span className="text-[9px] text-secondary uppercase font-bold tracking-widest">Sections</span>
                  </div>
                  <div className="relative overflow-hidden" style={{ width: timelineWidth }}>
                    {graph.sections.map((section: any) => <SectionMarker key={section.id} section={section} timeMapper={timeMapper} />)}
                  </div>
                </div>
              )}

              {/* Tracks */}
              <div className="relative z-0 pt-2">
                {allTracks.map((track: any) => {
                  const hasAutoLanes = (track.automationLanes?.length ?? 0) > 0;
                  const isAutoExpanded = expandedAutoTracks.has(track.id);
                  const showAutoLanes = viewMode === "automation" || isAutoExpanded;
                  const trackColor = track.color != null ? getTrackColor(track.color) : getRoleColor(track.inferredRole);
                  const isGroup = track.type === "group";
                  const isReturn = track.type === "return";
                  const isSelected = selectedTrackId === track.id;

                  return (
                    <div key={track.id} className="mb-1">
                      <div
                        className={cn("flex cursor-pointer transition-colors relative", isSelected ? "bg-primary/5" : "hover:bg-white/[0.02]")}
                        style={{ height: TRACK_HEIGHT }}
                        onClick={() => setSelectedTrack(isSelected ? null : track.id)}
                      >
                        {/* Track Label */}
                        <div className="shrink-0 flex items-stretch sticky left-0 z-10 bg-[#0d0e12] border-r border-border/50 group" style={{ width: LABEL_WIDTH }}>
                          <div className="w-1.5 shrink-0 transition-all duration-300" style={{ backgroundColor: trackColor, opacity: track.muted ? 0.3 : 1, boxShadow: isSelected ? `0 0 15px ${trackColor}` : 'none' }} />
                          <div className="flex items-center gap-3 px-3 flex-1 min-w-0 border-y border-transparent group-hover:border-white/5 transition-colors">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground truncate tracking-wide">{isGroup ? "▾ " : ""}{track.name}</p>
                              {!isGroup && (
                                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate mt-0.5">
                                  {track.inferredRole !== "unknown" ? track.inferredRole : track.type}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {hasAutoLanes && viewMode !== "automation" && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleAutoExpand(track.id); }}
                                  className={cn("w-5 h-5 flex items-center justify-center rounded bg-background border transition-all text-[9px] font-bold", isAutoExpanded ? "border-primary text-primary shadow-[0_0_10px_rgba(139,92,246,0.3)]" : "border-border text-muted-foreground")}
                                >A</button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Canvas */}
                        <div className="relative border-b border-border/30" style={{ width: timelineWidth }}>
                          <GridLines totalBars={totalBars} timeMapper={timeMapper} barInterval={barInterval} majorInterval={majorInterval} />
                          {track.clips?.map((clip: any) => (
                            <ClipBlock key={clip.id} clip={clip} trackColor={trackColor} timeMapper={timeMapper} muted={track.muted || viewMode === "proposed"} dimmed={viewMode === "proposed"} />
                          ))}
                          {(viewMode === "proposed" || viewMode === "diff") && (
                            allMutations.filter((mp: any) => mp.targetTrackId === track.id || mp.targetTrackName === track.name || (mp.mutationType === "add_locator" && !mp.targetTrackId))
                              .map((mp: any, mpIdx: number) => (
                                <MutationOverlay key={`mp-${mpIdx}`} mutation={mp} timeMapper={timeMapper} trackHeight={TRACK_HEIGHT} />
                              ))
                          )}
                        </div>
                      </div>

                      {showAutoLanes && track.automationLanes?.map((lane: any, idx: number) => (
                        <AutomationLaneRow key={`auto-${idx}`} lane={lane} trackColor={trackColor} timeMapper={timeMapper} timelineWidth={timelineWidth} totalBars={totalBars} barInterval={barInterval} majorInterval={majorInterval} />
                      ))}
                    </div>
                  );
                })}
                <div style={{ height: 100 }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedTrack && viewMode !== "sidechain" && (
        <TrackInspector track={selectedTrack} onClose={() => setSelectedTrack(null)} />
      )}
    </div>
  );
}

const VIEW_MODE_CONFIG: Record<ViewMode, { label: string; color?: string }> = {
  arrangement: { label: "Arrangement" },
  automation: { label: "Automation" },
  sidechain: { label: "Sidechain" },
  proposed: { label: "AI Proposed", color: "#8b5cf6" },
  diff: { label: "Diff View", color: "#d946ef" },
};

function Toolbar({ viewMode, setViewMode, graph, plan, totalBeats, allTracks, zoomIn, zoomOut }: any) {
  const hasPlan = plan?.actions?.length > 0;
  return (
    <div className="flex items-center justify-between px-6 py-3 bg-[#070809] border-b border-border relative z-40 shadow-xl">
      <div className="flex items-center gap-2 p-1 bg-background/50 rounded-lg border border-border/50 backdrop-blur-md">
        {(Object.keys(VIEW_MODE_CONFIG) as ViewMode[]).map((tab) => {
          const config = VIEW_MODE_CONFIG[tab];
          const isActive = viewMode === tab;
          const isSpecial = tab === "proposed" || tab === "diff";
          return (
            <button
              key={tab}
              onClick={() => setViewMode(tab)}
              disabled={!hasPlan && isSpecial}
              className={cn(
                "relative px-4 py-1.5 text-xs font-semibold rounded-md transition-all",
                isActive ? "text-white" : "text-muted-foreground hover:text-foreground",
                !hasPlan && isSpecial && "opacity-30 cursor-not-allowed"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="timeline-tab"
                  className="absolute inset-0 bg-muted/80 border border-white/10 rounded-md -z-10"
                  style={{ boxShadow: config.color ? `0 0 15px ${config.color}30` : 'none' }}
                />
              )}
              {config.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-6">
        <div className="flex gap-4 text-[11px] font-mono text-muted-foreground uppercase tracking-widest font-semibold">
          <span className="text-foreground">{graph.tempo} BPM</span>
          <span>{graph.timeSignatureNumerator ?? 4}/{graph.timeSignatureDenominator ?? 4}</span>
          <span>{formatBars(totalBeats)}</span>
        </div>
        <div className="flex items-center gap-1 bg-background/50 rounded-lg border border-border/50 p-1">
          <button onClick={zoomOut} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">−</button>
          <button onClick={zoomIn} className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">+</button>
        </div>
      </div>
    </div>
  );
}

function Ruler({ totalBars, timeMapper, barInterval, majorInterval }: any) {
  const markers = [];
  for (let bar = 0; bar <= totalBars; bar += barInterval) {
    const isMajor = bar % majorInterval === 0 || bar === 0;
    const x = timeMapper.beatsToPixels(bar * timeMapper.beatsPerBar);
    markers.push(
      <div key={bar} className="absolute top-0 bottom-0" style={{ left: x }}>
        <div className="absolute bottom-0 w-px bg-white/20" style={{ height: isMajor ? 12 : 6 }} />
        {isMajor && timeMapper.pixelsPerBar >= 3 && (
          <span className="absolute text-[10px] font-mono font-bold text-white/60" style={{ left: 4, top: 4 }}>{bar + 1}</span>
        )}
      </div>
    );
  }
  return <>{markers}</>;
}

function GridLines({ totalBars, timeMapper, barInterval, majorInterval }: any) {
  const lines = [];
  for (let bar = 0; bar <= totalBars; bar += barInterval) {
    const isMajor = bar % majorInterval === 0;
    lines.push(
      <div key={bar} className="absolute top-0 bottom-0 w-px pointer-events-none z-0"
           style={{ left: timeMapper.beatsToPixels(bar * timeMapper.beatsPerBar), backgroundColor: isMajor ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)' }} />
    );
  }
  return <>{lines}</>;
}

function LocatorMarker({ loc, timeMapper }: any) {
  const x = timeMapper.beatsToPixels(loc.time);
  return (
    <div className="absolute top-0 bottom-0 z-10" style={{ left: x }}>
      <div className="absolute top-0 bottom-[-2000px] w-px bg-primary/40" />
      <div className="absolute top-0 left-0 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-primary" />
      <span className="absolute top-0.5 left-3 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-primary text-glow">{loc.name}</span>
    </div>
  );
}

function SectionMarker({ section, timeMapper }: any) {
  const left = timeMapper.beatsToPixels(section.startBar);
  const width = timeMapper.beatsWidth(section.endBar - section.startBar);
  return (
    <div className="absolute top-0 bottom-0 flex items-center border-l border-secondary/50" style={{ left, width: Math.max(width, 2) }}>
      <div className="absolute inset-0 bg-secondary/5" />
      <span className="absolute pl-3 font-bold uppercase tracking-widest text-[10px] text-secondary truncate">{section.label}</span>
    </div>
  );
}

function ClipBlock({ clip, trackColor, timeMapper, muted, dimmed }: any) {
  const left = timeMapper.beatsToPixels(clip.start);
  const width = Math.max(timeMapper.beatsWidth(clip.end - clip.start), 2);
  const clipColor = clip.clipColor != null ? getAbletonColor(clip.clipColor, trackColor) : trackColor;
  
  return (
    <div
      className={cn("absolute top-[4px] bottom-[4px] clip-block transition-opacity", muted ? "opacity-30" : dimmed ? "opacity-20" : "opacity-100 hover:opacity-90")}
      style={{ left, width, backgroundColor: `${clipColor}30`, borderColor: `${clipColor}80` }}
    >
      <div className="h-3 bg-black/40 flex items-center px-1 border-b border-white/10">
        {width > 20 && <span className="text-[8px] text-white/80">{clip.clipType === "midi" ? "MIDI" : "AUDIO"}</span>}
      </div>
      <div className="relative h-full">
        {clip.clipType === "midi" && clip.midiNotes?.length > 0 ? (
           <MidiNotePreview notes={clip.midiNotes} clipStart={clip.start} clipEnd={clip.end} width={width} height={TRACK_HEIGHT - 20} color={clipColor} />
        ) : clip.clipType === "audio" && (
           <AudioWavePreview width={width} height={TRACK_HEIGHT - 20} seed={clip.id} />
        )}
      </div>
    </div>
  );
}

function MidiNotePreview({ notes, clipStart, clipEnd, width, height, color }: any) {
  const clipDuration = Math.max(clipEnd - clipStart, 0.001);
  const pitches = notes.map((n:any) => n.pitch);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  const pitchRange = Math.max(maxPitch - minPitch, 12);
  const drawH = height - 4;

  return (
    <svg width={width} height={height} className="absolute inset-0">
      {notes.slice(0, 256).map((note:any, i:number) => {
        const x = ((note.time) / clipDuration) * width;
        const w = Math.max((note.duration / clipDuration) * width, 1.5);
        const y = 2 + drawH - ((note.pitch - minPitch) / pitchRange) * drawH;
        const h = Math.max(2, Math.min(4, drawH / pitchRange * 1.5));
        return <rect key={i} x={x} y={y} width={w} height={h} rx={1} fill={color} opacity={0.8} />;
      })}
    </svg>
  );
}

function AudioWavePreview({ width, height, seed }: any) {
  const seedNum = seed.split("").reduce((a:number, c:string) => a + c.charCodeAt(0), 0);
  const mid = height / 2;
  const points = Math.min(Math.floor(width / 2), 80);
  let d = `M 0 ${mid}`;
  for (let i = 0; i <= points; i++) {
    const x = (i / points) * width;
    const s = seedNum * 0.001 + i;
    const amp = (Math.sin(s * 0.9) * 0.4 + Math.sin(s * 2.3) * 0.2 + 0.5) * height * 0.4;
    d += ` L ${x} ${mid - amp}`;
  }
  for (let i = points; i >= 0; i--) {
    const x = (i / points) * width;
    const s = seedNum * 0.001 + i;
    const amp = (Math.sin(s * 0.9) * 0.4 + Math.sin(s * 2.3) * 0.2 + 0.5) * height * 0.4;
    d += ` L ${x} ${mid + amp}`;
  }
  d += " Z";
  return <svg width={width} height={height} className="absolute inset-0"><path d={d} fill="rgba(255,255,255,0.3)" /></svg>;
}

function MutationOverlay({ mutation, timeMapper }: any) {
  const start = mutation.startBeat ?? 0;
  const end = mutation.endBeat ?? (start + 16);
  const left = timeMapper.beatsToPixels(start);
  const width = Math.max(timeMapper.beatsWidth(end - start), 2);
  const isLocator = mutation.mutationType === "add_locator";

  if (isLocator) {
    return (
      <div className="absolute top-0 bottom-0 z-20" style={{ left }}>
        <div className="absolute top-0 bottom-[-200px] w-px bg-accent shadow-[0_0_10px_var(--color-accent)]" />
        <div className="absolute top-0 bg-accent text-white text-[9px] font-bold px-2 py-0.5 rounded-r uppercase tracking-widest">{mutation.locatorName || "MARK"}</div>
      </div>
    );
  }

  return (
    <div className="absolute top-[2px] bottom-[2px] rounded border-2 border-dashed border-primary bg-primary/10 z-20 overflow-hidden" style={{ left, width }}>
      <div className="bg-primary text-white text-[8px] font-bold px-1 py-0.5 inline-block uppercase">{mutation.mutationType.replace('add_','')}</div>
    </div>
  );
}

function AutomationLaneRow({ lane, trackColor, timeMapper, timelineWidth, totalBars, barInterval, majorInterval }: any) {
  const points = lane.points ?? [];
  if (points.length === 0) return null;
  const vals = points.map((p: any) => p.value);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const range = maxVal - minVal || 1;

  const svgPoints = points.map((p: any) => ({
    x: timeMapper.beatsToPixels(p.time),
    y: AUTO_LANE_HEIGHT - 6 - ((p.value - minVal) / range) * (AUTO_LANE_HEIGHT - 12)
  }));

  let pathD = "";
  svgPoints.forEach((pt: any, i: number) => { pathD += i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`; });
  let fillD = pathD;
  if (svgPoints.length > 0) fillD += ` L ${svgPoints[svgPoints.length - 1].x} ${AUTO_LANE_HEIGHT} L ${svgPoints[0].x} ${AUTO_LANE_HEIGHT} Z`;

  return (
    <div className="flex h-12 border-b border-border/30 bg-background/30">
      <div className="shrink-0 flex items-center px-4 gap-2 sticky left-0 z-10 bg-[#0d0e12] border-r border-border/50" style={{ width: LABEL_WIDTH }}>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-mono text-muted-foreground uppercase truncate block">{lane.parameterName}</span>
        </div>
      </div>
      <div className="relative" style={{ width: timelineWidth }}>
        <GridLines totalBars={totalBars} timeMapper={timeMapper} barInterval={barInterval} majorInterval={majorInterval} />
        <svg width={timelineWidth} height={AUTO_LANE_HEIGHT} className="absolute inset-0 z-10">
          <path d={fillD} fill={trackColor} opacity={0.15} />
          <path d={pathD} fill="none" stroke={trackColor} strokeWidth={2} />
          {svgPoints.map((pt: any, i: number) => <circle key={i} cx={pt.x} cy={pt.y} r={3} fill="#fff" stroke={trackColor} strokeWidth={1} />)}
        </svg>
      </div>
    </div>
  );
}

function SidechainView({ graph }: any) {
  const links = graph.sidechainLinks ?? [];
  return (
    <div className="p-8">
      <h2 className="text-xl font-display font-bold mb-6">Sidechain Routing Graph</h2>
      {links.length === 0 ? (
        <div className="glass-panel p-8 rounded-2xl text-center text-muted-foreground">No dynamic routing detected.</div>
      ) : (
        <div className="space-y-4 max-w-4xl">
          {links.map((link:any, i:number) => (
            <div key={i} className="glass-panel p-4 rounded-xl flex items-center gap-6">
              <div className="flex-1 text-right font-display font-bold text-lg">{link.sourceTrackName}</div>
              <div className="shrink-0 px-4 py-1 rounded-full bg-primary/20 text-primary border border-primary/30 text-xs font-mono font-bold uppercase tracking-widest">Controls</div>
              <div className="flex-1 font-display font-bold text-lg text-muted-foreground">{link.targetTrackName}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrackInspector({ track, onClose }: any) {
  const trackColor = track.color != null ? getTrackColor(track.color) : getRoleColor(track.inferredRole);
  return (
    <motion.div 
      initial={{ x: 300, opacity: 0 }} 
      animate={{ x: 0, opacity: 1 }} 
      className="w-80 bg-sidebar/90 backdrop-blur-xl border-l border-sidebar-border shadow-2xl flex flex-col z-50 absolute right-0 top-[57px] bottom-0"
    >
      <div className="p-6 border-b border-border/50 flex justify-between items-center bg-background/50">
        <h3 className="font-display font-bold text-lg truncate flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: trackColor, boxShadow: `0 0 10px ${trackColor}` }}/>
          {track.name}
        </h3>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-white/10 transition-colors">×</button>
      </div>
      <div className="p-6 space-y-6 overflow-y-auto">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 block">Inferred Role</label>
          <div className="bg-muted/50 p-3 rounded-lg border border-border/50 font-mono text-sm uppercase font-bold text-primary">
            {track.inferredRole} <span className="text-muted-foreground ml-2">{Math.round(track.inferredConfidence*100)}% Match</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 p-4 rounded-xl border border-border/30 text-center">
            <div className="text-2xl font-display font-bold">{track.clipCount}</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Clips</div>
          </div>
          <div className="bg-muted/30 p-4 rounded-xl border border-border/30 text-center">
            <div className="text-2xl font-display font-bold">{track.deviceCount}</div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Devices</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
