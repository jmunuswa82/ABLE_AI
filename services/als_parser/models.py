"""
Canonical data models for the ALS parser and analysis engine.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class AutomationPoint:
    time: float
    value: float


@dataclass
class AutomationLane:
    target_path: str
    parameter_name: str
    pointee_id: Optional[str] = None
    device_class: Optional[str] = None
    points: List[AutomationPoint] = field(default_factory=list)
    density: float = 0.0
    shape_summary: str = "static"
    confidence: float = 0.5

    def to_dict(self) -> Dict[str, Any]:
        return {
            "targetPath": self.target_path,
            "parameterName": self.parameter_name,
            "pointeeId": self.pointee_id,
            "deviceClass": self.device_class,
            "points": [{"time": p.time, "value": p.value} for p in self.points],
            "density": self.density,
            "shapeSummary": self.shape_summary,
            "confidence": self.confidence,
        }


@dataclass
class DeviceNode:
    id: str
    device_class: str
    plugin_name: Optional[str]
    enabled: bool = True
    inferred_purpose: str = "unknown"
    parameters: Dict[str, Any] = field(default_factory=dict)
    has_sidechain_input: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "deviceClass": self.device_class,
            "pluginName": self.plugin_name,
            "enabled": self.enabled,
            "inferredPurpose": self.inferred_purpose,
            "parameters": self.parameters,
            "hasSidechainInput": self.has_sidechain_input,
        }


@dataclass
class MidiNote:
    pitch: int
    time: float
    duration: float
    velocity: int


@dataclass
class ClipNode:
    id: str
    track_id: str
    clip_type: str
    start: float
    end: float
    loop: bool = False
    source_ref: Optional[str] = None
    midi_notes: List[MidiNote] = field(default_factory=list)
    gain_info: float = 1.0
    content_summary: str = ""
    clip_color: Optional[int] = None
    name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "trackId": self.track_id,
            "clipType": self.clip_type,
            "start": self.start,
            "end": self.end,
            "loop": self.loop,
            "sourceRef": self.source_ref,
            "midiNoteCount": len(self.midi_notes),
            "midiNotes": [{"pitch": n.pitch, "time": n.time, "duration": n.duration, "velocity": n.velocity} for n in self.midi_notes[:128]],
            "gainInfo": self.gain_info,
            "contentSummary": self.content_summary,
            "clipColor": self.clip_color,
            "name": self.name,
        }


@dataclass
class TrackAnalysis:
    role_confidence: float = 0.0
    notes_density: float = 0.0
    automation_activity: float = 0.0
    repetition_score: float = 0.0
    weaknesses: List[str] = field(default_factory=list)


@dataclass
class TrackNode:
    id: str
    name: str
    type: str  # "audio", "midi", "group", "return", "master"
    order_index: int
    parent_group_id: Optional[str] = None
    muted: bool = False
    solo: bool = False
    frozen: bool = False
    armed: bool = False
    color: Optional[int] = None
    devices: List[DeviceNode] = field(default_factory=list)
    clips: List[ClipNode] = field(default_factory=list)
    automation_lanes: List[AutomationLane] = field(default_factory=list)
    inferred_role: str = "unknown"
    inferred_confidence: float = 0.0
    analysis: Optional[TrackAnalysis] = None
    routing: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        total_automation_points = sum(len(al.points) for al in self.automation_lanes)
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "parentGroupId": self.parent_group_id,
            "orderIndex": self.order_index,
            "muted": self.muted,
            "solo": self.solo,
            "frozen": self.frozen,
            "armed": self.armed,
            "color": self.color,
            "inferredRole": self.inferred_role,
            "inferredConfidence": self.inferred_confidence,
            "clipCount": len(self.clips),
            "deviceCount": len(self.devices),
            "automationPoints": total_automation_points,
            "devices": [d.to_dict() for d in self.devices],
            "clips": [c.to_dict() for c in self.clips],
            "automationLanes": [a.to_dict() for a in self.automation_lanes],
            "routing": self.routing,
            "warnings": self.warnings,
        }


@dataclass
class ArrangementSection:
    id: str
    label: str
    start_bar: float
    end_bar: float
    energy_score: float = 0.5
    density_score: float = 0.5
    dominant_roles: List[str] = field(default_factory=list)
    missing_elements: List[str] = field(default_factory=list)
    transition_quality: float = 0.5

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "startBar": self.start_bar,
            "endBar": self.end_bar,
            "energyScore": self.energy_score,
            "densityScore": self.density_score,
            "dominantRoles": self.dominant_roles,
            "missingElements": self.missing_elements,
            "transitionQuality": self.transition_quality,
        }


@dataclass
class SidechainLink:
    source_track_id: str
    target_track_id: str
    source_track_name: str
    target_track_name: str
    device_class: str
    device_id: str
    confidence: float = 0.7
    relation_type: str = "INFERRED_KICK_TO_BASS_DUCK"
    purpose: str = "groove_ducking"
    bars: Optional[List[float]] = None
    automation_evidence: bool = False
    device_evidence: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sourceTrackId": self.source_track_id,
            "targetTrackId": self.target_track_id,
            "sourceTrackName": self.source_track_name,
            "targetTrackName": self.target_track_name,
            "deviceClass": self.device_class,
            "deviceId": self.device_id,
            "confidence": self.confidence,
            "relationType": self.relation_type,
            "purpose": self.purpose,
            "bars": self.bars,
            "automationEvidence": self.automation_evidence,
            "deviceEvidence": self.device_evidence,
        }


@dataclass
class ProjectGraph:
    project_id: str
    source_file: str
    tempo: float = 120.0
    time_signature_numerator: int = 4
    time_signature_denominator: int = 4
    arrangement_length: float = 0.0
    locators: List[Dict[str, Any]] = field(default_factory=list)
    tracks: List[TrackNode] = field(default_factory=list)
    return_tracks: List[TrackNode] = field(default_factory=list)
    master_track: Optional[TrackNode] = None
    sections: List[ArrangementSection] = field(default_factory=list)
    sidechain_links: List[SidechainLink] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    parse_quality: float = 1.0
    style_tags: List[str] = field(default_factory=list)
    raw_fragments: Dict[str, Any] = field(default_factory=dict)

    @property
    def all_tracks(self) -> List[TrackNode]:
        return self.tracks + self.return_tracks

    @property
    def total_clips(self) -> int:
        return sum(len(t.clips) for t in self.all_tracks)

    @property
    def total_devices(self) -> int:
        return sum(len(t.devices) for t in self.all_tracks)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "projectId": self.project_id,
            "tempo": self.tempo,
            "timeSignatureNumerator": self.time_signature_numerator,
            "timeSignatureDenominator": self.time_signature_denominator,
            "arrangementLength": self.arrangement_length,
            "tracks": [t.to_dict() for t in self.tracks],
            "returnTracks": [t.to_dict() for t in self.return_tracks],
            "masterTrackPresent": self.master_track is not None,
            "sections": [s.to_dict() for s in self.sections],
            "parseQuality": self.parse_quality,
            "warnings": self.warnings,
            "styleTags": self.style_tags,
            "totalClips": self.total_clips,
            "totalDevices": self.total_devices,
            "returnTrackCount": len(self.return_tracks),
            "locators": self.locators,
            "sidechainLinks": [s.to_dict() for s in self.sidechain_links],
        }


@dataclass
class MutationPayload:
    """Machine-executable mutation descriptor for a single completion action."""
    mutation_type: str   # "add_clip", "add_automation", "add_locator", "add_sidechain_proposal", "extend_clip"
    target_track_id: Optional[str] = None
    target_track_name: Optional[str] = None
    start_beat: Optional[float] = None
    end_beat: Optional[float] = None
    new_track_name: Optional[str] = None
    new_track_type: Optional[str] = None
    automation_parameter: Optional[str] = None
    automation_points: Optional[List[Dict[str, float]]] = None
    clip_type: Optional[str] = None
    notes: Optional[List[Dict[str, Any]]] = None
    locator_name: Optional[str] = None
    safe: bool = True
    reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mutationType": self.mutation_type,
            "targetTrackId": self.target_track_id,
            "targetTrackName": self.target_track_name,
            "startBeat": self.start_beat,
            "endBeat": self.end_beat,
            "newTrackName": self.new_track_name,
            "newTrackType": self.new_track_type,
            "automationParameter": self.automation_parameter,
            "automationPoints": self.automation_points,
            "clipType": self.clip_type,
            "notes": self.notes,
            "locatorName": self.locator_name,
            "safe": self.safe,
            "reason": self.reason,
        }


@dataclass
class CompletionAction:
    id: str
    category: str
    title: str
    description: str
    affected_tracks: List[str]
    confidence: float
    expected_impact: str
    rationale: str
    priority: str
    affected_bars: Optional[str] = None
    start_beat: Optional[float] = None
    end_beat: Optional[float] = None
    target_track_ids: List[str] = field(default_factory=list)
    creates_new_track: bool = False
    adds_automation: bool = False
    adds_sidechain: bool = False
    mutation_payloads: List[MutationPayload] = field(default_factory=list)
    section_label: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "category": self.category,
            "title": self.title,
            "description": self.description,
            "affectedTracks": self.affected_tracks,
            "affectedBars": self.affected_bars,
            "confidence": self.confidence,
            "expectedImpact": self.expected_impact,
            "rationale": self.rationale,
            "priority": self.priority,
            "startBeat": self.start_beat,
            "endBeat": self.end_beat,
            "targetTrackIds": self.target_track_ids,
            "createsNewTrack": self.creates_new_track,
            "addsAutomation": self.adds_automation,
            "addsSidechain": self.adds_sidechain,
            "mutationPayloads": [m.to_dict() for m in self.mutation_payloads],
            "sectionLabel": self.section_label,
        }


@dataclass
class CompletionPlan:
    project_id: str
    summary: str
    confidence: float
    completion_score: float
    style_tags: List[str]
    actions: List[CompletionAction]
    weaknesses: List[str]
    warnings: List[str]
    rationale: str
    generated_at: str
    mutation_plan_version: str = "1.0.0"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "projectId": self.project_id,
            "summary": self.summary,
            "confidence": self.confidence,
            "completionScore": self.completion_score,
            "styleTags": self.style_tags,
            "actions": [a.to_dict() for a in self.actions],
            "weaknesses": self.weaknesses,
            "warnings": self.warnings,
            "rationale": self.rationale,
            "generatedAt": self.generated_at,
            "mutationPlanVersion": self.mutation_plan_version,
        }
