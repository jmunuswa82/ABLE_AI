"""
Style Inference Engine.

Infers weighted style tags from:
- BPM
- Note density / rhythmic spacing
- Section energy behavior
- Device types
- Naming hints
- Track count and roles
"""

from __future__ import annotations

from typing import List, Dict, Tuple
from .models import ProjectGraph, TrackNode


def infer_style_tags(graph: ProjectGraph) -> List[str]:
    """
    Returns a list of style tags ranked by confidence.
    Multiple tags can apply with different weights.
    """
    scores: Dict[str, float] = {}

    tempo = graph.tempo

    # BPM-based primary style inference
    if 130 <= tempo <= 145:
        _add(scores, "hypnotic techno", 0.5)
        _add(scores, "minimal techno", 0.4)
    elif 145 < tempo <= 155:
        _add(scores, "driving groove techno", 0.5)
        _add(scores, "hypnotic techno", 0.35)
    elif 155 < tempo <= 165:
        _add(scores, "hard techno", 0.6)
        _add(scores, "driving groove techno", 0.3)
    elif 165 < tempo <= 175:
        _add(scores, "hard techno", 0.7)
        _add(scores, "industrial techno", 0.4)
    elif tempo > 175:
        _add(scores, "industrial techno", 0.7)
        _add(scores, "raw techno", 0.5)
    elif 120 <= tempo < 130:
        _add(scores, "atmospheric techno", 0.5)
        _add(scores, "minimal techno", 0.4)

    # All tracks analysis
    all_tracks = graph.all_tracks
    roles = [t.inferred_role for t in all_tracks]

    # Count roles
    kick_tracks = roles.count("kick")
    bass_tracks = roles.count("bass")
    percussion_tracks = roles.count("percussion")
    drone_tracks = roles.count("drone")
    lead_tracks = roles.count("lead")
    fx_tracks = roles.count("fx")
    return_tracks_count = len(graph.return_tracks)
    texture_tracks = roles.count("texture")

    # Device type analysis
    all_device_purposes = []
    for t in all_tracks:
        all_device_purposes.extend(d.inferred_purpose for d in t.devices)

    reverb_count = all_device_purposes.count("reverb")
    delay_count = all_device_purposes.count("delay")
    dynamics_count = all_device_purposes.count("dynamics")

    # Warehouse / dark techno = lots of reverb, drones, low tempo
    if drone_tracks >= 2 or texture_tracks >= 2:
        _add(scores, "dark warehouse techno", 0.5)
        _add(scores, "atmospheric techno", 0.4)

    if reverb_count >= 3:
        _add(scores, "dark warehouse techno", 0.3)
        _add(scores, "atmospheric techno", 0.3)

    # Minimal = few tracks, repetitive
    total_active = len([t for t in all_tracks if len(t.clips) > 0])
    if total_active <= 6:
        _add(scores, "minimal techno", 0.4)
    elif total_active >= 14:
        _add(scores, "driving groove techno", 0.3)

    # Industrial = distortion devices heavy
    distortion_count = sum(1 for p in all_device_purposes if "distortion" in p or "modulation" in p)
    if distortion_count >= 3:
        _add(scores, "industrial techno", 0.4)
        _add(scores, "raw techno", 0.3)

    # Name hints
    name_hints = " ".join(t.name.lower() for t in all_tracks)
    if any(k in name_hints for k in ["raw", "acid", "trash", "brutal"]):
        _add(scores, "raw techno", 0.5)
    if any(k in name_hints for k in ["warehouse", "bunker", "dark"]):
        _add(scores, "dark warehouse techno", 0.5)
    if any(k in name_hints for k in ["hard", "rave"]):
        _add(scores, "hard techno", 0.4)
    if any(k in name_hints for k in ["minimal", "loop", "groove"]):
        _add(scores, "minimal techno", 0.4)

    # Automation density
    total_auto_points = sum(
        sum(len(al.points) for al in t.automation_lanes)
        for t in all_tracks
    )
    if total_auto_points > 200:
        _add(scores, "hypnotic techno", 0.2)

    # Sort by score, take top 3
    sorted_tags = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    top_tags = [tag for tag, score in sorted_tags if score >= 0.3][:4]

    if not top_tags:
        top_tags = ["techno"]

    return top_tags


def _add(scores: Dict[str, float], tag: str, value: float) -> None:
    scores[tag] = scores.get(tag, 0.0) + value
