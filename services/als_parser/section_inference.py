"""
Section Inference Engine.

Detects arrangement sections (intro, groove establishment, build, peak, breakdown, etc.)
even when no locator names are present.

Uses:
- Locator names (if available) 
- Energy and density changes across bars
- Clip density at different arrangement positions
- Track activation patterns
"""

from __future__ import annotations

import uuid
from typing import List, Dict
from .models import ProjectGraph, ArrangementSection, TrackNode


def infer_sections(graph: ProjectGraph) -> List[ArrangementSection]:
    """
    Returns a list of inferred arrangement sections.
    Uses locators if present, otherwise infers from clip patterns.
    """
    # First try locators
    if graph.locators:
        return _sections_from_locators(graph)

    # Otherwise infer from clip density
    return _sections_from_clip_analysis(graph)


def _sections_from_locators(graph: ProjectGraph) -> List[ArrangementSection]:
    """Build sections from named locators."""
    sections = []
    locators = sorted(graph.locators, key=lambda l: l["time"])

    total_length = graph.arrangement_length or 128.0

    for i, loc in enumerate(locators):
        start = loc["time"]
        end = locators[i + 1]["time"] if i + 1 < len(locators) else total_length

        if end <= start:
            continue

        raw_label = loc.get("name", "").strip() or f"Section {i + 1}"
        normalized = _normalize_section_label(raw_label)

        energy, density = _calculate_section_energy(graph, start, end)
        dominant_roles = _get_dominant_roles(graph, start, end)
        missing = _detect_missing_elements(graph, start, end, normalized)
        transition_quality = _assess_transition(graph, start, i)

        sections.append(ArrangementSection(
            id=str(uuid.uuid4()),
            label=normalized,
            start_bar=start,
            end_bar=end,
            energy_score=energy,
            density_score=density,
            dominant_roles=dominant_roles,
            missing_elements=missing,
            transition_quality=transition_quality,
        ))

    return sections


def _sections_from_clip_analysis(graph: ProjectGraph) -> List[ArrangementSection]:
    """Infer sections from clip activation patterns when no locators exist."""
    total_length = graph.arrangement_length or 128.0

    if total_length <= 0:
        return []

    # Divide into windows and analyze density
    window_size = 8.0  # 8 bars per window
    windows = []
    t = 0.0
    while t < total_length:
        end = min(t + window_size, total_length)
        active = _count_active_clips(graph, t, end)
        windows.append((t, end, active))
        t = end

    if not windows:
        return []

    # Find density transitions
    max_density = max(w[2] for w in windows) or 1
    normalized_densities = [w[2] / max_density for w in windows]

    # Group windows into sections by density regime
    sections: List[ArrangementSection] = []
    current_start = 0.0
    current_density_avg = normalized_densities[0]
    segment_windows = [0]

    def finalize_section(start, end, win_indices, section_index):
        avg_dens = sum(normalized_densities[i] for i in win_indices) / len(win_indices)
        label = _infer_section_label_from_position(section_index, len(windows), avg_dens)
        energy, density = _calculate_section_energy(graph, start, end)
        dominant = _get_dominant_roles(graph, start, end)
        missing = _detect_missing_elements(graph, start, end, label)

        return ArrangementSection(
            id=str(uuid.uuid4()),
            label=label,
            start_bar=start,
            end_bar=end,
            energy_score=energy,
            density_score=density,
            dominant_roles=dominant,
            missing_elements=missing,
            transition_quality=0.5,
        )

    section_idx = 0
    for i in range(1, len(windows)):
        delta = abs(normalized_densities[i] - current_density_avg)
        segment_windows.append(i)
        current_density_avg = sum(normalized_densities[j] for j in segment_windows) / len(segment_windows)

        # Detect a significant change (threshold = 0.25) or every 32 bars
        section_end = windows[i][1]
        section_start = windows[segment_windows[0]][0]

        if delta > 0.25 and (section_end - section_start) >= 16:
            sections.append(finalize_section(section_start, section_end, segment_windows, section_idx))
            section_idx += 1
            current_start = section_end
            segment_windows = []
            current_density_avg = normalized_densities[i]

    # Last segment
    if segment_windows:
        start = windows[segment_windows[0]][0]
        end = windows[segment_windows[-1]][1]
        sections.append(finalize_section(start, end, segment_windows, section_idx))

    # If we got nothing meaningful, create a single section
    if not sections:
        sections = [ArrangementSection(
            id=str(uuid.uuid4()),
            label="Arrangement",
            start_bar=0.0,
            end_bar=total_length,
            energy_score=0.5,
            density_score=0.5,
            dominant_roles=[],
            missing_elements=["section structure unclear"],
            transition_quality=0.5,
        )]

    return sections


def _count_active_clips(graph: ProjectGraph, start: float, end: float) -> int:
    count = 0
    for track in graph.all_tracks:
        for clip in track.clips:
            if clip.start < end and clip.end > start:
                count += 1
    return count


def _calculate_section_energy(graph: ProjectGraph, start: float, end: float):
    """Returns (energy_score, density_score) as floats 0-1."""
    active_tracks = 0
    total_tracks = len(graph.all_tracks)

    kick_active = False
    bass_active = False
    total_clips_in_section = 0

    for track in graph.all_tracks:
        track_clips_in_section = [c for c in track.clips if c.start < end and c.end > start]
        if track_clips_in_section:
            active_tracks += 1
            total_clips_in_section += len(track_clips_in_section)

        if track.inferred_role == "kick" and track_clips_in_section:
            kick_active = True
        if track.inferred_role == "bass" and track_clips_in_section:
            bass_active = True

    density = (active_tracks / max(1, total_tracks))
    energy = density

    if kick_active:
        energy = min(energy + 0.2, 1.0)
    if bass_active:
        energy = min(energy + 0.1, 1.0)

    return round(energy, 3), round(density, 3)


def _get_dominant_roles(graph: ProjectGraph, start: float, end: float) -> List[str]:
    role_counts: Dict[str, int] = {}
    for track in graph.all_tracks:
        for clip in track.clips:
            if clip.start < end and clip.end > start:
                role = track.inferred_role
                role_counts[role] = role_counts.get(role, 0) + 1

    sorted_roles = sorted(role_counts.items(), key=lambda x: x[1], reverse=True)
    return [r for r, _ in sorted_roles[:4] if r != "unknown"]


def _detect_missing_elements(graph: ProjectGraph, start: float, end: float, label: str) -> List[str]:
    missing = []

    roles_present = set(_get_dominant_roles(graph, start, end))

    # In a groove/peak section, expect kick and bass
    if any(k in label.lower() for k in ["groove", "peak", "drop", "build"]):
        if "kick" not in roles_present:
            missing.append("kick drum absent")
        if "bass" not in roles_present and "rumble" not in roles_present:
            missing.append("bass element absent")

    # Breakdown should have no or light kick
    if "breakdown" in label.lower():
        if "lead" not in roles_present and "drone" not in roles_present:
            missing.append("breakdown texture absent")

    # Always check for automation
    tracks_in_section = []
    for track in graph.all_tracks:
        clips_in_section = [c for c in track.clips if c.start < end and c.end > start]
        if clips_in_section:
            tracks_in_section.append(track)

    total_auto = sum(len(t.automation_lanes) for t in tracks_in_section)
    if total_auto == 0 and len(tracks_in_section) > 2:
        missing.append("no automation in section")

    return missing


def _assess_transition(graph: ProjectGraph, position: float, section_index: int) -> float:
    """Assess transition quality entering this section. Returns 0-1."""
    if section_index == 0:
        return 0.8  # Intro has no incoming transition to assess

    # Check for FX/transition tracks near this boundary
    transition_window = 4.0  # 4 bars around the transition
    has_transition_element = False

    for track in graph.all_tracks:
        if track.inferred_role in ("fx", "transition", "return_fx"):
            for clip in track.clips:
                if abs(clip.start - position) < transition_window or abs(clip.end - position) < transition_window:
                    has_transition_element = True
                    break

    return 0.75 if has_transition_element else 0.35


def _normalize_section_label(raw: str) -> str:
    """Map raw locator names to standard section labels."""
    lower = raw.lower().strip()

    mappings = {
        ("intro", "start", "begin"): "Intro",
        ("groove", "main", "body", "loop"): "Groove Establishment",
        ("build", "buildup", "riser", "tension", "pre"): "Build",
        ("drop", "peak", "climax", "full", "break in"): "Peak",
        ("breakdown", "break", "bd", "stripped", "sparse"): "Breakdown",
        ("recovery", "recover", "regroup"): "Recovery",
        ("second peak", "peak 2", "drop 2", "second drop"): "Second Peak",
        ("outro", "end", "out", "fade", "close"): "Outro",
    }

    for keys, label in mappings.items():
        if any(k in lower for k in keys):
            return label

    return raw.title()


def _infer_section_label_from_position(section_idx: int, total_sections: int, avg_density: float) -> str:
    """Infer section label based on position in arrangement."""
    ratio = section_idx / max(1, total_sections - 1)

    if ratio <= 0.1:
        return "Intro"
    elif ratio <= 0.25:
        return "Groove Establishment"
    elif ratio <= 0.45:
        return "Build" if avg_density < 0.6 else "Groove"
    elif ratio <= 0.6:
        return "Peak"
    elif ratio <= 0.7:
        return "Breakdown"
    elif ratio <= 0.85:
        return "Recovery"
    elif ratio <= 0.95:
        return "Second Peak"
    else:
        return "Outro"
