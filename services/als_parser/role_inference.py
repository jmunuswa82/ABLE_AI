"""
Role Inference Engine.

Determines the musical role of each track without relying on fixed track names.
Uses a combination of:
- Track name heuristics (normalized)
- Device type analysis
- MIDI note range analysis  
- Clip pattern analysis
- Position in track hierarchy
"""

from __future__ import annotations

import re
from typing import List, Tuple, Dict
from .models import TrackNode, DeviceNode


ROLE_KEYWORDS: Dict[str, List[str]] = {
    "kick": ["kick", "kik", "bd", "bass drum", "bassdrum", "k1", "bd1", "k_"],
    "snare": ["snare", "sn", "snr", "sd", "clap", "rimshot"],
    "hihat": ["hat", "hh", "hihat", "hi-hat", "cymbal", "cym", "oh", "ch", "openhat", "closedhat"],
    "ride": ["ride", "rd"],
    "clap": ["clap", "clp", "hand", "snap"],
    "percussion": ["perc", "tom", "conga", "bongo", "shaker", "tamb", "rim", "cow", "bell", "woodblock"],
    "bass": ["bass", "sub", "subbass", "bassline", "808", "low end", "lowend", "reese"],
    "rumble": ["rumble", "pulse", "growl", "wobble"],
    "synth_stab": ["stab", "chord", "pluck", "stabs", "chords", "plucks"],
    "lead": ["lead", "melody", "arp", "hook", "riff", "top", "synth"],
    "drone": ["drone", "pad", "texture", "atmo", "atmosphere"],
    "fx": ["fx", "sfx", "sweep", "riser", "crash", "impact", "noise", "wind"],
    "texture": ["texture", "granular", "ambient", "field"],
    "vocal": ["vocal", "voice", "vox", "speak", "acapella", "sample"],
    "return_fx": ["reverb", "verb", "delay", "send", "master"],
    "transition": ["transition", "fill", "roll", "break", "buildup"],
    "utility": ["utility", "bus", "group", "sum", "mix", "master", "vca"],
}


DEVICE_ROLE_HINTS: Dict[str, List[str]] = {
    "drum_machine": ["kick", "percussion", "hihat"],
    "sampler_instrument": ["bass", "percussion", "lead"],
    "synth": ["lead", "bass", "drone", "synth_stab"],
    "reverb": ["return_fx"],
    "delay": ["return_fx"],
}


def infer_track_role(track: TrackNode, all_tracks: List[TrackNode]) -> Tuple[str, float]:
    """
    Returns (role, confidence) for a track.
    """
    name_lower = track.name.lower().strip()
    name_clean = re.sub(r"[^a-z0-9 ]", " ", name_lower)

    # Direct name match
    best_role = "unknown"
    best_score = 0.0

    for role, keywords in ROLE_KEYWORDS.items():
        for kw in keywords:
            if kw in name_clean:
                # Longer matches are more specific
                score = len(kw) / max(1, len(name_clean)) * 2.0 + 0.6
                score = min(score, 0.95)
                if score > best_score:
                    best_score = score
                    best_role = role

    # Device-based boost
    device_classes = [d.device_class.lower() for d in track.devices]
    device_purposes = [d.inferred_purpose for d in track.devices]

    if "drum_machine" in device_purposes or "impulse" in " ".join(device_classes) or "drumrack" in " ".join(device_classes):
        if best_score < 0.5:
            best_role = "percussion"
            best_score = 0.55

    if "synth" in device_purposes and best_score < 0.4:
        if "bass" in name_clean or _is_bass_range(track):
            best_role = "bass"
            best_score = 0.55
        else:
            best_role = "synth_stab"
            best_score = 0.45

    if "sampler_instrument" in device_purposes and best_score < 0.4:
        best_role = "lead"
        best_score = 0.45

    # Return tracks are almost certainly return_fx
    if track.type == "return":
        if best_score < 0.5:
            best_role = "return_fx"
            best_score = 0.85

    # Group tracks
    if track.type == "group":
        if best_score < 0.4:
            # Infer from child track roles
            children = [t for t in all_tracks if t.parent_group_id == track.id]
            child_roles = [infer_track_role(c, all_tracks)[0] for c in children]
            if child_roles:
                from collections import Counter
                most_common = Counter(child_roles).most_common(1)[0][0]
                best_role = f"group_{most_common}"
                best_score = 0.6
            else:
                best_role = "utility"
                best_score = 0.5

    # Position-based hints
    if track.order_index == 0 and best_score < 0.3:
        best_role = "kick"
        best_score = 0.3

    # Low note density + audio track = likely texture or drone
    if track.type == "audio" and len(track.clips) > 0 and best_score < 0.3:
        best_role = "texture"
        best_score = 0.35

    if best_role == "unknown" and best_score < 0.2:
        best_score = 0.2

    return best_role, min(best_score, 1.0)


def _is_bass_range(track: TrackNode) -> bool:
    """Check if MIDI notes are mostly in bass range (below C3 = MIDI 48)."""
    all_notes = []
    for clip in track.clips:
        all_notes.extend(clip.midi_notes)

    if not all_notes:
        return False

    avg_pitch = sum(n.pitch for n in all_notes) / len(all_notes)
    return avg_pitch < 48


def apply_role_inference(tracks: List[TrackNode]) -> None:
    """Apply role inference in-place to all tracks."""
    for track in tracks:
        role, confidence = infer_track_role(track, tracks)
        track.inferred_role = role
        track.inferred_confidence = confidence
