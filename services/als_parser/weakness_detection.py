"""
Weakness Detection Engine.

Detects arrangement and production weaknesses:
- Repetitive loops with no evolution
- Weak transitions
- Flat percussion
- Static automation
- Underdeveloped sections
- Poor low-end continuity
- Weak ending
- Underused returns
"""

from __future__ import annotations

from typing import List, Set
from .models import ProjectGraph, TrackNode, ArrangementSection


def detect_weaknesses(graph: ProjectGraph) -> List[str]:
    """
    Returns a list of weakness descriptions ordered by severity.
    """
    weaknesses: List[str] = []

    _check_repetition(graph, weaknesses)
    _check_automation(graph, weaknesses)
    _check_transitions(graph, weaknesses)
    _check_low_end(graph, weaknesses)
    _check_section_contrast(graph, weaknesses)
    _check_ending(graph, weaknesses)
    _check_returns(graph, weaknesses)
    _check_breakdown(graph, weaknesses)
    _check_hat_evolution(graph, weaknesses)
    _check_track_evolution(graph, weaknesses)

    return weaknesses


def _check_repetition(graph: ProjectGraph, out: List[str]) -> None:
    """Detect tracks with same clip repeated throughout with no variation."""
    for track in graph.all_tracks:
        if len(track.clips) < 4:
            continue

        # Check if clips all have very similar lengths (repetitive loop)
        lengths = [c.end - c.start for c in track.clips]
        if not lengths:
            continue
        avg_len = sum(lengths) / len(lengths)
        variance = sum((l - avg_len) ** 2 for l in lengths) / len(lengths)

        if variance < 0.1 and avg_len < 4.0:
            out.append(f"Track '{track.name}': repetitive short loop ({avg_len:.1f} bars) with no variation detected")
            track.warnings.append("Repetitive loop detected - no evolution")


def _check_automation(graph: ProjectGraph, out: List[str]) -> None:
    """Detect static automation (no parameter movement)."""
    tracks_with_clips = [t for t in graph.all_tracks if len(t.clips) > 0]
    tracks_with_auto = [t for t in tracks_with_clips if len(t.automation_lanes) > 0]

    if not tracks_with_clips:
        return

    auto_ratio = len(tracks_with_auto) / len(tracks_with_clips)

    if auto_ratio < 0.2:
        out.append("Very little automation detected — arrangement feels static and lacks dynamic movement")

    # Check for static (constant) automation
    for track in tracks_with_auto:
        for lane in track.automation_lanes:
            if len(lane.points) <= 1:
                continue
            values = [p.value for p in lane.points]
            value_range = max(values) - min(values)
            if value_range < 0.01:
                out.append(f"Track '{track.name}': automation lane '{lane.parameter_name}' is essentially static (no movement)")


def _check_transitions(graph: ProjectGraph, out: List[str]) -> None:
    """Check transition quality between sections."""
    if len(graph.sections) < 2:
        return

    poor_transitions = [s for s in graph.sections if s.transition_quality < 0.4]

    if len(poor_transitions) >= 2:
        out.append("Multiple section transitions lack tension-building elements (no sweeps, FX, or transition clips detected)")

    for section in poor_transitions:
        if section.label not in ("Intro",):
            out.append(f"Section '{section.label}': weak or absent transition into this section")


def _check_low_end(graph: ProjectGraph, out: List[str]) -> None:
    """Check for bass/kick continuity."""
    kick_tracks = [t for t in graph.all_tracks if t.inferred_role == "kick"]
    bass_tracks = [t for t in graph.all_tracks if t.inferred_role in ("bass", "rumble")]

    total_bars = graph.arrangement_length or 128.0

    if not kick_tracks:
        out.append("No kick drum track detected — low-end foundation absent or unnamed")

    if not bass_tracks:
        out.append("No bass/sub track detected — low-end continuity may be weak")
        return

    # Check for gaps in bass coverage
    bass = bass_tracks[0]
    if len(bass.clips) == 0:
        out.append(f"Track '{bass.name}' appears to be a bass track but has no clips")
        bass.warnings.append("Bass track has no clips")
        return

    sorted_clips = sorted(bass.clips, key=lambda c: c.start)
    last_end = 0.0
    for clip in sorted_clips:
        gap = clip.start - last_end
        if gap > 8.0:
            out.append(f"Bass track '{bass.name}': gap of {gap:.0f} bars detected (weak low-end continuity)")
            bass.warnings.append(f"Gap of {gap:.0f} bars in bass coverage")
        last_end = clip.end


def _check_section_contrast(graph: ProjectGraph, out: List[str]) -> None:
    """Check if sections have meaningful energy contrast."""
    if len(graph.sections) < 3:
        return

    energy_scores = [s.energy_score for s in graph.sections]
    max_e = max(energy_scores)
    min_e = min(energy_scores)

    if max_e - min_e < 0.2:
        out.append("Sections show low energy contrast — arrangement may feel monotonous without clear peaks and breakdowns")


def _check_ending(graph: ProjectGraph, out: List[str]) -> None:
    """Detect abrupt or unfinished endings."""
    if not graph.sections:
        return

    last_section = graph.sections[-1]

    if last_section.label not in ("Outro", "End", "Fade", "Close"):
        out.append(f"No outro section detected — arrangement may end abruptly at bar {graph.arrangement_length:.0f}")

    # Check if the last section has any content
    last_active = len([
        t for t in graph.all_tracks
        if any(c.end >= graph.arrangement_length - 8 for c in t.clips)
    ])

    if last_active == 0:
        out.append("Last 8 bars appear to have no active tracks — ending may be missing or unfinished")


def _check_returns(graph: ProjectGraph, out: List[str]) -> None:
    """Check if return tracks are being used."""
    if not graph.return_tracks:
        out.append("No return tracks detected — reverb and delay sends may be absent")
        return

    # Check if any track sends to returns
    has_sends = any(len(t.automation_lanes) > 0 for t in graph.return_tracks)
    if not has_sends and len(graph.return_tracks) > 0:
        out.append(f"{len(graph.return_tracks)} return track(s) detected but may be underused (no automated sends)")


def _check_breakdown(graph: ProjectGraph, out: List[str]) -> None:
    """Check breakdown quality."""
    breakdowns = [s for s in graph.sections if "breakdown" in s.label.lower()]
    if not breakdowns:
        return

    for bd in breakdowns:
        if bd.density_score > 0.6:
            out.append(f"Section '{bd.label}': breakdown is too dense — not enough track reduction for contrast")
        if not bd.dominant_roles or all(r in ("kick", "bass") for r in bd.dominant_roles):
            out.append(f"Section '{bd.label}': breakdown lacks texture elements (pads, drones, FX)")


def _check_hat_evolution(graph: ProjectGraph, out: List[str]) -> None:
    """Check if hi-hat patterns evolve."""
    hat_tracks = [t for t in graph.all_tracks if t.inferred_role in ("hihat",)]
    if not hat_tracks:
        return

    for track in hat_tracks:
        if len(track.clips) < 3:
            continue
        lengths = [c.end - c.start for c in track.clips]
        if len(set(round(l, 1) for l in lengths)) == 1:
            out.append(f"Hi-hat track '{track.name}': same length clips throughout — no variation or open/closed pattern evolution")
            track.warnings.append("Static hi-hat pattern detected")


def _check_track_evolution(graph: ProjectGraph, out: List[str]) -> None:
    """Check if tracks have any variation over time."""
    tracks_with_many_clips = [t for t in graph.all_tracks if len(t.clips) >= 6]

    static_count = 0
    for track in tracks_with_many_clips:
        if len(track.automation_lanes) == 0:
            static_count += 1

    if static_count >= 3:
        out.append(f"{static_count} tracks with many clips but zero automation — consider adding filter sweeps, send throws, or gain automation")
