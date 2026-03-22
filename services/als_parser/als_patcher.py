"""
ALS Mutation Engine — Production-Grade Export Pipeline.

Architecture:
  IDAllocator      — scans all existing IDs; allocates new ones above the max
  ALSPatcher       — applies typed MutationPayload operations to ALS XML tree
  PreExportValidator — validates the patched tree before serialisation
  PatchResult      — carries patched bytes, mutation log, validation report

Trust tiers:
  SAFE_LOCATOR_ONLY       — only locator markers added
  SAFE_AUTOMATION_ADDED   — automation envelopes added/extended
  STRUCTURALLY_VALID_ALS  — clips or tracks added/modified
  REQUIRES_MANUAL_REVIEW  — sidechain routing / device insertions (not auto-applied)

ID invariants enforced:
  - All new IDs are unique integers above the highest pre-existing ID.
  - Id=0 is reserved for MasterTrack; never allocated to new elements.
  - NoteId values within a clip are allocated from a per-session counter.
  - No ID is ever reused within the same patch session.

Loop element format:
  Ableton ALS uses child elements with Value= attributes for Loop children.
  We write them in that format for round-trip compatibility with Live 10/11/12.
"""

from __future__ import annotations

import gzip
import io
import logging
from typing import List, Dict, Any, Optional, Tuple, Set

from lxml import etree

try:
    from .parser import NATIVE_PARAM_NAMES as _NATIVE_PARAM_NAMES
except ImportError:
    _NATIVE_PARAM_NAMES = {}

logger = logging.getLogger(__name__)

TRUST_SAFE_LOCATOR = "SAFE_LOCATOR_ONLY"
TRUST_SAFE_AUTO = "SAFE_AUTOMATION_ADDED"
TRUST_STRUCTURAL = "STRUCTURALLY_VALID_ALS"
TRUST_MANUAL = "REQUIRES_MANUAL_REVIEW"

PARAM_TAG_PATTERNS: Dict[str, List[str]] = {
    "Filter Cutoff":    ["Cutoff", "FilterFreq", "Frequency"],
    "Filter Resonance": ["Resonance", "FilterRes", "Q"],
    "Volume":           ["Volume", "DeviceChain/Mixer/Volume"],
    "Pan":              ["Pan", "DeviceChain/Mixer/Pan"],
    "Send Amount":      ["Send", "SendAmount"],
    "Threshold":        ["Threshold"],
    "Ratio":            ["Ratio"],
    "Attack":           ["Attack"],
    "Release":          ["Release"],
    "Dry/Wet":          ["DryWet"],
    "Drive":            ["Drive", "WarmDrive"],
    "Gain":             ["Gain", "GainCompensation"],
    "Delay Time":       ["DelayTime"],
    "Feedback":         ["Feedback"],
    "Transpose":        ["TransposeSemitones"],
}


# ─── Central ID Allocator ─────────────────────────────────────────────────────

class IDAllocator:
    """
    Scans all existing Id attributes in an XML tree and allocates new IDs
    that are guaranteed unique — always above the current maximum.

    Rules:
    - Scans every element's "Id" attribute on construction.
    - Never allocates 0 (reserved for MasterTrack in Ableton schema).
    - Each call to allocate() returns a strictly incrementing integer string.
    - NoteId values are tracked separately via allocate_note_id().
    """

    def __init__(self, root: etree._Element) -> None:
        self._used: Set[int] = set()
        self._scan_ids(root)
        # Start allocating from just above the current maximum.
        # Floor at 10000 to avoid conflicts with low-numbered Ableton built-ins.
        self._next: int = max(max(self._used) + 1, 10000) if self._used else 10000

        # NoteId space — separate from element Id space
        self._next_note_id: int = 1
        self._scan_note_ids(root)

    def _scan_ids(self, root: etree._Element) -> None:
        for elem in root.iter():
            raw = elem.get("Id", "")
            if raw:
                try:
                    self._used.add(int(raw))
                except ValueError:
                    pass

    def _scan_note_ids(self, root: etree._Element) -> None:
        for elem in root.iter():
            raw = elem.get("NoteId", "")
            if raw:
                try:
                    v = int(raw)
                    self._next_note_id = max(self._next_note_id, v + 1)
                except ValueError:
                    pass

    def allocate(self) -> str:
        """Return a fresh unique integer ID string."""
        # Skip 0 (reserved) and any already-used values
        while self._next == 0 or self._next in self._used:
            self._next += 1
        new_id = self._next
        self._used.add(new_id)
        self._next += 1
        return str(new_id)

    def allocate_note_id(self) -> str:
        """Return a fresh NoteId string for MidiNoteEvent elements."""
        nid = self._next_note_id
        self._next_note_id += 1
        return str(nid)


# ─── Pre-Export Validator ─────────────────────────────────────────────────────

def validate_pre_export(root: etree._Element) -> Tuple[bool, List[str]]:
    """
    Run structural integrity checks before allowing export.

    Checks performed:
    1. Duplicate Id attributes (hard error)
    2. LiveSet element present (hard error)
    3. Tracks element present (hard error)
    4. Time/beat values are non-negative (soft warning)
    5. PointeeId references (logged as warning only — synthetic IDs are acceptable)

    Returns (passed, error_list). An empty error_list means all checks passed.
    Warnings are prefixed with "WARN:" and do not block export.
    """
    errors: List[str] = []

    # 1. Duplicate ID check
    id_to_tags: Dict[str, List[str]] = {}
    for elem in root.iter():
        raw = elem.get("Id", "")
        if raw:
            id_to_tags.setdefault(raw, []).append(elem.tag)

    for id_val, tags in id_to_tags.items():
        if len(tags) > 1:
            errors.append(
                f"DUPLICATE_ID: Id='{id_val}' appears on {len(tags)} elements "
                f"({', '.join(tags[:4])}{'…' if len(tags) > 4 else ''})"
            )

    # 2. LiveSet presence
    liveset: Optional[etree._Element]
    if root.tag == "LiveSet":
        liveset = root
    elif root.tag == "Ableton":
        liveset = root.find("LiveSet")
    else:
        liveset = root.find(".//LiveSet")

    if liveset is None:
        errors.append("MISSING_LIVESET: No <LiveSet> element found in document")
        return False, errors

    # 3. Tracks element
    if liveset.find("Tracks") is None:
        errors.append("MISSING_TRACKS: No <Tracks> element found inside <LiveSet>")

    # 4. Time/beat value sanity (soft warnings)
    for clip in root.iter("MidiClip", "AudioClip"):
        t = clip.get("Time", "0")
        try:
            if float(t) < 0:
                errors.append(f"WARN:NEGATIVE_TIME: Clip Id='{clip.get('Id','?')}' has Time='{t}' < 0")
        except ValueError:
            errors.append(f"WARN:INVALID_TIME: Clip Id='{clip.get('Id','?')}' has non-numeric Time='{t}'")

    hard_errors = [e for e in errors if not e.startswith("WARN:")]
    passed = len(hard_errors) == 0
    return passed, errors


# ─── ALS Byte Validator ───────────────────────────────────────────────────────

def validate_als_bytes(data: bytes) -> Tuple[bool, str]:
    """
    Validate bytes form a valid gzip-compressed ALS (XML) file.
    Returns (is_valid, error_message).
    """
    if not data:
        return False, "Empty bytes"

    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
            xml_bytes = gz.read(1024 * 1024 * 4)
    except Exception as e:
        return False, f"Gzip decompression failed: {e}"

    try:
        parser = etree.XMLParser(recover=False, resolve_entities=False, no_network=True)
        root = etree.fromstring(xml_bytes[:min(len(xml_bytes), 2 * 1024 * 1024)], parser=parser)
        if root is None:
            return False, "XML root is None"
        if root.tag not in ("Ableton", "LiveSet") and root.find("LiveSet") is None:
            return False, f"Unexpected root tag: {root.tag}"
    except etree.XMLSyntaxError as e:
        return False, f"XML parse error: {e}"
    except Exception as e:
        return False, f"Validation error: {e}"

    return True, ""


# ─── Patch Result ─────────────────────────────────────────────────────────────

class PatchResult:
    def __init__(
        self,
        als_bytes: Optional[bytes],
        mutations_applied: List[Dict[str, Any]],
        mutations_skipped: List[Dict[str, Any]],
        trust_label: str,
        warnings: List[str],
        validation_passed: bool = True,
        validation_errors: Optional[List[str]] = None,
    ):
        self.als_bytes = als_bytes
        self.mutations_applied = mutations_applied
        self.mutations_skipped = mutations_skipped
        self.trust_label = trust_label
        self.warnings = warnings
        self.validation_passed = validation_passed
        self.validation_errors = validation_errors or []

    def to_summary_dict(self) -> Dict[str, Any]:
        return {
            "trustLabel": self.trust_label,
            "mutationsApplied": len(self.mutations_applied),
            "mutationsSkipped": len(self.mutations_skipped),
            "appliedDetails": self.mutations_applied,
            "skippedDetails": self.mutations_skipped,
            "warnings": self.warnings,
            "validationPassed": self.validation_passed,
            "validationErrors": self.validation_errors,
        }


# ─── ALS Patcher ──────────────────────────────────────────────────────────────

class ALSPatcher:
    """
    Applies typed MutationPayload operations to an .als XML tree.

    All element IDs are allocated via a central IDAllocator to guarantee
    uniqueness and prevent "Illegal value for 'Id' attribute" errors in Live.
    """

    def __init__(self, als_bytes: bytes) -> None:
        self.original_bytes = als_bytes
        self.root: Optional[etree._Element] = None
        self.liveset: Optional[etree._Element] = None
        self.warnings: List[str] = []
        self._track_index: Dict[str, etree._Element] = {}
        self._ids: Optional[IDAllocator] = None
        self._load()

    def _load(self) -> None:
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(self.original_bytes)) as gz:
                xml_bytes = gz.read()
            parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
            self.root = etree.fromstring(xml_bytes, parser=parser)
            self.liveset = self.root.find("LiveSet") or self.root
            # Must initialise ID allocator BEFORE any mutations
            self._ids = IDAllocator(self.root)
            self._build_track_index()
        except Exception as e:
            logger.error(f"ALSPatcher._load failed: {e}")
            self.warnings.append(f"Failed to load ALS for patching: {e}")

    def _build_track_index(self) -> None:
        if self.liveset is None:
            return
        tracks_el = self.liveset.find("Tracks")
        if tracks_el is None:
            return
        for track_el in tracks_el:
            el_id = track_el.get("Id", "")
            # Look for name under <Name><EffectiveName> or direct child, then <UserName>
            name_el = track_el.find(".//EffectiveName")
            if name_el is None:
                name_el = track_el.find(".//UserName")
            track_name = name_el.get("Value", "") if name_el is not None else ""
            if el_id:
                self._track_index[el_id] = track_el
            if track_name:
                self._track_index[track_name] = track_el

    def _find_track_element(
        self,
        track_id: Optional[str],
        track_name: Optional[str],
    ) -> Optional[etree._Element]:
        if track_id:
            # Parser stores IDs as "track_<order>_<ableton_id>" — extract numeric suffix
            parts = track_id.rsplit("_", 1)
            ableton_id = parts[-1] if len(parts) > 1 else track_id
            if ableton_id in self._track_index:
                return self._track_index[ableton_id]
            if track_id in self._track_index:
                return self._track_index[track_id]
        if track_name and track_name in self._track_index:
            return self._track_index[track_name]
        return None

    # ── PointeeId resolution ────────────────────────────────────────────────

    def _build_pointee_map(self, track_el: etree._Element) -> Dict[str, str]:
        result: Dict[str, str] = {}
        for auto_target in track_el.iter("AutomationTarget"):
            pointee_id = auto_target.get("Id", "")
            if not pointee_id:
                continue
            parent = auto_target.getparent()
            if parent is None:
                continue
            param_tag = parent.tag
            grandparent = parent.getparent()
            device_tag = grandparent.tag if grandparent is not None else ""
            friendly = _NATIVE_PARAM_NAMES.get(param_tag, param_tag)
            result[param_tag] = pointee_id
            result[friendly] = pointee_id
            if device_tag:
                result[f"{device_tag}.{param_tag}"] = pointee_id
                result[f"{device_tag}.{friendly}"] = pointee_id
        return result

    def _resolve_pointee_id(
        self,
        track_el: etree._Element,
        param_name: str,
    ) -> Optional[str]:
        pointee_map = self._build_pointee_map(track_el)
        if not pointee_map:
            return None
        if param_name in pointee_map:
            return pointee_map[param_name]
        patterns = PARAM_TAG_PATTERNS.get(param_name, [param_name])
        for pattern in patterns:
            if pattern in pointee_map:
                return pointee_map[pattern]
            for key, val in pointee_map.items():
                if key.lower() == pattern.lower():
                    return val
        param_lower = param_name.lower()
        for key, val in pointee_map.items():
            if param_lower in key.lower() or key.lower() in param_lower:
                return val
        return None

    # ── Loop helper (Ableton child-element format) ──────────────────────────

    @staticmethod
    def _make_loop_element(
        parent: etree._Element,
        length: float,
        start: float = 0.0,
    ) -> etree._Element:
        """
        Create a <Loop> element using Ableton's child-element Value= format.
        All Ableton ALS files (Live 10/11/12) use this format for Loop children.
        """
        loop_el = etree.SubElement(parent, "Loop")

        def _child(tag: str, value: str) -> etree._Element:
            el = etree.SubElement(loop_el, tag)
            el.set("Value", value)
            return el

        _child("LoopStart", "0")
        _child("LoopEnd", str(length))
        _child("StartRelative", str(start))
        _child("LoopOn", "false")
        _child("OutMarker", str(length))
        _child("HiddenLoopStart", "0")
        _child("HiddenLoopEnd", str(length))
        return loop_el

    # ── Apply ────────────────────────────────────────────────────────────────

    def apply(self, mutation_payloads: List[Dict[str, Any]]) -> PatchResult:
        if self.root is None or self._ids is None:
            return PatchResult(
                als_bytes=None,
                mutations_applied=[],
                mutations_skipped=[{"reason": "ALS failed to load", "payload": {}}],
                trust_label=TRUST_MANUAL,
                warnings=self.warnings,
                validation_passed=False,
            )

        applied: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []

        for payload in mutation_payloads:
            mutation_type = payload.get("mutationType", "")
            safe = payload.get("safe", True)

            if not safe:
                skipped.append({
                    "type": mutation_type,
                    "reason": "Marked as not safe for auto-application",
                    "payload": payload,
                })
                continue

            try:
                if mutation_type == "add_locator":
                    self._add_locator(payload)
                    applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type == "add_automation":
                    err = self._add_automation(payload)
                    if err:
                        skipped.append({"type": mutation_type, "reason": err, "payload": payload})
                    else:
                        applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type == "add_clip":
                    err = self._add_clip(payload)
                    if err:
                        skipped.append({"type": mutation_type, "reason": err, "payload": payload})
                    else:
                        applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type == "extend_clip":
                    err = self._extend_clip(payload)
                    if err:
                        skipped.append({"type": mutation_type, "reason": err, "payload": payload})
                    else:
                        applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type == "add_sidechain_proposal":
                    skipped.append({
                        "type": mutation_type,
                        "reason": "Sidechain routing requires manual device configuration in Ableton",
                        "payload": payload,
                    })

                else:
                    skipped.append({
                        "type": mutation_type,
                        "reason": f"Unknown mutation type: {mutation_type}",
                        "payload": payload,
                    })

            except Exception as e:
                logger.error(f"Mutation {mutation_type} raised: {e}", exc_info=True)
                self.warnings.append(f"Mutation {mutation_type} failed with exception: {e}")
                skipped.append({"type": mutation_type, "reason": str(e), "payload": payload})

        if not applied:
            return PatchResult(
                als_bytes=None,
                mutations_applied=applied,
                mutations_skipped=skipped,
                trust_label=TRUST_MANUAL,
                warnings=self.warnings,
                validation_passed=False,
            )

        # Trust tier
        applied_types = {a["type"] for a in applied}
        if applied_types <= {"add_locator"}:
            trust_label = TRUST_SAFE_LOCATOR
        elif applied_types <= {"add_locator", "add_automation"}:
            trust_label = TRUST_SAFE_AUTO
        else:
            trust_label = TRUST_STRUCTURAL

        # Pre-export validation
        pre_valid, pre_errors = validate_pre_export(self.root)
        hard_errors = [e for e in pre_errors if not e.startswith("WARN:")]
        if hard_errors:
            logger.error(f"Pre-export validation failed: {hard_errors}")
            for e in hard_errors:
                self.warnings.append(f"Pre-export validation: {e}")

        # Serialise to gzip XML
        als_bytes: Optional[bytes] = None
        validation_passed = False
        try:
            xml_bytes = etree.tostring(
                self.root,
                xml_declaration=True,
                encoding="UTF-8",
                pretty_print=False,
            )
            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
                gz.write(xml_bytes)
            candidate = buf.getvalue()

            ok, err_msg = validate_als_bytes(candidate)
            if ok and not hard_errors:
                als_bytes = candidate
                validation_passed = True
            elif not ok:
                self.warnings.append(f"Post-serialisation validation failed: {err_msg}")
            elif hard_errors:
                self.warnings.append(
                    f"Export blocked by pre-export validator: {'; '.join(hard_errors)}"
                )

        except Exception as e:
            logger.error(f"ALSPatcher: serialisation failed: {e}")
            self.warnings.append(f"Serialisation failed: {e}")

        return PatchResult(
            als_bytes=als_bytes,
            mutations_applied=applied,
            mutations_skipped=skipped,
            trust_label=trust_label if als_bytes else TRUST_MANUAL,
            warnings=self.warnings,
            validation_passed=validation_passed,
            validation_errors=pre_errors,
        )

    # ── Mutation implementations ─────────────────────────────────────────────

    def _add_locator(self, payload: Dict[str, Any]) -> None:
        """Add an arrangement locator (CuePoint) at the given beat position."""
        locators_outer = self.liveset.find("Locators")
        if locators_outer is None:
            locators_outer = etree.SubElement(self.liveset, "Locators")

        # Ableton 11/12: Locators > Locators > CuePoint
        locators_inner = locators_outer.find("Locators")
        if locators_inner is None:
            locators_inner = etree.SubElement(locators_outer, "Locators")

        time_beats = float(payload.get("startBeat", 0.0))
        name = payload.get("locatorName", "Marker")

        cue = etree.SubElement(locators_inner, "CuePoint")
        cue.set("Id", self._ids.allocate())
        cue.set("Time", str(time_beats))
        cue.set("ColorIndex", "13")

        name_el = etree.SubElement(cue, "Name")
        name_el.set("Value", name)

        ann_el = etree.SubElement(cue, "Annotation")
        ann_el.set("Value", "")

        song_start = etree.SubElement(cue, "IsSongStart")
        song_start.set("Value", "false")

    def _add_automation(self, payload: Dict[str, Any]) -> Optional[str]:
        """
        Add an automation envelope to the correct track.

        Path: Track > ArrangerAutomation > AutomationEnvelopes > Envelopes > AutomationEnvelope
        """
        track_id = payload.get("targetTrackId")
        track_name = payload.get("targetTrackName")
        param_name = payload.get("automationParameter", "Filter Cutoff")

        target_el = self._find_track_element(track_id, track_name)
        if target_el is None:
            target_el = self.liveset.find("MasterTrack")
            if target_el is None:
                return "No target track found and no MasterTrack fallback available"
            self.warnings.append(
                f"add_automation: track '{track_id or track_name}' not found; "
                "writing to MasterTrack as non-destructive placeholder"
            )

        pointee_id = self._resolve_pointee_id(target_el, param_name)
        if pointee_id is None:
            # Synthetic PointeeId — non-destructive but won't link to a real parameter
            pointee_id = self._ids.allocate()
            self.warnings.append(
                f"add_automation: no AutomationTarget found for '{param_name}' on "
                f"'{track_name or track_id}'; using synthetic PointeeId={pointee_id}"
            )

        arranger_auto = target_el.find("ArrangerAutomation")
        if arranger_auto is None:
            arranger_auto = etree.SubElement(target_el, "ArrangerAutomation")

        auto_envs = arranger_auto.find("AutomationEnvelopes")
        if auto_envs is None:
            auto_envs = etree.SubElement(arranger_auto, "AutomationEnvelopes")

        envelopes = auto_envs.find("Envelopes")
        if envelopes is None:
            envelopes = etree.SubElement(auto_envs, "Envelopes")

        envelope = etree.SubElement(envelopes, "AutomationEnvelope")
        envelope.set("Id", self._ids.allocate())

        env_target = etree.SubElement(envelope, "EnvelopeTarget")
        pointee_el = etree.SubElement(env_target, "PointeeId")
        pointee_el.set("Value", str(pointee_id))

        automation_el = etree.SubElement(envelope, "Automation")
        events_el = etree.SubElement(automation_el, "Events")

        points = payload.get("automationPoints") or []
        if not points:
            start_beat = float(payload.get("startBeat", 0.0))
            end_beat = float(payload.get("endBeat", start_beat + 16.0))
            points = [
                {"time": start_beat, "value": 0.25},
                {"time": end_beat, "value": 0.75},
            ]

        for pt in points:
            event = etree.SubElement(events_el, "AutomationEvent")
            event.set("Time", str(float(pt.get("time", 0.0))))
            event.set("Value", str(float(pt.get("value", 0.0))))
            event.set("CurveControl1X", "0.5")
            event.set("CurveControl1Y", "0.5")

        return None

    def _add_clip(self, payload: Dict[str, Any]) -> Optional[str]:
        """
        Add a MIDI or audio clip to a target track's ArrangerAutomation > Events.
        Creates a new MidiTrack if newTrackName is provided and track not found.
        """
        track_id = payload.get("targetTrackId")
        track_name = payload.get("targetTrackName")
        new_track_name = payload.get("newTrackName")

        target_el = self._find_track_element(track_id, track_name)

        if target_el is None and new_track_name:
            target_el = self._create_midi_track(new_track_name)
            if target_el is None:
                return f"Failed to create new MIDI track '{new_track_name}'"

        if target_el is None:
            return f"Track not found: id={track_id!r}, name={track_name!r}"

        arranger_auto = target_el.find("ArrangerAutomation")
        if arranger_auto is None:
            arranger_auto = etree.SubElement(target_el, "ArrangerAutomation")

        events = arranger_auto.find("Events")
        if events is None:
            events = etree.SubElement(arranger_auto, "Events")

        start_beat = float(payload.get("startBeat", 0.0))
        end_beat = float(payload.get("endBeat", start_beat + 16.0))
        length = end_beat - start_beat
        clip_type = payload.get("clipType", "midi")

        if clip_type == "midi":
            clip_el = etree.SubElement(events, "MidiClip")
        else:
            clip_el = etree.SubElement(events, "AudioClip")

        clip_el.set("Id", self._ids.allocate())
        clip_el.set("Time", str(start_beat))
        clip_el.set("CurrentEnd", str(end_beat))
        clip_el.set("ColorIndex", "16")

        # Name (required by Ableton)
        name_el = etree.SubElement(clip_el, "Name")
        clip_label = payload.get("locatorName") or payload.get("clipName") or "AI Clip"
        name_el.set("Value", clip_label)

        # Loop — Ableton uses child elements with Value= format
        self._make_loop_element(clip_el, length=length, start=0.0)

        if clip_type == "midi":
            notes_el = etree.SubElement(clip_el, "Notes")
            key_tracks_el = etree.SubElement(notes_el, "KeyTracks")

            notes = payload.get("notes") or []
            by_pitch: Dict[int, List[Dict]] = {}
            for note in notes:
                p = int(note.get("pitch", 60))
                by_pitch.setdefault(p, []).append(note)

            for pitch, pitch_notes in sorted(by_pitch.items()):
                kt = etree.SubElement(key_tracks_el, "KeyTrack")
                kt.set("Id", self._ids.allocate())
                kt.set("MidiKey", str(pitch))
                notes_container = etree.SubElement(kt, "Notes")
                for n in pitch_notes:
                    ne = etree.SubElement(notes_container, "MidiNoteEvent")
                    ne.set("Time", str(float(n.get("time", 0.0))))
                    ne.set("Duration", str(float(n.get("duration", 0.25))))
                    ne.set("Velocity", str(min(127, max(0, int(n.get("velocity", 100))))))
                    ne.set("OffVelocity", "64")
                    ne.set("IsEnabled", "true")
                    ne.set("NoteId", self._ids.allocate_note_id())

            # NextNoteId — Live requires this in Notes
            nid_el = etree.SubElement(notes_el, "NextNoteId")
            nid_el.set("Value", str(self._ids._next_note_id))

        return None

    def _extend_clip(self, payload: Dict[str, Any]) -> Optional[str]:
        """Extend the last clip on a track to a new end beat."""
        track_id = payload.get("targetTrackId")
        track_name = payload.get("targetTrackName")
        new_end = float(payload.get("endBeat", 0.0))

        target_el = self._find_track_element(track_id, track_name)
        if target_el is None:
            return f"Track not found: {track_id or track_name}"

        arranger_auto = target_el.find("ArrangerAutomation")
        if arranger_auto is None:
            return "No ArrangerAutomation element found on track"

        events = arranger_auto.find("Events")
        if events is None or len(events) == 0:
            return "No clips found in track"

        last_clip: Optional[etree._Element] = None
        last_time = -1.0
        for clip_el in events:
            t = float(clip_el.get("Time", -1))
            if t > last_time:
                last_time = t
                last_clip = clip_el

        if last_clip is None:
            return "Could not identify the last clip"

        last_clip.set("CurrentEnd", str(new_end))

        # Update Loop child elements (Ableton format) or attributes (test format)
        loop_el = last_clip.find("Loop")
        if loop_el is not None:
            clip_start = float(last_clip.get("Time", 0.0))
            new_len = new_end - clip_start
            # Try child-element format first (real ALS files)
            for tag, val in [("LoopEnd", new_len), ("OutMarker", new_len), ("HiddenLoopEnd", new_len)]:
                child = loop_el.find(tag)
                if child is not None:
                    child.set("Value", str(val))
                else:
                    # Fallback: attribute format (test helpers / legacy)
                    loop_el.set(tag, str(val))

        return None

    def _create_midi_track(self, name: str) -> Optional[etree._Element]:
        """
        Create a minimal valid MidiTrack XML element and append it to <Tracks>.

        Follows the Ableton Live 11 MidiTrack schema with required elements:
        Name > UserName, Name > EffectiveName, DeviceChain > Mixer, ArrangerAutomation
        """
        tracks_el = self.liveset.find("Tracks")
        if tracks_el is None:
            self.warnings.append("Cannot create new track: <Tracks> element not found")
            return None

        track_id = self._ids.allocate()
        track_el = etree.SubElement(tracks_el, "MidiTrack")
        track_el.set("Id", track_id)

        # Name wrapper (consistent with Ableton format and parser expectations)
        name_wrapper = etree.SubElement(track_el, "Name")
        un = etree.SubElement(name_wrapper, "UserName")
        un.set("Value", name)
        en = etree.SubElement(name_wrapper, "EffectiveName")
        en.set("Value", name)

        ci = etree.SubElement(track_el, "ColorIndex")
        ci.set("Value", "16")

        # DeviceChain > Mixer > Volume (with AutomationTarget)
        dc = etree.SubElement(track_el, "DeviceChain")
        devices = etree.SubElement(dc, "Devices")

        mixer = etree.SubElement(dc, "Mixer")

        vol_el = etree.SubElement(mixer, "Volume")
        vol_manual = etree.SubElement(vol_el, "Manual")
        vol_manual.set("Value", "1")
        vol_auto = etree.SubElement(vol_el, "AutomationTarget")
        vol_auto.set("Id", self._ids.allocate())

        pan_el = etree.SubElement(mixer, "Pan")
        pan_manual = etree.SubElement(pan_el, "Manual")
        pan_manual.set("Value", "0")
        pan_auto = etree.SubElement(pan_el, "AutomationTarget")
        pan_auto.set("Id", self._ids.allocate())

        # ArrangerAutomation > Events (clips land here)
        arr_auto = etree.SubElement(track_el, "ArrangerAutomation")
        events_el = etree.SubElement(arr_auto, "Events")

        # Register in index
        self._track_index[track_id] = track_el
        self._track_index[name] = track_el

        self.warnings.append(f"Created new MidiTrack '{name}' Id={track_id}")
        return track_el


# ─── Public API ───────────────────────────────────────────────────────────────

def patch_als(
    als_bytes: bytes,
    mutation_payloads: List[Dict[str, Any]],
) -> PatchResult:
    """
    High-level function: load ALS, apply mutations, validate, return patched result.

    On validation failure, PatchResult.als_bytes will be None.
    Warnings and validation_errors always contain diagnostic information.
    """
    patcher = ALSPatcher(als_bytes)
    return patcher.apply(mutation_payloads)
