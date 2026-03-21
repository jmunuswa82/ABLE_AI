import { useState, useRef } from "react";
import { useParams } from "wouter";
import { useGetProjectGraph } from "@workspace/api-client-react";
import { getRoleColor, formatBars } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

const TRACK_HEIGHT = 36;
const LABEL_WIDTH = 176;
const RULER_HEIGHT = 28;
const PIXELS_PER_BAR = 12;

export default function TimelineView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: graph, isLoading } = useGetProjectGraph(id);

  const { selectedTrackId, setSelectedTrack } = useStudioStore();
  const containerRef = useRef<HTMLDivElement>(null);

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
  const timelineWidth = totalBars * PIXELS_PER_BAR;
  const allTracks = [
    ...(graph.tracks ?? []),
    ...(graph.returnTracks ?? []),
  ];

  const selectedTrack = allTracks.find((t: any) => t.id === selectedTrackId) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Timeline area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Info bar */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-card text-xs text-muted-foreground shrink-0">
          <span className="font-mono">{graph.tempo} BPM</span>
          <span className="font-mono">{graph.timeSignatureNumerator}/{graph.timeSignatureDenominator}</span>
          <span>{formatBars(totalBars)}</span>
          <span>{allTracks.length} tracks</span>
        </div>

        {/* Scrollable timeline */}
        <div className="flex-1 overflow-auto" ref={containerRef}>
          <div className="inline-block min-w-full">
            {/* Ruler row */}
            <div
              className="flex border-b border-border sticky top-0 z-20 bg-background"
              style={{ height: RULER_HEIGHT }}
            >
              {/* Track label spacer */}
              <div
                className="shrink-0 bg-sidebar border-r border-border sticky left-0 z-30"
                style={{ width: LABEL_WIDTH }}
              />
              {/* Bar ruler */}
              <div className="relative" style={{ width: timelineWidth, height: RULER_HEIGHT }}>
                <Ruler totalBars={totalBars} pixelsPerBar={PIXELS_PER_BAR} />
              </div>
            </div>

            {/* Section overlays row */}
            {graph.sections?.length > 0 && (
              <div className="flex border-b border-border sticky top-7 z-10 bg-background/80 backdrop-blur-sm">
                <div
                  className="shrink-0 bg-sidebar border-r border-border sticky left-0 z-20 flex items-center px-2"
                  style={{ width: LABEL_WIDTH, height: 24 }}
                >
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Sections</span>
                </div>
                <div className="relative" style={{ width: timelineWidth, height: 24 }}>
                  {graph.sections.map((section: any) => (
                    <SectionBlock
                      key={section.id}
                      section={section}
                      pixelsPerBar={PIXELS_PER_BAR}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Tracks */}
            {allTracks.map((track: any) => (
              <div
                key={track.id}
                className={`flex border-b border-border cursor-pointer ${
                  selectedTrackId === track.id ? "bg-accent/20" : "hover:bg-muted/10"
                }`}
                style={{ height: TRACK_HEIGHT }}
                onClick={() => setSelectedTrack(selectedTrackId === track.id ? null : track.id)}
              >
                {/* Label */}
                <div
                  className="shrink-0 border-r border-border flex items-center px-2 gap-2 sticky left-0 z-10 bg-sidebar"
                  style={{ width: LABEL_WIDTH }}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: getRoleColor(track.inferredRole) }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{track.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{track.inferredRole}</p>
                  </div>
                  {track.muted && (
                    <span className="text-[9px] text-yellow-500 shrink-0 ml-auto">M</span>
                  )}
                </div>

                {/* Clip area */}
                <div className="relative" style={{ width: timelineWidth, height: TRACK_HEIGHT }}>
                  {track.clips?.map((clip: any) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      track={track}
                      pixelsPerBar={PIXELS_PER_BAR}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Inspector panel */}
      {selectedTrack && (
        <TrackInspector track={selectedTrack} onClose={() => setSelectedTrack(null)} />
      )}
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
        <div
          key={bar}
          className="absolute top-0 bottom-0 flex items-end pb-1"
          style={{ left: bar * pixelsPerBar }}
        >
          <div className="absolute top-0 bottom-0 w-px bg-border/50" />
          <span className="text-[9px] font-mono text-muted-foreground pl-1 z-10">
            {bar + 1}
          </span>
        </div>
      ))}
    </>
  );
}

function ClipBlock({
  clip,
  track,
  pixelsPerBar,
}: {
  clip: any;
  track: any;
  pixelsPerBar: number;
}) {
  const left = clip.start * pixelsPerBar;
  const width = Math.max((clip.end - clip.start) * pixelsPerBar, 2);
  const color = getRoleColor(track.inferredRole);

  return (
    <div
      className="absolute top-1 bottom-1 rounded-sm border border-white/10 overflow-hidden text-[9px] font-mono flex items-center px-1"
      style={{
        left,
        width,
        backgroundColor: color + "55",
        borderColor: color + "88",
        color: color,
      }}
      title={`${clip.clipType} • ${(clip.end - clip.start).toFixed(1)} bars`}
    >
      {width > 24 && (
        <span className="truncate opacity-80">
          {clip.clipType === "midi" ? "M" : "A"}
        </span>
      )}
    </div>
  );
}

function SectionBlock({
  section,
  pixelsPerBar,
}: {
  section: any;
  pixelsPerBar: number;
}) {
  const left = section.startBar * pixelsPerBar;
  const width = (section.endBar - section.startBar) * pixelsPerBar;

  const energyColors: Record<string, string> = {
    "Intro": "#4f8cd4",
    "Groove Establishment": "#52d4c4",
    "Build": "#d4c452",
    "Peak": "#e05252",
    "Breakdown": "#8c52d4",
    "Recovery": "#5284d4",
    "Second Peak": "#d47052",
    "Outro": "#527cd4",
  };
  const color = energyColors[section.label] ?? "#666";

  return (
    <div
      className="absolute top-0 bottom-0 border-l border-t border-b border-opacity-40 flex items-center px-1"
      style={{
        left,
        width,
        borderColor: color,
        backgroundColor: color + "18",
      }}
      title={section.label}
    >
      <span className="text-[9px] font-mono truncate" style={{ color }}>
        {section.label}
      </span>
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
        {/* Track name */}
        <div>
          <p className="text-xs text-muted-foreground mb-1">Track</p>
          <p className="text-sm font-medium text-foreground">{track.name}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{track.type}</p>
        </div>

        {/* Role */}
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Inferred Role</p>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: roleColor }} />
            <span className="text-sm text-foreground">{track.inferredRole}</span>
            <span className="text-xs text-muted-foreground">
              {Math.round(track.inferredConfidence * 100)}%
            </span>
          </div>
          <div className="mt-1.5 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${track.inferredConfidence * 100}%`,
                backgroundColor: roleColor,
              }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Clips" value={track.clipCount} />
          <MiniStat label="Devices" value={track.deviceCount} />
          <MiniStat label="Auto pts" value={track.automationPoints} />
        </div>

        {/* State flags */}
        <div className="flex flex-wrap gap-1.5">
          {track.muted && <Badge text="Muted" color="yellow" />}
          {track.solo && <Badge text="Solo" color="blue" />}
          {track.frozen && <Badge text="Frozen" color="sky" />}
          {track.armed && <Badge text="Armed" color="red" />}
        </div>

        {/* Devices */}
        {track.devices?.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Devices</p>
            <div className="space-y-1">
              {track.devices.map((dev: any) => (
                <div
                  key={dev.id}
                  className={`text-xs px-2 py-1 rounded bg-muted/30 flex items-center justify-between ${!dev.enabled ? "opacity-40" : ""}`}
                >
                  <span className="text-foreground truncate max-w-[120px]">
                    {dev.pluginName || dev.deviceClass}
                  </span>
                  <span className="text-muted-foreground text-[9px] shrink-0 ml-1">
                    {dev.inferredPurpose}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
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
