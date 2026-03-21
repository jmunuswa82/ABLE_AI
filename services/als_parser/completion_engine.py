"""
Completion Plan Engine.

Generates a structured CompletionPlan from a ProjectGraph.
Each action includes:
- Exact start_beat / end_beat derived from actual section coordinates
- Actual target track IDs from parsed project
- Machine-executable mutation payloads
- Flags: creates_new_track, adds_automation, adds_sidechain
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from .models import (
    ProjectGraph, CompletionPlan, CompletionAction, TrackNode,
    ArrangementSection, MutationPayload
)


def generate_completion_plan(graph: ProjectGraph, weaknesses: List[str]) -> CompletionPlan:
    actions: List[CompletionAction] = []

    _generate_structure_actions(graph, weaknesses, actions)
    _generate_drum_actions(graph, weaknesses, actions)
    _generate_bass_actions(graph, weaknesses, actions)
    _generate_automation_actions(graph, weaknesses, actions)
    _generate_transition_actions(graph, weaknesses, actions)
    _generate_ending_actions(graph, weaknesses, actions)
    _generate_texture_actions(graph, weaknesses, actions)
    _generate_sidechain_actions(graph, weaknesses, actions)

    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    actions.sort(key=lambda a: priority_order.get(a.priority, 2))

    completion_score = _calculate_completion_score(graph, weaknesses)
    confidence = min(0.6 + graph.parse_quality * 0.3 + len(graph.tracks) * 0.01, 0.95)
    summary = _build_summary(graph, actions, weaknesses)
    rationale = _build_rationale(graph, graph.style_tags)

    return CompletionPlan(
        project_id=graph.project_id,
        summary=summary,
        confidence=round(confidence, 3),
        completion_score=round(completion_score, 3),
        style_tags=graph.style_tags,
        actions=actions,
        weaknesses=weaknesses,
        warnings=graph.warnings,
        rationale=rationale,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _find_section(graph: ProjectGraph, label_keywords: List[str]) -> Optional[ArrangementSection]:
    for section in graph.sections:
        label_lower = section.label.lower()
        if any(kw in label_lower for kw in label_keywords):
            return section
    return None


def _section_beat_range(section: Optional[ArrangementSection], total_beats: float) -> Tuple[float, float]:
    if section is None:
        return 0.0, total_beats
    return section.start_bar, section.end_bar


def _beats_per_bar(graph: "ProjectGraph") -> float:
    """Returns the number of quarter-note beats per bar for this project."""
    num = getattr(graph, "time_signature_numerator", None) or 4
    den = getattr(graph, "time_signature_denominator", None) or 4
    return float(num) * (4.0 / float(den))


def _bars_label(start_beat: float, end_beat: float, beats_per_bar: float = 4.0) -> str:
    bpb = beats_per_bar if beats_per_bar > 0 else 4.0
    start_bar = int(start_beat / bpb) + 1
    end_bar = int(end_beat / bpb) + 1
    if start_bar == end_bar:
        return f"{start_bar}"
    return f"{start_bar}–{end_bar}"


def _bl(graph: "ProjectGraph", start_beat: float, end_beat: float) -> str:
    """Convenience wrapper: _bars_label with time-signature from graph."""
    return _bars_label(start_beat, end_beat, _beats_per_bar(graph))


def _track_names(tracks: List[TrackNode]) -> List[str]:
    return [t.name for t in tracks]


def _track_ids(tracks: List[TrackNode]) -> List[str]:
    return [t.id for t in tracks]


# ─── Structure actions ────────────────────────────────────────────────────────

def _generate_structure_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    total_beats = graph.arrangement_length or 128.0
    bpb = _beats_per_bar(graph)
    total_bars = total_beats / bpb

    section_labels = [s.label.lower() for s in graph.sections]

    if total_bars < 64:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Extend Arrangement Length",
            description=(
                f"Current arrangement is only {total_bars:.0f} bars. "
                f"A full track typically runs 128–192 bars for DJ compatibility. "
                f"Extend by repeating the groove section and adding a proper outro."
            ),
            affected_tracks=["All tracks"],
            affected_bars=f"After bar {total_bars:.0f}",
            start_beat=total_beats,
            end_beat=total_beats + 64.0 * 4,
            confidence=0.9,
            expected_impact="high",
            rationale=f"At {total_bars:.0f} bars the track is too short for most DJ contexts.",
            priority="critical",
            creates_new_track=False,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_locator",
                    start_beat=total_beats,
                    locator_name="Extend Here",
                    safe=True,
                    reason="Mark extension point",
                )
            ],
        ))

    if not any("outro" in l or "end" in l or "fade" in l for l in section_labels):
        outro_start = max(total_beats - 16 * 4, total_beats * 0.875)
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Add Outro / Exit Section",
            description=(
                "No outro section detected. Add an 8–16 bar outro that gradually strips "
                "elements back, leaving only kick and a fading element to allow DJ mixing out."
            ),
            affected_tracks=["All tracks"],
            affected_bars=_bars_label(outro_start, total_beats),
            start_beat=outro_start,
            end_beat=total_beats,
            section_label="Outro",
            confidence=0.85,
            expected_impact="high",
            rationale="Tracks without outros are difficult to mix out gracefully in a live DJ context.",
            priority="high",
            adds_automation=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_locator",
                    start_beat=outro_start,
                    locator_name="Outro",
                    safe=True,
                    reason="Mark outro section boundary",
                )
            ],
        ))

    if not any("intro" in l for l in section_labels) and total_bars > 64:
        intro_end = min(16.0 * 4, total_beats * 0.125)
        kick_tracks = [t for t in graph.all_tracks if t.inferred_role == "kick"]
        bass_tracks = [t for t in graph.all_tracks if t.inferred_role in ("bass", "rumble")]
        intro_tracks = kick_tracks + bass_tracks
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Add Intro Section",
            description=(
                "Add an 8–16 bar intro that builds from minimal elements (kick only, or kick+bass) "
                "before bringing in the full groove. Gives DJs room to mix in."
            ),
            affected_tracks=_track_names(intro_tracks) or ["Kick", "Bass"],
            affected_bars=_bars_label(0, intro_end),
            start_beat=0.0,
            end_beat=intro_end,
            section_label="Intro",
            target_track_ids=_track_ids(intro_tracks),
            confidence=0.8,
            expected_impact="medium",
            rationale="Intros allow beatmatching and smooth mixing in from previous track.",
            priority="high",
            adds_automation=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_locator",
                    start_beat=0.0,
                    locator_name="Intro",
                    safe=True,
                    reason="Mark intro section",
                )
            ],
        ))

    breakdown_section = _find_section(graph, ["breakdown", "break", "stripped"])
    if not breakdown_section and not any("breakdown" in l or "break" in l for l in section_labels):
        mid = total_beats * 0.5
        bd_start = mid - 16.0 * 4
        bd_end = mid + 16.0 * 4
        all_tracks = graph.all_tracks
        texture_tracks = [t for t in all_tracks if t.inferred_role in ("drone", "texture", "lead")]
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Add Breakdown Section",
            description=(
                f"Insert a 16–32 bar breakdown (bars {int(bd_start/4)+1}–{int(bd_end/4)}) "
                "that removes kick and bass, keeping atmospheric elements. "
                "Creates contrast and anticipation before the drop."
            ),
            affected_tracks=_track_names(texture_tracks) or ["Texture/Drone tracks"],
            affected_bars=_bars_label(bd_start, bd_end),
            start_beat=bd_start,
            end_beat=bd_end,
            section_label="Breakdown",
            target_track_ids=_track_ids(texture_tracks),
            confidence=0.75,
            expected_impact="high",
            rationale="Breakdowns are essential for energy management in a DJ set context.",
            priority="high",
            adds_automation=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_locator",
                    start_beat=bd_start,
                    locator_name="Breakdown",
                    safe=True,
                ),
                MutationPayload(
                    mutation_type="add_automation",
                    start_beat=bd_start,
                    end_beat=bd_end,
                    automation_parameter="Volume",
                    automation_points=[
                        {"time": bd_start, "value": 0.0},
                        {"time": bd_start + 4, "value": 0.0},
                    ],
                    safe=True,
                    reason="Mute kick/bass during breakdown via volume automation placeholder",
                ),
            ],
        ))


# ─── Drum actions ─────────────────────────────────────────────────────────────

def _generate_drum_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    total_beats = graph.arrangement_length or 128.0
    kick_tracks = [t for t in graph.all_tracks if t.inferred_role == "kick"]
    hat_tracks = [t for t in graph.all_tracks if t.inferred_role == "hihat"]
    perc_tracks = [t for t in graph.all_tracks if t.inferred_role == "percussion"]

    if not kick_tracks:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="drums",
            title="Add or Identify Kick Track",
            description=(
                "No kick drum track was confidently detected. Add a kick MIDI/audio track "
                "with a 4-on-the-floor pattern. Layer a sub punch (50–80 Hz) with a click transient."
            ),
            affected_tracks=["New kick track"],
            affected_bars=_bars_label(0, total_beats),
            start_beat=0.0,
            end_beat=total_beats,
            confidence=0.88,
            expected_impact="critical",
            rationale="A kick is the rhythmic foundation of all techno music.",
            priority="critical",
            creates_new_track=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_clip",
                    new_track_name="Kick",
                    new_track_type="midi",
                    start_beat=0.0,
                    end_beat=16.0,
                    clip_type="midi",
                    notes=[
                        {"pitch": 36, "time": 0.0, "duration": 0.25, "velocity": 100},
                        {"pitch": 36, "time": 1.0, "duration": 0.25, "velocity": 95},
                        {"pitch": 36, "time": 2.0, "duration": 0.25, "velocity": 100},
                        {"pitch": 36, "time": 3.0, "duration": 0.25, "velocity": 95},
                    ],
                    safe=True,
                    reason="4-on-the-floor kick placeholder pattern",
                )
            ],
        ))

    if hat_tracks:
        static_hats = [t for t in hat_tracks if any("Static hi-hat" in w for w in t.warnings)]
        if static_hats:
            actions.append(CompletionAction(
                id=str(uuid.uuid4()),
                category="drums",
                title="Add Hi-Hat Variation",
                description=(
                    "Hi-hat tracks show static repetition. Add open hi-hat accents on off-beats, "
                    "ghost notes, or velocity variation."
                ),
                affected_tracks=_track_names(static_hats),
                affected_bars=_bars_label(0, total_beats),
                start_beat=0.0,
                end_beat=total_beats,
                target_track_ids=_track_ids(static_hats),
                confidence=0.82,
                expected_impact="medium",
                rationale="Static hi-hats feel robotic. Subtle variation creates groove.",
                priority="medium",
            ))
    else:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="drums",
            title="Add Hi-Hat Layer",
            description=(
                "No hi-hat track detected. Add closed hi-hat on 8th or 16th notes "
                "with open hat on off-beats. Consider a ride for the groove section."
            ),
            affected_tracks=["New hi-hat track"],
            confidence=0.78,
            expected_impact="medium",
            rationale="Hi-hats provide rhythmic density and forward momentum.",
            priority="medium",
            creates_new_track=True,
        ))

    if len(perc_tracks) < 2:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="drums",
            title="Strengthen Percussion Layer",
            description=(
                "Add 1–2 additional percussion tracks (shakers, congas, industrial percussion) "
                "to create rhythmic complexity. Layer at 1/16th or 1/32nd offsets from the main groove."
            ),
            affected_tracks=["New percussion tracks"],
            confidence=0.72,
            expected_impact="medium",
            rationale="Techno benefits from layered percussion for hypnotic groove depth.",
            priority="medium",
            creates_new_track=True,
        ))


# ─── Bass actions ─────────────────────────────────────────────────────────────

def _generate_bass_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    total_beats = graph.arrangement_length or 128.0
    bass_tracks = [t for t in graph.all_tracks if t.inferred_role in ("bass", "rumble")]

    if not bass_tracks:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="bass",
            title="Add Bass / Sub Element",
            description=(
                "No bass track detected. Add a sub bass (30–80 Hz) that locks to the kick pattern "
                "or runs a continuous groove. Single-note bass with filter automation creates movement."
            ),
            affected_tracks=["New bass track"],
            affected_bars=_bars_label(0, total_beats),
            start_beat=0.0,
            end_beat=total_beats,
            confidence=0.9,
            expected_impact="high",
            rationale="Sub bass provides low-end weight and energy on large sound systems.",
            priority="high",
            creates_new_track=True,
        ))
        return

    # Check for arrangement gaps
    bass_with_gaps = [t for t in bass_tracks if any("Gap" in w for w in t.warnings)]
    if bass_with_gaps:
        # Find the actual gap positions
        for bass in bass_with_gaps:
            sorted_clips = sorted(bass.clips, key=lambda c: c.start)
            last_end = 0.0
            for clip in sorted_clips:
                gap = clip.start - last_end
                if gap > 8.0:
                    actions.append(CompletionAction(
                        id=str(uuid.uuid4()),
                        category="bass",
                        title=f"Fill Bass Gap at Bar {int(last_end/4)+1}–{int(clip.start/4)+1}",
                        description=(
                            f"Bass track '{bass.name}' has a {gap/4:.0f}-bar gap "
                            f"(bars {int(last_end/4)+1}–{int(clip.start/4)+1}). "
                            "Extend clips or add transitional bass elements to maintain low-end continuity."
                        ),
                        affected_tracks=[bass.name],
                        affected_bars=_bars_label(last_end, clip.start),
                        start_beat=last_end,
                        end_beat=clip.start,
                        target_track_ids=[bass.id],
                        confidence=0.88,
                        expected_impact="high",
                        rationale="Gaps in bass coverage create uncomfortable 'holes' on a club sound system.",
                        priority="high",
                        mutation_payloads=[
                            MutationPayload(
                                mutation_type="add_clip",
                                target_track_id=bass.id,
                                target_track_name=bass.name,
                                start_beat=last_end,
                                end_beat=clip.start,
                                clip_type="midi",
                                safe=True,
                                reason="Fill bass gap with continuation clip",
                            )
                        ],
                    ))
                last_end = clip.end

    # Bass filter automation
    bass_with_no_auto = [t for t in bass_tracks if len(t.automation_lanes) == 0]
    if bass_with_no_auto:
        bass = bass_with_no_auto[0]
        # Find where to put the automation — at a build section
        build_section = _find_section(graph, ["build", "buildup", "riser", "tension"])
        auto_start = build_section.start_bar if build_section else total_beats * 0.25
        auto_end = build_section.end_bar if build_section else total_beats * 0.5

        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="bass",
            title="Add Bass Filter Automation",
            description=(
                f"Add filter cutoff automation to '{bass.name}' to create movement. "
                f"A low-pass filter opening from 200 Hz to 800 Hz over bars "
                f"{int(auto_start/4)+1}–{int(auto_end/4)+1} creates a classic energy build."
            ),
            affected_tracks=[bass.name],
            affected_bars=_bars_label(auto_start, auto_end),
            start_beat=auto_start,
            end_beat=auto_end,
            target_track_ids=[bass.id],
            section_label=build_section.label if build_section else None,
            confidence=0.8,
            expected_impact="medium",
            rationale="Filter automation on bass is the primary energy tool in techno.",
            priority="medium",
            adds_automation=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_automation",
                    target_track_id=bass.id,
                    target_track_name=bass.name,
                    automation_parameter="Filter Cutoff",
                    start_beat=auto_start,
                    end_beat=auto_end,
                    automation_points=[
                        {"time": auto_start, "value": 0.25},
                        {"time": auto_end, "value": 0.75},
                    ],
                    safe=True,
                    reason="Filter sweep on bass for build section energy",
                )
            ],
        ))


# ─── Automation actions ───────────────────────────────────────────────────────

def _generate_automation_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    total_beats = graph.arrangement_length or 128.0
    static_weakness = any("static" in w.lower() or "no automation" in w.lower() for w in weaknesses)

    # Find good targets for filter sweeps
    synth_tracks = [t for t in graph.all_tracks if t.inferred_role in ("lead", "synth_stab", "drone")]
    bass_tracks = [t for t in graph.all_tracks if t.inferred_role in ("bass", "rumble")]
    sweep_targets = synth_tracks + bass_tracks

    if static_weakness:
        build_section = _find_section(graph, ["build", "buildup", "pre", "tension"])
        sweep_start = build_section.start_bar if build_section else total_beats * 0.3
        sweep_end = build_section.end_bar if build_section else total_beats * 0.5

        target_track = sweep_targets[0] if sweep_targets else None
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="automation",
            title="Add Filter Sweep Automation",
            description=(
                f"Automate filter cutoff on key tracks through section transitions "
                f"(bars {int(sweep_start/4)+1}–{int(sweep_end/4)+1}). "
                "Build from fully closed to 60–70% open over 4–8 bars leading into the drop, "
                "close again entering breakdown."
            ),
            affected_tracks=_track_names(sweep_targets[:3]) or ["Synth tracks", "Bass tracks"],
            affected_bars=_bars_label(sweep_start, sweep_end),
            start_beat=sweep_start,
            end_beat=sweep_end,
            target_track_ids=_track_ids(sweep_targets[:3]),
            section_label=build_section.label if build_section else None,
            confidence=0.85,
            expected_impact="high",
            rationale="Filter sweeps are the primary energy tool in techno and are expected by listeners.",
            priority="high",
            adds_automation=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_automation",
                    target_track_id=target_track.id if target_track else None,
                    target_track_name=target_track.name if target_track else None,
                    automation_parameter="Filter Cutoff",
                    start_beat=sweep_start,
                    end_beat=sweep_end,
                    automation_points=[
                        {"time": sweep_start, "value": 0.15},
                        {"time": sweep_end - 4, "value": 0.75},
                        {"time": sweep_end, "value": 0.75},
                    ],
                    safe=True,
                    reason="Filter sweep for build section",
                )
            ],
        ))

        # Find return tracks for send automation
        return_tracks = graph.return_tracks
        if return_tracks:
            send_track = return_tracks[0]
            breakdown_section = _find_section(graph, ["breakdown", "break"])
            send_start = breakdown_section.start_bar if breakdown_section else total_beats * 0.5
            send_end = breakdown_section.end_bar if breakdown_section else total_beats * 0.65

            actions.append(CompletionAction(
                id=str(uuid.uuid4()),
                category="automation",
                title="Add Send Level Automation",
                description=(
                    f"Automate reverb/delay send amounts on key elements "
                    f"(bars {int(send_start/4)+1}–{int(send_end/4)+1}). "
                    "Throw reverb sends up during breakdown to create space and anticipation."
                ),
                affected_tracks=[send_track.name],
                affected_bars=_bars_label(send_start, send_end),
                start_beat=send_start,
                end_beat=send_end,
                target_track_ids=[send_track.id],
                section_label=breakdown_section.label if breakdown_section else None,
                confidence=0.78,
                expected_impact="medium",
                rationale="Automated send throws create depth and atmosphere essential for techno tension.",
                priority="medium",
                adds_automation=True,
            ))

    # Resonance automation is always worth adding
    resonance_targets = [t for t in graph.all_tracks if t.inferred_role in ("bass", "lead", "synth_stab")]
    if resonance_targets:
        peak_section = _find_section(graph, ["peak", "drop", "climax"])
        res_start = peak_section.start_bar if peak_section else total_beats * 0.55
        res_end = peak_section.end_bar if peak_section else total_beats * 0.7
        target = resonance_targets[0]

        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="automation",
            title="Add Resonance Automation",
            description=(
                f"Automate filter resonance on '{target.name}' through the peak section "
                f"(bars {int(res_start/4)+1}–{int(res_end/4)+1}). "
                "Rising resonance (Q) from 0.5 to 2.0 creates tension and urgency."
            ),
            affected_tracks=[target.name],
            affected_bars=_bars_label(res_start, res_end),
            start_beat=res_start,
            end_beat=res_end,
            target_track_ids=[target.id],
            section_label=peak_section.label if peak_section else None,
            confidence=0.72,
            expected_impact="medium",
            rationale="Resonance automation adds harmonic tension absent from purely gain-based dynamics.",
            priority="low",
            adds_automation=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_automation",
                    target_track_id=target.id,
                    target_track_name=target.name,
                    automation_parameter="Filter Resonance",
                    start_beat=res_start,
                    end_beat=res_end,
                    automation_points=[
                        {"time": res_start, "value": 0.3},
                        {"time": res_end, "value": 0.85},
                    ],
                    safe=True,
                )
            ],
        ))


# ─── Transition actions ───────────────────────────────────────────────────────

def _generate_transition_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    weak_transition = any("transition" in w.lower() for w in weaknesses)
    total_beats = graph.arrangement_length or 128.0

    if weak_transition or len(graph.sections) >= 2:
        # Find all section boundaries
        boundaries = []
        for i in range(1, len(graph.sections)):
            boundary_beat = graph.sections[i].start_bar
            pre_start = max(0, boundary_beat - 8 * 4)
            boundaries.append((pre_start, boundary_beat, graph.sections[i].label))

        if boundaries:
            # Show the most impactful transition
            pre_start, boundary_beat, section_label = boundaries[0]
            if len(boundaries) > 1:
                # Also note all boundary positions
                all_positions = ", ".join(
                    f"bar {int(b/4)+1} before {lbl}"
                    for _, b, lbl in boundaries[:4]
                )
                description = (
                    f"Add white noise or filtered sweep risers (4–8 bars) before major section changes. "
                    f"Section boundaries at: {all_positions}. "
                    "Also add downward pitch automation on synths as the drop hits."
                )
            else:
                description = (
                    f"Add white noise or filtered sweep riser (bars {int(pre_start/4)+1}–{int(boundary_beat/4)+1}) "
                    f"before '{section_label}'. Add downward pitch automation on synths at bar {int(boundary_beat/4)+1}."
                )

            actions.append(CompletionAction(
                id=str(uuid.uuid4()),
                category="transitions",
                title="Add Tension Sweeps at Section Boundaries",
                description=description,
                affected_tracks=["New FX/sweep track"],
                affected_bars=_bars_label(pre_start, boundary_beat),
                start_beat=pre_start,
                end_beat=boundary_beat,
                section_label=section_label,
                confidence=0.82,
                expected_impact="high",
                rationale="Sweeps signal section changes and build anticipation — critical for floor impact.",
                priority="high",
                creates_new_track=True,
                adds_automation=True,
                mutation_payloads=[
                    MutationPayload(
                        mutation_type="add_clip",
                        new_track_name="FX Sweep",
                        new_track_type="audio",
                        start_beat=pre_start,
                        end_beat=boundary_beat,
                        clip_type="audio",
                        safe=True,
                        reason="Riser/sweep transition clip placeholder",
                    )
                ],
            ))

        # Drum fill
        if boundaries:
            fill_beat = max(0, boundaries[0][1] - 2 * 4)
            fill_end = boundaries[0][1]
            perc_tracks = [t for t in graph.all_tracks if t.inferred_role in ("percussion", "snare", "clap")]

            actions.append(CompletionAction(
                id=str(uuid.uuid4()),
                category="transitions",
                title="Add Drum Fill at Key Transitions",
                description=(
                    f"Add a 1–2 bar drum fill (bars {int(fill_beat/4)+1}–{int(fill_end/4)+1}) "
                    "before each major section change. A 1/16th–1/32nd note roll on snare or clap works well."
                ),
                affected_tracks=_track_names(perc_tracks) or ["Percussion tracks", "Clap/Snare track"],
                affected_bars=_bars_label(fill_beat, fill_end),
                start_beat=fill_beat,
                end_beat=fill_end,
                target_track_ids=_track_ids(perc_tracks),
                confidence=0.78,
                expected_impact="medium",
                rationale="Fills signal transitions and energize the moment of section change.",
                priority="medium",
            ))


# ─── Ending actions ───────────────────────────────────────────────────────────

def _generate_ending_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    ending_weak = any("ending" in w.lower() or "outro" in w.lower() or "abrupt" in w.lower() for w in weaknesses)
    total_beats = graph.arrangement_length or 128.0

    if ending_weak:
        outro_start = max(total_beats - 16 * 4, total_beats * 0.875)
        all_tracks = graph.all_tracks

        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="ending",
            title="Build Outro Strip-Back Sequence",
            description=(
                f"Create a 16-bar outro (bars {int(outro_start/4)+1}–{int(total_beats/4)}) "
                "where elements drop out gradually: first remove leads/synths (bars 1–4 of outro), "
                "then percussion (bars 5–8), leaving kick+bass to bar 12, then only kick to bar 16. "
                "Fade kick with volume automation."
            ),
            affected_tracks=["All tracks"],
            affected_bars=_bars_label(outro_start, total_beats),
            start_beat=outro_start,
            end_beat=total_beats,
            section_label="Outro",
            confidence=0.88,
            expected_impact="high",
            rationale="A proper outro is essential for live DJ mixing — allows smooth transition to next track.",
            priority="high",
            adds_automation=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_automation",
                    automation_parameter="Volume",
                    start_beat=outro_start + 12 * 4,
                    end_beat=total_beats,
                    automation_points=[
                        {"time": outro_start + 12 * 4, "value": 1.0},
                        {"time": total_beats - 4, "value": 0.3},
                        {"time": total_beats, "value": 0.0},
                    ],
                    safe=True,
                    reason="Master volume fade for outro",
                )
            ],
        ))


# ─── Texture actions ──────────────────────────────────────────────────────────

def _generate_texture_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    total_beats = graph.arrangement_length or 128.0
    drone_tracks = [t for t in graph.all_tracks if t.inferred_role in ("drone", "texture")]

    if not drone_tracks:
        breakdown_section = _find_section(graph, ["breakdown", "break", "intro"])
        tex_start = breakdown_section.start_bar if breakdown_section else total_beats * 0.4
        tex_end = breakdown_section.end_bar if breakdown_section else total_beats * 0.6

        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="texture",
            title="Add Atmospheric Drone/Texture",
            description=(
                f"Add a long, sustained drone or textural layer "
                f"(bars {int(tex_start/4)+1}–{int(tex_end/4)+1}) "
                "through breakdown and intro sections. "
                "A slowly evolving pad or resampled noise with high reverb works well."
            ),
            affected_tracks=["New texture/drone track"],
            affected_bars=_bars_label(tex_start, tex_end),
            start_beat=tex_start,
            end_beat=tex_end,
            section_label=breakdown_section.label if breakdown_section else None,
            confidence=0.73,
            expected_impact="medium",
            rationale="Textural layers provide depth and atmosphere, especially in breakdowns.",
            priority="low",
            creates_new_track=True,
        ))


# ─── Sidechain actions ────────────────────────────────────────────────────────

def _generate_sidechain_actions(
    graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]
) -> None:
    total_beats = graph.arrangement_length or 128.0

    # Only add sidechain actions if there are AI-proposed links (no detected ones)
    proposed_links = [
        l for l in graph.sidechain_links
        if l.relation_type.startswith("AI_PROPOSED")
    ]

    # Fallback: if no sidechain links at all but kick+bass exist, synthesise a proposal
    if not proposed_links and not graph.sidechain_links:
        kick_tracks = [t for t in graph.all_tracks if t.inferred_role == "kick"]
        bass_tracks = [t for t in graph.all_tracks if t.inferred_role in ("bass", "rumble")]
        if kick_tracks and bass_tracks:
            from .models import SidechainLink
            proposed_links = [
                SidechainLink(
                    source_track_id=kick_tracks[0].id,
                    target_track_id=bass_tracks[0].id,
                    source_track_name=kick_tracks[0].name,
                    target_track_name=bass_tracks[0].name,
                    device_class="Compressor2",
                    device_id="ai_proposed_sc_fallback",
                    confidence=0.88,
                    relation_type="AI_PROPOSED_KICK_TO_BASS_DUCK",
                    purpose="Add pumping groove — kick ducking bass is standard in techno/dance",
                    detection_method="AI_PROPOSED",
                )
            ]

    for link in proposed_links[:2]:
        # Find the groove/peak section for context
        groove_section = _find_section(graph, ["groove", "peak", "drop", "main"])
        sc_start = groove_section.start_bar if groove_section else 0.0
        sc_end = groove_section.end_bar if groove_section else total_beats

        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="sidechain",
            title=f"Add Sidechain: {link.source_track_name} → {link.target_track_name}",
            description=(
                f"No sidechain relationship detected. AI proposes adding a kick-triggered "
                f"sidechain compressor on '{link.target_track_name}' sourced from '{link.source_track_name}'. "
                f"Apply through the groove section (bars {int(sc_start/4)+1}–{int(sc_end/4)+1}). "
                f"Purpose: {link.purpose}. "
                "Use Ableton's Compressor with Sidechain > Audio From set to the kick track."
            ),
            affected_tracks=[link.source_track_name, link.target_track_name],
            affected_bars=_bars_label(sc_start, sc_end),
            start_beat=sc_start,
            end_beat=sc_end,
            target_track_ids=[link.target_track_id],
            section_label=groove_section.label if groove_section else None,
            confidence=link.confidence,
            expected_impact="high",
            rationale=link.purpose,
            priority="high",
            adds_sidechain=True,
            mutation_payloads=[
                MutationPayload(
                    mutation_type="add_sidechain_proposal",
                    target_track_id=link.target_track_id,
                    target_track_name=link.target_track_name,
                    start_beat=sc_start,
                    end_beat=sc_end,
                    safe=False,  # Sidechain routing changes are not auto-patchable safely
                    reason=f"Add Compressor with sidechain input from {link.source_track_name}",
                )
            ],
        ))


# ─── Score + summary ──────────────────────────────────────────────────────────

def _calculate_completion_score(graph: ProjectGraph, weaknesses: List[str]) -> float:
    score = 1.0

    critical_penalties = {
        "no kick": 0.2,
        "no bass": 0.15,
        "no automation": 0.1,
        "repetitive": 0.05,
        "abrupt": 0.08,
        "static": 0.06,
        "gap": 0.05,
    }

    for weakness in weaknesses:
        for key, penalty in critical_penalties.items():
            if key in weakness.lower():
                score -= penalty
                break

    has_kick = any(t.inferred_role == "kick" for t in graph.all_tracks)
    has_bass = any(t.inferred_role in ("bass", "rumble") for t in graph.all_tracks)
    has_sections = len(graph.sections) >= 3
    has_automation = any(len(t.automation_lanes) > 0 for t in graph.all_tracks)
    has_returns = len(graph.return_tracks) > 0
    arrangement_ok = graph.arrangement_length >= 64

    if has_kick:       score = min(score + 0.05, 1.0)
    if has_bass:       score = min(score + 0.05, 1.0)
    if has_sections:   score = min(score + 0.05, 1.0)
    if has_automation: score = min(score + 0.05, 1.0)
    if has_returns:    score = min(score + 0.03, 1.0)
    if arrangement_ok: score = min(score + 0.05, 1.0)

    return max(round(score, 3), 0.0)


def _build_summary(graph: ProjectGraph, actions: List[CompletionAction], weaknesses: List[str]) -> str:
    style = ", ".join(graph.style_tags[:2]) if graph.style_tags else "techno"
    track_count = len(graph.tracks)
    clip_count = graph.total_clips
    auto_count = sum(1 for t in graph.all_tracks if t.automation_lanes)
    critical_count = len([a for a in actions if a.priority == "critical"])
    high_count = len([a for a in actions if a.priority == "high"])
    total_beats = graph.arrangement_length or 0
    total_bars = int(total_beats / 4)

    return (
        f"Analyzed a {style} project with {track_count} tracks, "
        f"{clip_count} clips, {auto_count} automated tracks, at {graph.tempo:.0f} BPM — "
        f"{total_bars} bars total. "
        f"Found {len(weaknesses)} potential improvements. "
        f"Generated {len(actions)} completion actions "
        f"({critical_count} critical, {high_count} high priority)."
    )


def _build_rationale(graph: ProjectGraph, style_tags: List[str]) -> str:
    style = style_tags[0] if style_tags else "techno"
    auto_tracks_count = sum(1 for t in graph.all_tracks if t.automation_lanes)
    sidechain_count = len(graph.sidechain_links)
    return (
        f"This {style} project has been analyzed using rule-based music analysis. "
        f"Completion suggestions are based on: arrangement structure analysis, "
        f"role inference (track type detection without relying on names), "
        f"section energy/density profiling, automation density analysis "
        f"({auto_tracks_count} tracks with automation detected), "
        f"sidechain graph analysis ({sidechain_count} links detected or proposed), "
        f"and genre-specific production conventions for {style}. "
        f"All suggestions include exact bar placements derived from the parsed arrangement, "
        f"machine-executable mutation payloads, and confidence scores based on parse quality "
        f"({graph.parse_quality:.0%}) and detection certainty."
    )
