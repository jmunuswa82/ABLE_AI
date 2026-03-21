import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams } from "wouter";
import { useGetProjectGraph, useGetCompletionPlan } from "@workspace/api-client-react";
import { getRoleColor, getTrackColor, getAbletonColor, formatBars, cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

type ViewMode = "arrangement" | "automation" | "sidechain" | "proposed" | "diff";

const TRACK_HEIGHT = 52;
const AUTO_LANE_HEIGHT = 44;
const LABEL_WIDTH = 196;
const RULER_HEIGHT = 28;
const LOCATOR_HEIGHT = 20;
const SECTION_HEIGHT = 20;
const MIN_PX_PER_BAR = 1.5;
const MAX_PX_PER_BAR = 96;

// ─── TimeMapper ─────────────────────────────────────────────────────────────────
// Converts beats to pixels using the project's actual time signature.
// beatsPerBar = timeSignatureNumerator (beats per bar, e.g. 3 for 3/4, 6 for 6/8)
// beatDuration = 4 / timeSignatureDenominator (relative to quarter note)
// pixelsPerBar = pixelsPerBar prop (controlled by zoom)
// beatsToPixels(beat) = (beat / beatsPerBar) * pixelsPerBar

class TimeMapper {
  readonly beatsPerBar: number;
  readonly pixelsPerBar: number;

  constructor(numerator: number, denominator: number, pixelsPerBar: number) {
    // Ableton stores time in quarter-note beats regardless of time signature.
    // One bar in quarter-note beats = numerator * (4 / denominator)
    this.beatsPerBar = numerator * (4 / denominator);
    this.pixelsPerBar = pixelsPerBar;
  }

  /** Convert a beat position (quarter notes) to a pixel offset. */
  beatsToPixels(beat: number): number {
    return (beat / this.beatsPerBar) * this.pixelsPerBar;
  }

  /** Convert a pixel offset back to beats. */
  pixelsToBeats(px: number): number {
    return (px / this.pixelsPerBar) * this.beatsPerBar;
  }

  /** Total pixel width for a given number of beats. */
  beatsWidth(beats: number): number {
    return (beats / this.beatsPerBar) * this.pixelsPerBar;
  }

  /** Number of bars for totalBeats. */
  totalBars(totalBeats: number): number {
    return Math.ceil(totalBeats / this.beatsPerBar);
  }

  /** Debug label showing conversion details. */
  debugLabel(beat: number): string {
    const px = this.beatsToPixels(beat);
    return `beat ${beat.toFixed(1)} → ${px.toFixed(1)}px (${this.beatsPerBar}qn/bar, ${this.pixelsPerBar.toFixed(1)}px/bar)`;
  }
}

export default function TimelineView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: graph, isLoading } = useGetProjectGraph(id);
  const { data: plan } = useGetCompletionPlan(id);
  const { selectedTrackId, setSelectedTrack, locateAtBeat, locateActionId, setLocateAtBeat } = useStudioStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("arrangement");
  const [pixelsPerBar, setPixelsPerBar] = useState(10);
  const [expandedAutoTracks, setExpandedAutoTracks] = useState<Set<string>>(new Set());

  // Build TimeMapper early (uses graph's time signature or 4/4 default)
  const tsNum = (graph as any)?.timeSignatureNumerator ?? 4;
  const tsDen = (graph as any)?.timeSignatureDenominator ?? 4;
  const timeMapper = useMemo(
    () => new TimeMapper(tsNum, tsDen, pixelsPerBar),
    [tsNum, tsDen, pixelsPerBar]
  );

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

  // Scroll to locateAtBeat when set from CompletionPlanView
  useEffect(() => {
    if (locateAtBeat == null || !scrollContainerRef.current) return;
    const targetX = timeMapper.beatsToPixels(locateAtBeat);
    const container = scrollContainerRef.current;
    const containerWidth = container.clientWidth;
    const scrollTo = Math.max(0, targetX - containerWidth / 4);
    container.scrollTo({ left: scrollTo, behavior: "smooth" });
    // Switch to proposed view to show what's being located
    setViewMode("proposed");
    // Clear after a delay
    const timer = setTimeout(() => setLocateAtBeat(null), 3000);
    return () => clearTimeout(timer);
  }, [locateAtBeat, locateActionId, timeMapper]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#888] text-sm">Loading timeline...</div>
      </div>
    );
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
  const totalBars = timeMapper.totalBars(totalBeats);
  const timelineWidth = totalBars * pixelsPerBar;
  const selectedTrack = allTracks.find((t: any) => t.id === selectedTrackId) ?? null;

  // Collect all mutation payloads from the completion plan
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

  // Compute bar interval for ruler/grid — pixelsPerBar is already per-bar in TimeMapper
  const barInterval = pixelsPerBar < 6 ? 32 : pixelsPerBar < 12 ? 16 : pixelsPerBar < 24 ? 8 : pixelsPerBar < 48 ? 4 : pixelsPerBar < 96 ? 2 : 1;
  const majorInterval = barInterval * 4;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <Toolbar
          viewMode={viewMode}
          setViewMode={setViewMode}
          graph={graph}
          plan={plan}
          totalBeats={totalBeats}
          allTracks={allTracks}
          zoomIn={zoomIn}
          zoomOut={zoomOut}
        />

        {viewMode === "sidechain" ? (
          <SidechainView graph={graph} />
        ) : (
          <div className="flex-1 overflow-auto" ref={scrollContainerRef}>
            <div className="inline-block min-w-full">

              {/* Ruler */}
              <div className="flex sticky top-0 z-20 bg-[#1d1d1d]" style={{ height: RULER_HEIGHT, borderBottom: "1px solid #2a2a2a" }}>
                <div
                  className="shrink-0 sticky left-0 z-30 bg-[#222] flex items-end pb-1"
                  style={{ width: LABEL_WIDTH, borderRight: "1px solid #2a2a2a" }}
                >
                  <span className="text-[9px] text-[#555] px-2 font-mono">{timeMapper.pixelsPerBar.toFixed(0)}px/bar · {tsNum}/{tsDen}</span>
                </div>
                <div className="relative overflow-hidden" style={{ width: timelineWidth, height: RULER_HEIGHT }}>
                  <Ruler totalBars={totalBars} timeMapper={timeMapper} barInterval={barInterval} majorInterval={majorInterval} />
                </div>
              </div>

              {/* Locators */}
              {graph.locators?.length > 0 && (
                <div className="flex sticky top-[28px] z-10" style={{ height: LOCATOR_HEIGHT, background: "#191919", borderBottom: "1px solid #262626" }}>
                  <div
                    className="shrink-0 sticky left-0 z-20 flex items-center px-2"
                    style={{ width: LABEL_WIDTH, height: LOCATOR_HEIGHT, background: "#1d1d1d", borderRight: "1px solid #2a2a2a" }}
                  >
                    <span className="text-[8px] text-[#555] uppercase tracking-wider">Cues</span>
                  </div>
                  <div className="relative overflow-hidden" style={{ width: timelineWidth, height: LOCATOR_HEIGHT }}>
                    {graph.locators.map((loc: any, i: number) => (
                      <LocatorMarker key={i} loc={loc} timeMapper={timeMapper} />
                    ))}
                  </div>
                </div>
              )}

              {/* Section markers */}
              {graph.sections?.length > 0 && (
                <div className="flex" style={{ height: SECTION_HEIGHT, background: "#1a1a1a", borderBottom: "1px solid #262626" }}>
                  <div
                    className="shrink-0 sticky left-0 z-20 flex items-center px-2"
                    style={{ width: LABEL_WIDTH, height: SECTION_HEIGHT, background: "#1d1d1d", borderRight: "1px solid #2a2a2a" }}
                  >
                    <span className="text-[8px] text-[#555] uppercase tracking-wider">Sections</span>
                  </div>
                  <div className="relative overflow-hidden" style={{ width: timelineWidth, height: SECTION_HEIGHT }}>
                    {graph.sections.map((section: any) => (
                      <SectionMarker key={section.id} section={section} timeMapper={timeMapper} totalBeats={totalBeats} />
                    ))}
                  </div>
                </div>
              )}

              {/* Tracks */}
              {allTracks.map((track: any, trackIdx: number) => {
                const hasAutoLanes = (track.automationLanes?.length ?? 0) > 0;
                const isAutoExpanded = expandedAutoTracks.has(track.id);
                const showAutoLanes = viewMode === "automation" || isAutoExpanded;
                const trackColor = track.color != null ? getTrackColor(track.color) : getRoleColor(track.inferredRole);
                const isGroup = track.type === "group";
                const isReturn = track.type === "return";
                const isSelected = selectedTrackId === track.id;
                const isEven = trackIdx % 2 === 0;

                return (
                  <div key={track.id}>
                    <div
                      className={cn("flex cursor-pointer group")}
                      style={{
                        height: TRACK_HEIGHT,
                        borderBottom: "1px solid #252525",
                        backgroundColor: isSelected ? "#242430" : isGroup ? "#1f1f1f" : isEven ? "#1c1c1c" : "#1a1a1a",
                      }}
                      onClick={() => setSelectedTrack(isSelected ? null : track.id)}
                    >
                      {/* Track label column */}
                      <div
                        className="shrink-0 flex items-center gap-0 sticky left-0 z-10"
                        style={{
                          width: LABEL_WIDTH,
                          height: TRACK_HEIGHT,
                          background: isSelected ? "#242430" : isGroup ? "#222" : isEven ? "#1f1f1f" : "#1d1d1d",
                          borderRight: "1px solid #2a2a2a",
                        }}
                      >
                        {/* Ableton-style color strip on left */}
                        <div
                          className="shrink-0 h-full"
                          style={{
                            width: 3,
                            backgroundColor: trackColor,
                            opacity: track.muted ? 0.3 : isGroup ? 0.7 : 1,
                          }}
                        />
                        <div className="flex items-center gap-1.5 px-2 flex-1 min-w-0">
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-[11px] font-medium truncate"
                              style={{ color: track.muted ? "#555" : isGroup ? "#bbb" : "#ccc" }}
                            >
                              {isGroup ? "▾ " : ""}{track.name}
                            </p>
                            {!isGroup && (
                              <p className="text-[9px] truncate" style={{ color: "#555" }}>
                                {track.inferredRole !== "unknown" ? track.inferredRole : track.type}
                                {track.clipCount > 0 ? ` · ${track.clipCount}cl` : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {track.muted && <span className="text-[8px] text-yellow-600 font-bold">M</span>}
                            {track.solo && <span className="text-[8px] text-blue-400 font-bold">S</span>}
                            {isReturn && <span className="text-[8px] text-[#666]">R</span>}
                            {hasAutoLanes && viewMode !== "automation" && (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleAutoExpand(track.id); }}
                                className={cn(
                                  "w-3.5 h-3.5 flex items-center justify-center rounded-sm text-[7px] font-bold",
                                  isAutoExpanded ? "bg-primary/30 text-primary" : "text-[#444] hover:text-[#999]"
                                )}
                                title="Toggle automation lanes"
                              >
                                A
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Clip canvas area */}
                      <div className="relative" style={{ width: timelineWidth, height: TRACK_HEIGHT }}>
                        {/* Vertical grid lines */}
                        <GridLines totalBars={totalBars} timeMapper={timeMapper} barInterval={barInterval} majorInterval={majorInterval} />
                        {/* Clips — dimmed in proposed mode */}
                        {track.clips?.map((clip: any) => (
                          <ClipBlock
                            key={clip.id}
                            clip={clip}
                            trackColor={trackColor}
                            timeMapper={timeMapper}
                            muted={track.muted || viewMode === "proposed"}
                            dimmed={viewMode === "proposed"}
                          />
                        ))}
                        {/* Proposed mutation overlays */}
                        {(viewMode === "proposed" || viewMode === "diff") && (
                          <>
                            {allMutations
                              .filter((mp: any) =>
                                mp.targetTrackId === track.id ||
                                mp.targetTrackName === track.name ||
                                (mp.mutationType === "add_locator" && !mp.targetTrackId)
                              )
                              .map((mp: any, mpIdx: number) => (
                                <MutationOverlay
                                  key={`mp-${mpIdx}`}
                                  mutation={mp}
                                  timeMapper={timeMapper}
                                  trackHeight={TRACK_HEIGHT}
                                  isDiff={viewMode === "diff"}
                                />
                              ))}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Automation lanes */}
                    {showAutoLanes && track.automationLanes?.map((lane: any, idx: number) => (
                      <AutomationLaneRow
                        key={`${track.id}-auto-${idx}`}
                        lane={lane}
                        trackColor={trackColor}
                        timeMapper={timeMapper}
                        timelineWidth={timelineWidth}
                        totalBars={totalBars}
                        barInterval={barInterval}
                        majorInterval={majorInterval}
                      />
                    ))}
                  </div>
                );
              })}

              {/* Bottom padding */}
              <div style={{ height: 40 }} />
            </div>
          </div>
        )}
      </div>

      {/* Track Inspector panel */}
      {selectedTrack && viewMode !== "sidechain" && (
        <TrackInspector track={selectedTrack} onClose={() => setSelectedTrack(null)} />
      )}
    </div>
  );
}

// ─── Toolbar ───────────────────────────────────────────────────────────────────

const VIEW_MODE_CONFIG: Record<ViewMode, { label: string; title: string; color?: string }> = {
  arrangement: { label: "Arrangement", title: "Show clips in arrangement" },
  automation: { label: "Automation", title: "Show automation lanes" },
  sidechain: { label: "Sidechain", title: "Show sidechain routing" },
  proposed: { label: "AI Proposed", title: "Show AI-proposed additions overlaid on arrangement", color: "#22c55e" },
  diff: { label: "Diff", title: "Show difference between original and AI proposal", color: "#f59e0b" },
};

function Toolbar({
  viewMode, setViewMode, graph, plan, totalBeats, allTracks, zoomIn, zoomOut,
}: {
  viewMode: ViewMode; setViewMode: (m: ViewMode) => void;
  graph: any; plan: any; totalBeats: number; allTracks: any[];
  zoomIn: () => void; zoomOut: () => void;
}) {
  const totalClips = allTracks.reduce((s: number, t: any) => s + (t.clips?.length ?? 0), 0);
  const hasPlan = plan?.actions?.length > 0;
  const mutationCount = hasPlan
    ? (plan.actions as any[]).reduce((s: number, a: any) => s + (a.mutationPayloads?.length ?? 0), 0)
    : 0;

  return (
    <div className="flex items-center gap-1 px-3 py-1 shrink-0" style={{ borderBottom: "1px solid #2a2a2a", background: "#222" }}>
      <div className="flex items-center gap-0.5 bg-[#2a2a2a] rounded p-0.5 mr-2">
        {(Object.keys(VIEW_MODE_CONFIG) as ViewMode[]).map((tab) => {
          const config = VIEW_MODE_CONFIG[tab];
          const isActive = viewMode === tab;
          const isSpecial = tab === "proposed" || tab === "diff";
          return (
            <button
              key={tab}
              onClick={() => setViewMode(tab)}
              title={config.title}
              className={cn(
                "px-2 py-1 text-[10px] rounded font-medium transition-colors",
                isActive
                  ? isSpecial
                    ? "text-white"
                    : "bg-[#484848] text-white"
                  : "text-[#666] hover:text-[#aaa]",
                !hasPlan && isSpecial && "opacity-40 cursor-not-allowed",
              )}
              style={isActive && config.color ? { backgroundColor: config.color + "40", color: config.color } : {}}
              disabled={!hasPlan && isSpecial}
            >
              {config.label}
              {isSpecial && hasPlan && !isActive && (
                <span className="ml-0.5 text-[8px]" style={{ color: config.color }}>●</span>
              )}
            </button>
          );
        })}
      </div>

      {(viewMode === "proposed" || viewMode === "diff") && (
        <div className="px-2 py-0.5 rounded text-[9px] mr-2" style={{ background: "#1a2a1a", border: "1px solid #22c55e40", color: "#22c55e" }}>
          {mutationCount} mutation{mutationCount !== 1 ? "s" : ""}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-[#777] font-mono mr-auto">
        <span className="text-[#bbb] font-semibold">{graph.tempo} BPM</span>
        <span>{graph.timeSignatureNumerator ?? 4}/{graph.timeSignatureDenominator ?? 4}</span>
        <span>{formatBars(totalBeats)}</span>
        <span>{allTracks.length} tracks</span>
        <span>{totalClips} clips</span>
      </div>

      <div className="flex items-center gap-0.5">
        <button
          onClick={zoomOut}
          className="w-6 h-6 flex items-center justify-center rounded text-sm text-[#777] hover:bg-[#333] hover:text-white"
          title="Zoom out (Ctrl+scroll)"
        >−</button>
        <button
          onClick={zoomIn}
          className="w-6 h-6 flex items-center justify-center rounded text-sm text-[#777] hover:bg-[#333] hover:text-white"
          title="Zoom in (Ctrl+scroll)"
        >+</button>
      </div>
    </div>
  );
}

// ─── Ruler ─────────────────────────────────────────────────────────────────────

function Ruler({ totalBars, timeMapper, barInterval, majorInterval }: {
  totalBars: number; timeMapper: TimeMapper; barInterval: number; majorInterval: number;
}) {
  const markers = [];
  for (let bar = 0; bar <= totalBars; bar += barInterval) {
    const isMajor = bar % majorInterval === 0 || bar === 0;
    // bar index → beats = bar * beatsPerBar → pixels
    const x = timeMapper.beatsToPixels(bar * timeMapper.beatsPerBar);
    markers.push(
      <div key={bar} className="absolute top-0 bottom-0" style={{ left: x }}>
        <div
          className="absolute top-0"
          style={{
            width: 1,
            height: isMajor ? 10 : 6,
            background: isMajor ? "#555" : "#3a3a3a",
          }}
        />
        {isMajor && timeMapper.pixelsPerBar >= 3 && (
          <span
            className="absolute text-[9px] font-mono whitespace-nowrap"
            style={{ left: 3, bottom: 4, color: "#777" }}
          >
            {bar + 1}
          </span>
        )}
        {!isMajor && timeMapper.pixelsPerBar >= 24 && (
          <span
            className="absolute text-[8px] font-mono whitespace-nowrap"
            style={{ left: 3, bottom: 4, color: "#555" }}
          >
            {bar + 1}
          </span>
        )}
      </div>
    );
  }
  return <>{markers}</>;
}

// ─── Grid lines ────────────────────────────────────────────────────────────────

function GridLines({ totalBars, timeMapper, barInterval, majorInterval }: {
  totalBars: number; timeMapper: TimeMapper; barInterval: number; majorInterval: number;
}) {
  const lines = [];
  for (let bar = 0; bar <= totalBars; bar += barInterval) {
    const isMajor = bar % majorInterval === 0;
    lines.push(
      <div
        key={bar}
        className="absolute top-0 bottom-0"
        style={{
          left: timeMapper.beatsToPixels(bar * timeMapper.beatsPerBar),
          width: 1,
          backgroundColor: isMajor ? "#2a2a2a" : "#222",
        }}
      />
    );
  }
  return <>{lines}</>;
}

// ─── Locator marker ────────────────────────────────────────────────────────────

function LocatorMarker({ loc, timeMapper }: { loc: any; timeMapper: TimeMapper }) {
  const x = timeMapper.beatsToPixels(loc.time);
  return (
    <div className="absolute top-0 bottom-0" style={{ left: x }}>
      {/* Vertical line */}
      <div className="absolute top-0 bottom-0" style={{ width: 1, backgroundColor: "#E8820066" }} />
      {/* Triangle pointer */}
      <div
        className="absolute"
        style={{
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "7px solid #E88200",
        }}
      />
      {timeMapper.pixelsPerBar >= 3 && (
        <span
          className="absolute top-0 whitespace-nowrap font-medium"
          style={{ left: 8, top: 2, fontSize: 9, color: "#E88200", letterSpacing: "0.03em" }}
        >
          {loc.name}
        </span>
      )}
    </div>
  );
}

// ─── Section marker ────────────────────────────────────────────────────────────

function SectionMarker({ section, timeMapper, totalBeats }: {
  section: any; timeMapper: TimeMapper; totalBeats: number;
}) {
  // section.startBar/endBar are in beats (Ableton quarter-note time)
  const left = timeMapper.beatsToPixels(section.startBar);
  const width = timeMapper.beatsWidth(section.endBar - section.startBar);

  const colors: Record<string, string> = {
    intro: "#3355CC", buildup: "#8833CC", "build up": "#8833CC",
    drop: "#CC3333", breakdown: "#CC8833", break: "#CC8833",
    outro: "#336655", bridge: "#336699",
  };
  const labelLower = section.label.toLowerCase();
  const sectionColor = Object.entries(colors).find(([k]) => labelLower.includes(k))?.[1] ?? "#555";

  return (
    <div
      className="absolute top-0 bottom-0 flex items-center"
      style={{ left, width: Math.max(width, 2) }}
    >
      <div className="absolute top-0 bottom-0 left-0" style={{ width: 1, backgroundColor: sectionColor, opacity: 0.9 }} />
      <div
        className="absolute top-0 left-0"
        style={{
          width: 0, height: 0,
          borderLeft: "4px solid transparent",
          borderRight: "4px solid transparent",
          borderTop: `6px solid ${sectionColor}`,
        }}
      />
      {timeMapper.pixelsPerBar >= 2.5 && width > 30 && (
        <span
          className="absolute pl-2 font-medium uppercase truncate"
          style={{ left: 0, top: 4, fontSize: 9, color: sectionColor, letterSpacing: "0.06em", maxWidth: width - 4 }}
        >
          {section.label}
        </span>
      )}
      {/* Fill with subtle tint */}
      <div
        className="absolute top-0 bottom-0 left-0 right-0"
        style={{ backgroundColor: sectionColor, opacity: 0.04, pointerEvents: "none" }}
      />
    </div>
  );
}

// ─── Clip block ────────────────────────────────────────────────────────────────

function ClipBlock({ clip, trackColor, timeMapper, muted, dimmed }: {
  clip: any; trackColor: string; timeMapper: TimeMapper; muted: boolean; dimmed?: boolean;
}) {
  const left = timeMapper.beatsToPixels(clip.start);
  const width = Math.max(timeMapper.beatsWidth(clip.end - clip.start), 2);
  const isMidi = clip.clipType === "midi";

  const clipColor = clip.clipColor != null ? getAbletonColor(clip.clipColor, trackColor) : trackColor;
  const opacity = muted ? 0.3 : dimmed ? 0.2 : 1;

  const startBar = Math.round(clip.start / timeMapper.beatsPerBar) + 1;
  const endBar = Math.round(clip.end / timeMapper.beatsPerBar);
  const durationBars = ((clip.end - clip.start) / timeMapper.beatsPerBar).toFixed(1);

  return (
    <div
      className="absolute top-[3px] overflow-hidden"
      style={{
        left,
        width,
        bottom: 3,
        opacity,
        backgroundColor: clipColor,
        borderRadius: 2,
        borderLeft: `2px solid ${clipColor}EE`,
      }}
      title={`${isMidi ? "MIDI" : "Audio"} · bars ${startBar}–${endBar} · ${durationBars}b${clip.midiNoteCount ? ` · ${clip.midiNoteCount} notes` : ""}`}
    >
      {/* Dark header strip */}
      <div
        className="flex items-center px-0.5 overflow-hidden shrink-0"
        style={{ height: 11, backgroundColor: "rgba(0,0,0,0.35)" }}
      >
        {width > 14 && (
          <span className="text-[7px] font-medium text-white/70 truncate leading-none">
            {isMidi ? "♩" : "◆"}
          </span>
        )}
      </div>

      {/* MIDI note preview or waveform */}
      {width > 6 && (
        <div className="relative" style={{ height: TRACK_HEIGHT - 17 }}>
          {isMidi && clip.midiNotes?.length > 0 ? (
            <MidiNotePreview notes={clip.midiNotes} clipStart={clip.start} clipEnd={clip.end} width={width} height={TRACK_HEIGHT - 17} color={clipColor} />
          ) : isMidi && clip.midiNoteCount > 0 ? (
            <MidiFallbackPreview noteCount={clip.midiNoteCount} width={width} height={TRACK_HEIGHT - 17} />
          ) : !isMidi ? (
            <AudioWavePreview width={width} height={TRACK_HEIGHT - 17} seed={clip.id} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── MIDI note preview — uses actual pitch data ────────────────────────────────

function MidiNotePreview({ notes, clipStart, clipEnd, width, height, color }: {
  notes: Array<{ pitch: number; time: number; duration: number; velocity: number }>;
  clipStart: number; clipEnd: number; width: number; height: number; color: string;
}) {
  const clipDuration = Math.max(clipEnd - clipStart, 0.001);
  const pitches = notes.map((n) => n.pitch);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  const pitchRange = Math.max(maxPitch - minPitch, 12);
  const padding = 2;
  const drawH = height - padding * 2;

  return (
    <svg width={width} height={height} className="absolute inset-0">
      {notes.slice(0, 256).map((note, i) => {
        const x = ((note.time) / clipDuration) * width;
        const w = Math.max((note.duration / clipDuration) * width, 1.5);
        const y = padding + drawH - ((note.pitch - minPitch) / pitchRange) * drawH;
        const h = Math.max(2, Math.min(4, drawH / pitchRange * 1.5));
        const alpha = 0.55 + (note.velocity / 127) * 0.45;
        return (
          <rect key={i} x={x} y={y} width={w} height={h} rx={0.5}
            fill="rgba(0,0,0,0.6)" opacity={alpha} />
        );
      })}
    </svg>
  );
}

function MidiFallbackPreview({ noteCount, width, height }: {
  noteCount: number; width: number; height: number;
}) {
  const rects = [];
  const count = Math.min(noteCount, Math.floor(width / 2.5));
  for (let i = 0; i < count; i++) {
    const x = (i / Math.max(count - 1, 1)) * (width - 2);
    const seed = i * 2.3 + 0.7;
    const y = (Math.sin(seed * 1.3) * 0.35 + 0.5) * height * 0.7 + height * 0.1;
    rects.push(
      <rect key={i} x={x} y={y} width={Math.max(width / count - 1, 1)} height={2.5}
        fill="rgba(0,0,0,0.5)" rx={0.5} />
    );
  }
  return (
    <svg width={width} height={height} className="absolute inset-0">
      {rects}
    </svg>
  );
}

// ─── Mutation overlay ─────────────────────────────────────────────────────────

const MUTATION_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  add_clip:          { bg: "#22c55e20", border: "#22c55e", label: "＋ Clip" },
  add_automation:    { bg: "#3b82f620", border: "#3b82f6", label: "≋ Auto" },
  add_locator:       { bg: "#f59e0b20", border: "#f59e0b", label: "▾ Mark" },
  add_sidechain_proposal: { bg: "#a855f720", border: "#a855f7", label: "⊃ SC" },
  extend_clip:       { bg: "#06b6d420", border: "#06b6d4", label: "→ Ext" },
};

function MutationOverlay({ mutation, timeMapper, trackHeight, isDiff }: {
  mutation: any; timeMapper: TimeMapper; trackHeight: number; isDiff: boolean;
}) {
  const start = mutation.startBeat ?? 0;
  const end = mutation.endBeat ?? (start + 16);
  const left = timeMapper.beatsToPixels(start);
  const width = Math.max(timeMapper.beatsWidth(end - start), 2);

  const config = MUTATION_COLORS[mutation.mutationType] ?? MUTATION_COLORS.add_clip;

  if (mutation.mutationType === "add_locator") {
    return (
      <div
        className="absolute top-0 bottom-0 flex flex-col items-start"
        style={{ left, zIndex: 5 }}
        title={`${config.label}: ${mutation.locatorName || mutation.actionTitle}`}
      >
        <div className="absolute top-0 bottom-0" style={{ width: 2, backgroundColor: config.border, opacity: 0.9 }} />
        <div
          className="absolute top-0 px-1 py-0.5 rounded-r text-[7px] font-medium whitespace-nowrap"
          style={{ background: config.border + "dd", color: "white", left: 2 }}
        >
          {mutation.locatorName || config.label}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute top-[3px] overflow-hidden"
      style={{
        left,
        width,
        bottom: 3,
        backgroundColor: config.bg,
        border: `1px dashed ${config.border}`,
        borderRadius: 2,
        zIndex: 5,
      }}
      title={`${config.label}: ${mutation.actionTitle} — bars ${Math.round(start/timeMapper.beatsPerBar)+1}–${Math.round(end/timeMapper.beatsPerBar)}`}
    >
      {width > 20 && (
        <div
          className="flex items-center px-1 gap-1"
          style={{ height: 14, backgroundColor: config.border + "40" }}
        >
          <span className="text-[7px] font-bold" style={{ color: config.border }}>{config.label}</span>
          {width > 50 && (
            <span className="text-[7px] truncate" style={{ color: config.border + "cc" }}>
              {mutation.automationParameter || mutation.actionTitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function AudioWavePreview({ width, height, seed }: { width: number; height: number; seed: string }) {
  const h = Math.min(width, 80);
  const seedNum = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const mid = height / 2;
  const points = Math.min(Math.floor(width / 2), 80);
  let d = `M 0 ${mid}`;
  for (let i = 0; i <= points; i++) {
    const x = (i / points) * width;
    const s = seedNum * 0.001 + i;
    const amp = (Math.sin(s * 0.9) * 0.4 + Math.sin(s * 2.3) * 0.2 + Math.sin(s * 0.15) * 0.25 + 0.5) * height * 0.38;
    d += ` L ${x} ${mid - amp}`;
  }
  for (let i = points; i >= 0; i--) {
    const x = (i / points) * width;
    const s = seedNum * 0.001 + i;
    const amp = (Math.sin(s * 0.9) * 0.4 + Math.sin(s * 2.3) * 0.2 + Math.sin(s * 0.15) * 0.25 + 0.5) * height * 0.34;
    d += ` L ${x} ${mid + amp}`;
  }
  d += " Z";
  return (
    <svg width={width} height={height} className="absolute inset-0">
      <path d={d} fill="rgba(0,0,0,0.4)" />
    </svg>
  );
}

// ─── Automation lane ───────────────────────────────────────────────────────────

function AutomationLaneRow({ lane, trackColor, timeMapper, timelineWidth, totalBars, barInterval, majorInterval }: {
  lane: any; trackColor: string; timeMapper: TimeMapper; timelineWidth: number; totalBars: number;
  barInterval: number; majorInterval: number;
}) {
  const points = lane.points ?? [];
  if (points.length === 0) return null;

  const vals = points.map((p: any) => p.value);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const range = maxVal - minVal || 1;

  // Build SVG path — linear segments matching Ableton's step/linear interpolation
  const svgPoints = points.map((p: any) => {
    const x = timeMapper.beatsToPixels(p.time);
    const y = AUTO_LANE_HEIGHT - 6 - ((p.value - minVal) / range) * (AUTO_LANE_HEIGHT - 12);
    return { x, y };
  });

  let pathD = "";
  svgPoints.forEach((pt: any, i: number) => {
    pathD += i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`;
  });

  // Fill area under curve
  let fillD = pathD;
  if (svgPoints.length > 0) {
    fillD += ` L ${svgPoints[svgPoints.length - 1].x} ${AUTO_LANE_HEIGHT} L ${svgPoints[0].x} ${AUTO_LANE_HEIGHT} Z`;
  }

  return (
    <div className="flex" style={{ height: AUTO_LANE_HEIGHT, borderBottom: "1px solid #1e1e1e" }}>
      <div
        className="shrink-0 flex items-center px-2 gap-1 sticky left-0 z-10"
        style={{ width: LABEL_WIDTH, height: AUTO_LANE_HEIGHT, background: "#181818", borderRight: "1px solid #2a2a2a" }}
      >
        <div className="shrink-0" style={{ width: 3, height: 16, backgroundColor: trackColor, opacity: 0.7, borderRadius: 1 }} />
        <div className="min-w-0 flex-1">
          <span className="text-[8px] truncate block" style={{ color: "#777" }}>{lane.parameterName}</span>
          <span className="text-[7px] block" style={{ color: "#555" }}>{lane.shapeSummary}</span>
        </div>
        <span className="text-[7px] shrink-0 font-mono" style={{ color: "#555" }}>{points.length}pt</span>
      </div>
      <div className="relative overflow-hidden" style={{ width: timelineWidth, height: AUTO_LANE_HEIGHT, background: "#141414" }}>
        <GridLines totalBars={totalBars} timeMapper={timeMapper} barInterval={barInterval} majorInterval={majorInterval} />
        <svg width={timelineWidth} height={AUTO_LANE_HEIGHT} className="absolute inset-0">
          {/* Area fill */}
          <path d={fillD} fill={trackColor} opacity={0.08} />
          {/* Line */}
          <path d={pathD} fill="none" stroke={trackColor} strokeWidth={1.5} strokeOpacity={0.85} />
          {/* Points */}
          {svgPoints.map((pt: any, i: number) => (
            <circle key={i} cx={pt.x} cy={pt.y} r={2.5} fill={trackColor} opacity={0.9} />
          ))}
        </svg>
        {/* Value labels at extremes */}
        {svgPoints.length > 0 && (
          <>
            <span className="absolute text-[7px] font-mono" style={{ right: 3, top: 2, color: "#555" }}>
              {maxVal.toFixed(2)}
            </span>
            <span className="absolute text-[7px] font-mono" style={{ right: 3, bottom: 2, color: "#555" }}>
              {minVal.toFixed(2)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sidechain view ────────────────────────────────────────────────────────────

const DETECTION_METHOD_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  DETECTED:    { label: "Detected",    color: "#22c55e", description: "Confirmed via XML routing or SidechainInput element" },
  INFERRED:    { label: "Inferred",    color: "#f59e0b", description: "Heuristic: compressor on bass/synth near kick" },
  AI_PROPOSED: { label: "AI Proposed", color: "#a855f7", description: "No sidechain found — AI recommends adding one" },
};

function SidechainView({ graph }: { graph: any }) {
  const links = graph.sidechainLinks ?? [];
  const allTracks = [...(graph.tracks ?? []), ...(graph.returnTracks ?? [])];

  if (links.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#888] text-sm">No sidechain relationships detected</p>
          <p className="text-xs text-[#555] mt-2">Sidechain detection looks for compressors on non-kick tracks with kick sources</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Legend */}
        <div className="flex items-center gap-4 flex-wrap">
          {Object.entries(DETECTION_METHOD_CONFIG).map(([key, cfg]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
              <span className="text-[10px]" style={{ color: cfg.color }}>{cfg.label}</span>
              <span className="text-[9px] text-[#555]">— {cfg.description}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-[#888]">
          {links.length} sidechain relationship{links.length !== 1 ? "s" : ""} detected
        </p>
        <div className="space-y-3">
          {links.map((link: any, i: number) => {
            const src = allTracks.find((t: any) => t.id === link.sourceTrackId);
            const tgt = allTracks.find((t: any) => t.id === link.targetTrackId);
            const srcColor = src ? (src.color != null ? getTrackColor(src.color) : getRoleColor(src.inferredRole)) : "#666";
            const tgtColor = tgt ? (tgt.color != null ? getTrackColor(tgt.color) : getRoleColor(tgt.inferredRole)) : "#666";
            const method = link.detectionMethod ?? "INFERRED";
            const methodCfg = DETECTION_METHOD_CONFIG[method] ?? DETECTION_METHOD_CONFIG.INFERRED;
            return (
              <div
                key={i}
                className="bg-[#1e1e1e] rounded-lg p-4 flex items-center gap-4"
                style={{ border: `1px solid ${methodCfg.color}40` }}
              >
                {/* Detection method badge */}
                <div
                  className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider"
                  style={{ backgroundColor: methodCfg.color + "20", color: methodCfg.color, minWidth: 62, textAlign: "center" }}
                >
                  {methodCfg.label}
                </div>

                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: srcColor }} />
                  <div>
                    <p className="text-xs font-medium text-[#ccc]">{link.sourceTrackName}</p>
                    <p className="text-[9px] text-[#666]">Source</p>
                  </div>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="h-px flex-1" style={{ backgroundColor: methodCfg.color + "55" }} />
                  <span className="text-xs font-mono" style={{ color: methodCfg.color }}>⊃ SC</span>
                  <div className="h-px flex-1" style={{ backgroundColor: methodCfg.color + "55" }} />
                </div>
                <div className="flex items-center gap-2 min-w-[120px]">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tgtColor }} />
                  <div>
                    <p className="text-xs font-medium text-[#ccc]">{link.targetTrackName}</p>
                    <p className="text-[9px] text-[#666]">Target</p>
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <p className="text-[10px] text-[#777]">{link.deviceClass}</p>
                  <p className="text-[10px]" style={{ color: methodCfg.color + "bb" }}>
                    {Math.round(link.confidence * 100)}% conf
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Track inspector ───────────────────────────────────────────────────────────

function TrackInspector({ track, onClose }: { track: any; onClose: () => void }) {
  const trackColor = track.color != null ? getTrackColor(track.color) : getRoleColor(track.inferredRole);

  return (
    <div className="w-60 shrink-0 flex flex-col overflow-auto" style={{ borderLeft: "1px solid #2a2a2a", background: "#1d1d1d" }}>
      <div className="flex items-center justify-between px-3 py-2 sticky top-0 z-10" style={{ borderBottom: "1px solid #2a2a2a", background: "#222" }}>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: trackColor }} />
          <h3 className="text-[11px] font-medium text-[#ccc] truncate max-w-[140px]">{track.name}</h3>
        </div>
        <button onClick={onClose} className="text-[#666] hover:text-[#ccc] text-lg leading-none ml-1">×</button>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#666]">Role:</span>
          <span className="text-[10px] text-[#ccc]">{track.inferredRole}</span>
          <span className="text-[9px] text-[#666]">{Math.round(track.inferredConfidence * 100)}%</span>
        </div>
        <div className="h-1 bg-[#333] rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${track.inferredConfidence * 100}%`, backgroundColor: trackColor }} />
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <MiniStat label="Clips" value={track.clipCount} />
          <MiniStat label="Devices" value={track.deviceCount} />
          <MiniStat label="Auto" value={track.automationPoints} />
        </div>

        <div className="flex flex-wrap gap-1">
          {track.muted && <Badge text="Muted" cls="bg-yellow-500/15 text-yellow-400" />}
          {track.solo && <Badge text="Solo" cls="bg-blue-500/15 text-blue-400" />}
          {track.frozen && <Badge text="Frozen" cls="bg-sky-500/15 text-sky-400" />}
          {track.armed && <Badge text="Armed" cls="bg-red-500/15 text-red-400" />}
        </div>

        {track.automationLanes?.length > 0 && (
          <div>
            <p className="text-[9px] text-[#666] mb-1.5 uppercase tracking-wider">Automation ({track.automationLanes.length})</p>
            <div className="space-y-1">
              {track.automationLanes.map((lane: any, i: number) => (
                <div key={i} className="text-[10px] px-1.5 py-1 rounded flex items-center justify-between" style={{ background: "#252525" }}>
                  <span className="text-[#aaa] truncate max-w-[110px]">{lane.parameterName}</span>
                  <span className="text-[9px] text-[#555] shrink-0">{lane.points?.length ?? 0}pt</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {track.devices?.length > 0 && (
          <div>
            <p className="text-[9px] text-[#666] mb-1.5 uppercase tracking-wider">Devices ({track.devices.length})</p>
            <div className="space-y-1">
              {track.devices.map((dev: any) => (
                <div key={dev.id} className={cn("text-[10px] px-1.5 py-1 rounded flex items-center justify-between", !dev.enabled && "opacity-35")} style={{ background: "#252525" }}>
                  <span className="text-[#aaa] truncate max-w-[120px]">{dev.pluginName || dev.deviceClass}</span>
                  <span className="text-[8px] text-[#555] shrink-0 ml-1">{dev.inferredPurpose}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {track.routing?.audioOutput && (
          <div>
            <p className="text-[9px] text-[#666] mb-1 uppercase tracking-wider">Routing</p>
            <div className="text-[10px] px-1.5 py-1 rounded" style={{ background: "#252525" }}>
              <span className="text-[#666]">Out → </span>
              <span className="text-[#aaa]">{track.routing.audioOutput.upper || "Master"}</span>
            </div>
          </div>
        )}

        {track.warnings?.length > 0 && (
          <div>
            <p className="text-[9px] text-[#666] mb-1.5 uppercase tracking-wider">Warnings</p>
            {track.warnings.map((w: string, i: number) => (
              <p key={i} className="text-[10px] text-yellow-500/80 leading-snug">⚠ {w}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded p-1.5 text-center" style={{ background: "#252525" }}>
      <p className="text-[11px] font-mono text-[#ccc]">{value}</p>
      <p className="text-[8px] text-[#666]">{label}</p>
    </div>
  );
}

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${cls}`}>{text}</span>;
}
