"""
Completion Plan Engine.

Generates a structured CompletionPlan from a ProjectGraph.
Uses rule-based + heuristic intelligence to suggest:
- Structure changes
- Percussion enhancements
- Bass continuity
- Automation upgrades
- Transition improvements
- Ending/outro completion
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Dict, Any
from .models import ProjectGraph, CompletionPlan, CompletionAction, TrackNode, ArrangementSection


def generate_completion_plan(graph: ProjectGraph, weaknesses: List[str]) -> CompletionPlan:
    """
    Generate a CompletionPlan from a ProjectGraph and list of detected weaknesses.
    """
    actions: List[CompletionAction] = []

    _generate_structure_actions(graph, weaknesses, actions)
    _generate_drum_actions(graph, weaknesses, actions)
    _generate_bass_actions(graph, weaknesses, actions)
    _generate_automation_actions(graph, weaknesses, actions)
    _generate_transition_actions(graph, weaknesses, actions)
    _generate_ending_actions(graph, weaknesses, actions)
    _generate_texture_actions(graph, weaknesses, actions)

    # Sort by priority
    priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    actions.sort(key=lambda a: priority_order.get(a.priority, 2))

    # Calculate completion score
    completion_score = _calculate_completion_score(graph, weaknesses)

    # Confidence based on parse quality and number of tracks
    confidence = min(
        0.6 + graph.parse_quality * 0.3 + len(graph.tracks) * 0.01,
        0.95
    )

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


def _generate_structure_actions(graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]) -> None:
    total_bars = graph.arrangement_length or 128.0

    # Check if arrangement is very short
    if total_bars < 64:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Extend Arrangement Length",
            description=f"Current arrangement is only {total_bars:.0f} bars. A full techno track typically runs 128-192 bars for DJ compatibility. Extend the arrangement by repeating groove sections and adding a proper outro.",
            affected_tracks=["All tracks"],
            affected_bars=f"After bar {total_bars:.0f}",
            confidence=0.9,
            expected_impact="high",
            rationale=f"At {total_bars:.0f} bars the track is too short for most DJ contexts (6-8 minutes minimum at {graph.tempo:.0f} BPM).",
            priority="critical",
        ))

    # Check for missing sections
    section_labels = [s.label.lower() for s in graph.sections]
    if not any("outro" in l or "end" in l or "fade" in l for l in section_labels):
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Add Outro / Exit Section",
            description="No outro section detected. Add an 8-16 bar outro that gradually strips back elements, leaving only kick and a fading element to allow DJ mixing out.",
            affected_tracks=["All tracks"],
            affected_bars=f"Bar {max(total_bars - 16, total_bars * 0.9):.0f} to {total_bars:.0f}",
            confidence=0.85,
            expected_impact="high",
            rationale="Tracks without outros are difficult to mix out gracefully in a live DJ context.",
            priority="high",
        ))

    if not any("intro" in l for l in section_labels) and total_bars > 64:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Add Intro Section",
            description="Add an 8-16 bar intro that builds from minimal elements (kick only, or kick+bass) before bringing in the full groove. This gives DJs room to mix in.",
            affected_tracks=["Kick", "Bass"],
            affected_bars="Bar 1 to 16",
            confidence=0.8,
            expected_impact="medium",
            rationale="Intros allow beatmatching and smooth mixing in from previous track.",
            priority="high",
        ))

    if not any("breakdown" in l for l in section_labels):
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="structure",
            title="Add Breakdown Section",
            description="Insert a 16-32 bar breakdown that removes the kick and bass, keeping only atmospheric elements. This creates contrast and anticipation before the drop.",
            affected_tracks=["Kick", "Bass", "Texture/Drone tracks"],
            affected_bars="Midpoint of arrangement",
            confidence=0.75,
            expected_impact="high",
            rationale="Breakdowns are essential for energy management in a DJ set context.",
            priority="high",
        ))


def _generate_drum_actions(graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]) -> None:
    kick_tracks = [t for t in graph.all_tracks if t.inferred_role == "kick"]
    hat_tracks = [t for t in graph.all_tracks if t.inferred_role == "hihat"]
    perc_tracks = [t for t in graph.all_tracks if t.inferred_role == "percussion"]

    if not kick_tracks:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="drums",
            title="Add or Identify Kick Track",
            description="No kick drum track was confidently detected. Add a kick MIDI/audio track with a 4-on-the-floor pattern. Consider layering a sub punch (50-80Hz) with a click transient.",
            affected_tracks=["New kick track"],
            confidence=0.88,
            expected_impact="critical",
            rationale="A kick is the rhythmic foundation of all techno music.",
            priority="critical",
        ))

    if hat_tracks:
        static_hats = [t for t in hat_tracks if any("Static hi-hat" in w for w in t.warnings)]
        if static_hats:
            track_names = [t.name for t in static_hats]
            actions.append(CompletionAction(
                id=str(uuid.uuid4()),
                category="drums",
                title="Add Hi-Hat Variation",
                description="Hi-hat tracks show static repetition. Add open hi-hat accents on off-beats, ghost notes between the main pattern, or introduce velocity variation to add groove and movement.",
                affected_tracks=track_names,
                confidence=0.82,
                expected_impact="medium",
                rationale="Static hi-hats make a groove feel robotic. Subtle variation creates human feel.",
                priority="medium",
            ))
    else:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="drums",
            title="Add Hi-Hat Layer",
            description="No hi-hat track detected. Add a closed hi-hat on 8th or 16th notes and layer with an open hat on off-beats. Consider a ride for the groove section.",
            affected_tracks=["New hi-hat track"],
            confidence=0.78,
            expected_impact="medium",
            rationale="Hi-hats provide rhythmic density and forward momentum.",
            priority="medium",
        ))

    if len(perc_tracks) < 2:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="drums",
            title="Strengthen Percussion Layer",
            description="Add 1-2 additional percussion tracks (shakers, congas, industrial percussion, or noise bursts) to create rhythmic complexity. Layer at 1/16th or 1/32nd note offsets from the main groove.",
            affected_tracks=["New percussion tracks"],
            confidence=0.72,
            expected_impact="medium",
            rationale="Techno benefits from layered percussion for hypnotic groove depth.",
            priority="medium",
        ))


def _generate_bass_actions(graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]) -> None:
    bass_tracks = [t for t in graph.all_tracks if t.inferred_role in ("bass", "rumble")]

    if not bass_tracks:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="bass",
            title="Add Bass / Sub Element",
            description="No bass track detected. Add a sub bass (30-80Hz) that locks to the kick pattern or runs a continuous groove. Consider a single-note bass with filter automation for movement.",
            affected_tracks=["New bass track"],
            confidence=0.9,
            expected_impact="high",
            rationale="Sub bass provides low-end weight and energy on large sound systems.",
            priority="high",
        ))
        return

    bass_with_gaps = [t for t in bass_tracks if any("Gap" in w for w in t.warnings)]
    if bass_with_gaps:
        track_names = [t.name for t in bass_with_gaps]
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="bass",
            title="Fill Bass Coverage Gaps",
            description=f"Bass tracks have gaps in arrangement coverage. Extend clips or add transitional bass elements to maintain low-end continuity throughout the track.",
            affected_tracks=track_names,
            confidence=0.85,
            expected_impact="high",
            rationale="Gaps in bass coverage create uncomfortable 'holes' on a club sound system.",
            priority="high",
        ))

    # Suggest bass automation
    bass_with_no_auto = [t for t in bass_tracks if len(t.automation_lanes) == 0]
    if bass_with_no_auto:
        track_names = [t.name for t in bass_with_no_auto]
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="bass",
            title="Add Bass Filter Automation",
            description="Add filter cutoff automation to the bass track to create movement and energy changes. A low-pass filter opening from 200Hz to 800Hz creates a classic techno energy build.",
            affected_tracks=track_names,
            confidence=0.8,
            expected_impact="medium",
            rationale="Filter automation on bass is a primary tool for energy management in techno.",
            priority="medium",
        ))


def _generate_automation_actions(graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]) -> None:
    static_weakness = any("static" in w.lower() or "no automation" in w.lower() for w in weaknesses)

    if static_weakness:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="automation",
            title="Add Filter Sweep Automation",
            description="Automate filter cutoff on key tracks through section transitions. Build from fully closed to 60-70% open over 4-8 bars leading into the drop, and close again entering the breakdown.",
            affected_tracks=["Synth tracks", "Bass tracks"],
            confidence=0.85,
            expected_impact="high",
            rationale="Filter sweeps are the primary energy tool in techno and are expected by listeners.",
            priority="high",
        ))

        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="automation",
            title="Add Send Level Automation",
            description="Automate reverb/delay send amounts on key elements. Throw reverb sends up during breakdowns and transition moments to create space and anticipation.",
            affected_tracks=["Reverb/Delay return tracks"],
            confidence=0.78,
            expected_impact="medium",
            rationale="Automated send throws create depth and atmosphere essential for techno tension.",
            priority="medium",
        ))

    actions.append(CompletionAction(
        id=str(uuid.uuid4()),
        category="automation",
        title="Add Resonance Automation",
        description="Automate filter resonance on basslines or synth tracks through peak sections. A rising resonance (Q) from 0.5 to 2.0 creates tension and urgency.",
        affected_tracks=["Bass tracks", "Lead synth tracks"],
        confidence=0.72,
        expected_impact="medium",
        rationale="Resonance automation adds harmonic tension absent from purely gain-based dynamics.",
        priority="low",
    ))


def _generate_transition_actions(graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]) -> None:
    weak_transition = any("transition" in w.lower() for w in weaknesses)

    if weak_transition or len(graph.sections) >= 2:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="transitions",
            title="Add Tension Sweeps at Section Boundaries",
            description="Add white noise or filtered sweep risers (4-8 bars) before major section changes. Also add downward pitch automation on synths as the drop hits to create impact.",
            affected_tracks=["New FX/sweep track"],
            confidence=0.82,
            expected_impact="high",
            rationale="Sweeps signal section changes and build anticipation — critical for floor impact.",
            priority="high",
        ))

        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="transitions",
            title="Add Drum Fill at Key Transitions",
            description="Add a 1-2 bar drum fill or roll before each major section change (especially before the drop). A 1/16th to 1/32nd note roll on the snare or clap works well.",
            affected_tracks=["Percussion tracks", "Clap/Snare track"],
            confidence=0.78,
            expected_impact="medium",
            rationale="Fills signal transitions and energize the moment of section change.",
            priority="medium",
        ))


def _generate_ending_actions(graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]) -> None:
    ending_weak = any("ending" in w.lower() or "outro" in w.lower() or "abrupt" in w.lower() for w in weaknesses)

    if ending_weak:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="ending",
            title="Build Outro Strip-Back Sequence",
            description="Create a 16-bar outro where elements drop out gradually: first remove leads and synths (bar 1-4), then percussion (bar 5-8), leaving kick+bass to bar 12, then only kick to bar 16. Fade kick with volume automation.",
            affected_tracks=["All tracks"],
            affected_bars=f"Last 16 bars",
            confidence=0.88,
            expected_impact="high",
            rationale="A proper outro is essential for live DJ mixing — allows smooth transition to the next track.",
            priority="high",
        ))


def _generate_texture_actions(graph: ProjectGraph, weaknesses: List[str], actions: List[CompletionAction]) -> None:
    drone_tracks = [t for t in graph.all_tracks if t.inferred_role in ("drone", "texture")]

    if not drone_tracks:
        actions.append(CompletionAction(
            id=str(uuid.uuid4()),
            category="texture",
            title="Add Atmospheric Drone/Texture",
            description="Add a long, sustained drone or textural layer that runs through breakdown and intro sections. A slowly evolving pad or resampled noise with high reverb works well for dark techno atmospheres.",
            affected_tracks=["New texture/drone track"],
            confidence=0.73,
            expected_impact="medium",
            rationale="Textural layers provide depth and atmosphere, especially in breakdowns.",
            priority="low",
        ))


def _calculate_completion_score(graph: ProjectGraph, weaknesses: List[str]) -> float:
    """Calculate a 0-1 completion score (1 = fully complete)."""
    score = 1.0

    # Penalize for weaknesses
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

    # Boost score for good elements
    has_kick = any(t.inferred_role == "kick" for t in graph.all_tracks)
    has_bass = any(t.inferred_role in ("bass", "rumble") for t in graph.all_tracks)
    has_sections = len(graph.sections) >= 3
    has_automation = any(len(t.automation_lanes) > 0 for t in graph.all_tracks)
    has_returns = len(graph.return_tracks) > 0
    arrangement_ok = graph.arrangement_length >= 64

    if has_kick:
        score = min(score + 0.05, 1.0)
    if has_bass:
        score = min(score + 0.05, 1.0)
    if has_sections:
        score = min(score + 0.05, 1.0)
    if has_automation:
        score = min(score + 0.05, 1.0)
    if has_returns:
        score = min(score + 0.03, 1.0)
    if arrangement_ok:
        score = min(score + 0.05, 1.0)

    return max(round(score, 3), 0.0)


def _build_summary(graph: ProjectGraph, actions: List[CompletionAction], weaknesses: List[str]) -> str:
    style = ", ".join(graph.style_tags[:2]) if graph.style_tags else "techno"
    track_count = len(graph.tracks)
    clip_count = graph.total_clips
    critical_count = len([a for a in actions if a.priority == "critical"])
    high_count = len([a for a in actions if a.priority == "high"])

    return (
        f"Analyzed a {style} project with {track_count} tracks, "
        f"{clip_count} clips, at {graph.tempo:.0f} BPM. "
        f"Found {len(weaknesses)} potential improvements. "
        f"Generated {len(actions)} completion actions "
        f"({critical_count} critical, {high_count} high priority)."
    )


def _build_rationale(graph: ProjectGraph, style_tags: List[str]) -> str:
    style = style_tags[0] if style_tags else "techno"
    return (
        f"This {style} project has been analyzed using rule-based music analysis. "
        f"Completion suggestions are based on: arrangement structure analysis, "
        f"role inference (track type detection without relying on names), "
        f"section energy/density profiling, automation density analysis, "
        f"and genre-specific production conventions for {style}. "
        f"All suggestions include confidence scores based on parse quality "
        f"({graph.parse_quality:.0%}) and detection certainty."
    )
