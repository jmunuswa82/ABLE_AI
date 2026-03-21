"""
ALS Mutation Engine.

Applies a MutationPayload plan to an existing .als file and produces a patched
.als candidate. Each mutation is labeled with a trust level:

  SAFE_LOCATOR_ONLY       — only locator markers added, no structural changes
  SAFE_AUTOMATION_ADDED   — automation envelopes added/extended (no clip/device changes)
  STRUCTURALLY_VALID_ALS  — clips added or modified, validated before save
  REQUIRES_MANUAL_REVIEW  — sidechain routing or device insertions (exported as JSON plan only)

The patched .als is gzip-compressed XML, same format as input.
All mutations are validated post-apply by decompress+reparse; failure falls back
to the 'Safe Patch Bundle' mode (original bytes + JSON plan only).
"""

from __future__ import annotations

import gzip
import io
import logging
import uuid
from typing import List, Dict, Any, Optional, Tuple
from lxml import etree

# Import param name map from parser — done at module level for reliability
try:
    from .parser import NATIVE_PARAM_NAMES as _NATIVE_PARAM_NAMES
except ImportError:
    _NATIVE_PARAM_NAMES = {}

logger = logging.getLogger(__name__)

# ─── Trust tiers ──────────────────────────────────────────────────────────────

TRUST_SAFE_LOCATOR = "SAFE_LOCATOR_ONLY"
TRUST_SAFE_AUTO = "SAFE_AUTOMATION_ADDED"
TRUST_STRUCTURAL = "STRUCTURALLY_VALID_ALS"
TRUST_MANUAL = "REQUIRES_MANUAL_REVIEW"

# Parameter name → list of XML element tag patterns to search for PointeeId
PARAM_TAG_PATTERNS: Dict[str, List[str]] = {
    "Filter Cutoff":       ["Cutoff", "FilterFreq", "Frequency"],
    "Filter Resonance":    ["Resonance", "FilterRes", "Q"],
    "Volume":              ["Volume", "DeviceChain/Mixer/Volume"],
    "Pan":                 ["Pan", "DeviceChain/Mixer/Pan"],
    "Send Amount":         ["Send", "SendAmount"],
    "Threshold":           ["Threshold"],
    "Ratio":               ["Ratio"],
    "Attack":              ["Attack"],
    "Release":             ["Release"],
    "Dry/Wet":             ["DryWet"],
    "Drive":               ["Drive", "WarmDrive"],
    "Gain":                ["Gain", "GainCompensation"],
    "Delay Time":          ["DelayTime"],
    "Feedback":            ["Feedback"],
    "Transpose":           ["TransposeSemitones"],
}


class PatchResult:
    def __init__(
        self,
        als_bytes: Optional[bytes],
        mutations_applied: List[Dict[str, Any]],
        mutations_skipped: List[Dict[str, Any]],
        trust_label: str,
        warnings: List[str],
        validation_passed: bool = True,
    ):
        self.als_bytes = als_bytes
        self.mutations_applied = mutations_applied
        self.mutations_skipped = mutations_skipped
        self.trust_label = trust_label
        self.warnings = warnings
        self.validation_passed = validation_passed

    def to_summary_dict(self) -> Dict[str, Any]:
        return {
            "trustLabel": self.trust_label,
            "mutationsApplied": len(self.mutations_applied),
            "mutationsSkipped": len(self.mutations_skipped),
            "appliedDetails": self.mutations_applied,
            "skippedDetails": self.mutations_skipped,
            "warnings": self.warnings,
            "validationPassed": self.validation_passed,
        }


def validate_als_bytes(data: bytes) -> Tuple[bool, str]:
    """
    Validate that bytes form a valid gzip-compressed ALS (XML) file.
    Returns (is_valid, error_message).
    """
    if not data:
        return False, "Empty bytes"

    # 1. Must be gzip
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
            xml_bytes = gz.read(1024 * 1024 * 4)  # Read up to 4MB for validation
    except Exception as e:
        return False, f"Gzip decompression failed: {e}"

    # 2. Must be valid XML with Ableton root element
    try:
        parser = etree.XMLParser(recover=False, resolve_entities=False, no_network=True)
        root = etree.fromstring(xml_bytes[:min(len(xml_bytes), 2 * 1024 * 1024)], parser=parser)
        if root is None:
            return False, "XML root is None"
        # 3. Must have Ableton root or LiveSet
        if root.tag not in ("Ableton", "LiveSet") and root.find("LiveSet") is None:
            return False, f"Unexpected root tag: {root.tag}"
    except etree.XMLSyntaxError as e:
        return False, f"XML parse error: {e}"
    except Exception as e:
        return False, f"Validation error: {e}"

    return True, ""


class ALSPatcher:
    """
    Applies MutationPayload operations to an .als XML tree.
    """

    def __init__(self, als_bytes: bytes):
        self.original_bytes = als_bytes
        self.root: Optional[etree._Element] = None
        self.liveset: Optional[etree._Element] = None
        self.warnings: List[str] = []
        self._track_index: Dict[str, etree._Element] = {}  # track_id|name -> element
        self._load()

    def _load(self) -> None:
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(self.original_bytes)) as gz:
                xml_bytes = gz.read()
            parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
            self.root = etree.fromstring(xml_bytes, parser=parser)
            self.liveset = self.root.find("LiveSet") or self.root
            self._build_track_index()
        except Exception as e:
            logger.error(f"ALSPatcher: failed to load ALS: {e}")
            self.warnings.append(f"Failed to load ALS for patching: {e}")

    def _build_track_index(self) -> None:
        """Build a fast lookup: track_id (str) and track_name -> XML element."""
        if self.liveset is None:
            return
        tracks_el = self.liveset.find("Tracks")
        if tracks_el is None:
            return
        for track_el in tracks_el:
            el_id = track_el.get("Id", "")
            name_el = track_el.find(".//EffectiveName")
            if name_el is None:
                name_el = track_el.find(".//UserName")
            track_name = name_el.get("Value", "") if name_el is not None else ""
            if el_id:
                self._track_index[el_id] = track_el
            if track_name:
                self._track_index[track_name] = track_el

    def _find_track_element(self, track_id: Optional[str], track_name: Optional[str]) -> Optional[etree._Element]:
        """Find a track XML element by the internal track ID (string like 'track_4_12345') or name."""
        if track_id:
            # The parser stores IDs like "track_<order>_<ableton_id>" — extract numeric part
            parts = track_id.rsplit("_", 1)
            ableton_id = parts[-1] if len(parts) > 1 else track_id
            if ableton_id in self._track_index:
                return self._track_index[ableton_id]
            # Try full ID as key
            if track_id in self._track_index:
                return self._track_index[track_id]
        if track_name and track_name in self._track_index:
            return self._track_index[track_name]
        return None

    def _build_pointee_map(self, track_el: etree._Element) -> Dict[str, str]:
        """
        Build a map from human-readable param name patterns to PointeeId values
        found in AutomationTarget elements within this track.

        Ableton XML structure:
          <SomeDevice>
            <Cutoff>
              <LomId Value="0" />
              <Manual Value="0.5" />
              <AutomationTarget Id="12345" />   ← we want Id="12345"
            </Cutoff>
          </SomeDevice>
        """
        result: Dict[str, str] = {}  # param_name -> pointee_id_value

        for auto_target in track_el.iter("AutomationTarget"):
            pointee_id = auto_target.get("Id", "")
            if not pointee_id:
                continue

            # Parent element tag = parameter element (e.g. "Cutoff")
            parent = auto_target.getparent()
            if parent is None:
                continue
            param_tag = parent.tag  # e.g. "Cutoff", "Volume", "DryWet"

            # Grandparent = device element (e.g. "AutoFilter", "Compressor2")
            grandparent = parent.getparent()
            device_tag = grandparent.tag if grandparent is not None else ""

            # Map tag -> friendly name using NATIVE_PARAM_NAMES
            friendly = _NATIVE_PARAM_NAMES.get(param_tag, param_tag)

            # Also record by raw tag for pattern matching
            result[param_tag] = pointee_id
            result[friendly] = pointee_id

            # Device-qualified key: "AutoFilter.Cutoff" -> pointee_id
            if device_tag:
                result[f"{device_tag}.{param_tag}"] = pointee_id
                result[f"{device_tag}.{friendly}"] = pointee_id

        return result

    def _resolve_pointee_id(self, track_el: etree._Element, param_name: str) -> Optional[str]:
        """
        Resolve a PointeeId for the given parameter name by searching the track XML.
        Tries pattern matching against PARAM_TAG_PATTERNS then falls back to direct key lookup.
        """
        pointee_map = self._build_pointee_map(track_el)
        if not pointee_map:
            return None

        # Direct match first
        if param_name in pointee_map:
            return pointee_map[param_name]

        # Pattern-based match
        patterns = PARAM_TAG_PATTERNS.get(param_name, [param_name])
        for pattern in patterns:
            if pattern in pointee_map:
                return pointee_map[pattern]
            # Case-insensitive search
            for key, val in pointee_map.items():
                if key.lower() == pattern.lower():
                    return val

        # Partial match fallback
        param_lower = param_name.lower()
        for key, val in pointee_map.items():
            if param_lower in key.lower() or key.lower() in param_lower:
                return val

        return None

    def apply(self, mutation_payloads: List[Dict[str, Any]]) -> PatchResult:
        if self.root is None:
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
                    result_msg = self._add_automation(payload)
                    if result_msg:
                        skipped.append({"type": mutation_type, "reason": result_msg, "payload": payload})
                    else:
                        applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type == "add_clip":
                    result_msg = self._add_clip(payload)
                    if result_msg:
                        skipped.append({"type": mutation_type, "reason": result_msg, "payload": payload})
                    else:
                        applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type in ("extend_clip",):
                    result_msg = self._extend_clip(payload)
                    if result_msg:
                        skipped.append({"type": mutation_type, "reason": result_msg, "payload": payload})
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
                logger.error(f"Mutation {mutation_type} failed: {e}", exc_info=True)
                self.warnings.append(f"Mutation {mutation_type} failed: {e}")
                skipped.append({
                    "type": mutation_type,
                    "reason": str(e),
                    "payload": payload,
                })

        if not applied:
            return PatchResult(
                als_bytes=None,
                mutations_applied=applied,
                mutations_skipped=skipped,
                trust_label=TRUST_MANUAL,
                warnings=self.warnings,
                validation_passed=False,
            )

        # Determine trust level
        applied_types = {a["type"] for a in applied}
        if applied_types <= {"add_locator"}:
            trust_label = TRUST_SAFE_LOCATOR
        elif applied_types <= {"add_locator", "add_automation"}:
            trust_label = TRUST_SAFE_AUTO
        else:
            trust_label = TRUST_STRUCTURAL

        # Serialize back to gzip XML
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

            # Post-apply validation
            valid, err = validate_als_bytes(candidate)
            if valid:
                als_bytes = candidate
                validation_passed = True
            else:
                self.warnings.append(f"Post-patch validation failed: {err}. Falling back to original bytes.")
                als_bytes = None
                trust_label = TRUST_MANUAL

        except Exception as e:
            logger.error(f"ALSPatcher: failed to serialize: {e}")
            self.warnings.append(f"Serialization failed: {e}")
            als_bytes = None
            trust_label = TRUST_MANUAL

        return PatchResult(
            als_bytes=als_bytes,
            mutations_applied=applied,
            mutations_skipped=skipped,
            trust_label=trust_label,
            warnings=self.warnings,
            validation_passed=validation_passed,
        )

    def _add_locator(self, payload: Dict[str, Any]) -> None:
        """Add an arrangement locator (cue marker) at the given beat position."""
        # Ableton stores locators under <Locators><Locators> (two levels)
        locators_outer = self.liveset.find("Locators")
        if locators_outer is None:
            locators_outer = etree.SubElement(self.liveset, "Locators")

        # Ableton 11/12 format: <Locators><Locators><WarpMarker .../>
        # For arrangement locators the actual element is <AutomationEvent> or <CuePoint>
        locators_inner = locators_outer.find("Locators")
        if locators_inner is None:
            locators_inner = locators_outer  # older format: flat

        time_beats = float(payload.get("startBeat", 0.0))
        name = payload.get("locatorName", "Marker")

        # Try CuePoint format (Live 10+)
        cue = etree.SubElement(locators_inner, "CuePoint")
        cue.set("Id", str(uuid.uuid4().int % 1000000))
        cue.set("Time", str(time_beats))
        cue.set("ColorIndex", "13")

        name_el = etree.SubElement(cue, "Name")
        name_el.set("Value", name)

        annotation_el = etree.SubElement(cue, "Annotation")
        annotation_el.set("Value", "")

        launch_el = etree.SubElement(cue, "IsSongStart")
        launch_el.set("Value", "false")

    def _add_automation(self, payload: Dict[str, Any]) -> Optional[str]:
        """
        Add an automation envelope to the correct track/parameter.

        Strategy:
        1. Find target track element by ID or name
        2. Build PointeeId map from track's AutomationTarget elements
        3. Resolve PointeeId for the requested parameter
        4. Write AutomationEnvelope under ArrangerAutomation/AutomationEnvelopes/Envelopes

        Returns None on success, or an error string if the mutation should be skipped.
        """
        track_id = payload.get("targetTrackId")
        track_name = payload.get("targetTrackName")
        param_name = payload.get("automationParameter", "Filter Cutoff")

        target_el = self._find_track_element(track_id, track_name)
        if target_el is None:
            # Fallback: write to master track with a warning (non-destructive)
            target_el = self.liveset.find("MasterTrack")
            if target_el is None:
                return "No target track found and no MasterTrack fallback"
            self.warnings.append(
                f"add_automation: track '{track_id or track_name}' not found, "
                f"writing to MasterTrack as non-destructive placeholder"
            )

        # Resolve PointeeId for this parameter in this track
        pointee_id = self._resolve_pointee_id(target_el, param_name)
        if pointee_id is None:
            # Assign a synthetic PointeeId — it won't link to a real parameter
            # but is still non-destructive XML
            pointee_id = str(uuid.uuid4().int % 999999)
            self.warnings.append(
                f"add_automation: no PointeeId found for '{param_name}' on track "
                f"'{track_name or track_id}'; using synthetic ID {pointee_id}"
            )

        # Find or create ArrangerAutomation > AutomationEnvelopes > Envelopes
        arranger_auto = target_el.find("ArrangerAutomation")
        if arranger_auto is None:
            arranger_auto = etree.SubElement(target_el, "ArrangerAutomation")

        auto_envs = arranger_auto.find("AutomationEnvelopes")
        if auto_envs is None:
            auto_envs = etree.SubElement(arranger_auto, "AutomationEnvelopes")

        envelopes = auto_envs.find("Envelopes")
        if envelopes is None:
            envelopes = etree.SubElement(auto_envs, "Envelopes")

        # Create the envelope
        envelope = etree.SubElement(envelopes, "AutomationEnvelope")
        envelope.set("Id", str(uuid.uuid4().int % 999999))

        target_ref = etree.SubElement(envelope, "EnvelopeTarget")
        pointee_el = etree.SubElement(target_ref, "PointeeId")
        pointee_el.set("Value", str(pointee_id))

        automation_el = etree.SubElement(envelope, "Automation")
        events_el = etree.SubElement(automation_el, "Events")

        points = payload.get("automationPoints", [])
        if not points:
            # Create minimal 2-point ramp if no points provided
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

        return None  # Success

    def _add_clip(self, payload: Dict[str, Any]) -> Optional[str]:
        """
        Add a MIDI clip to a target track's ArrangerAutomation/Events.
        Handles both existing tracks (by ID/name) and new track creation hints.
        Returns None on success, error string on skip.
        """
        track_id = payload.get("targetTrackId")
        track_name = payload.get("targetTrackName")
        new_track_name = payload.get("newTrackName")

        target_el = self._find_track_element(track_id, track_name)

        if target_el is None and new_track_name:
            # Create a new MIDI track — minimal safe structure
            target_el = self._create_midi_track(new_track_name)
            if target_el is None:
                return f"Failed to create new track '{new_track_name}'"

        if target_el is None:
            return f"Track not found: id={track_id}, name={track_name}"

        arranger_auto = target_el.find("ArrangerAutomation")
        if arranger_auto is None:
            arranger_auto = etree.SubElement(target_el, "ArrangerAutomation")

        events = arranger_auto.find("Events")
        if events is None:
            events = etree.SubElement(arranger_auto, "Events")

        start_beat = float(payload.get("startBeat", 0.0))
        end_beat = float(payload.get("endBeat", start_beat + 16.0))
        clip_type = payload.get("clipType", "midi")

        clip_tag = "MidiClip" if clip_type == "midi" else "AudioClip"
        clip_el = etree.SubElement(events, clip_tag)
        clip_el.set("Id", str(uuid.uuid4().int % 999999))
        clip_el.set("Time", str(start_beat))
        clip_el.set("CurrentEnd", str(end_beat))
        clip_el.set("ColorIndex", "16")
        clip_el.set("IsWarped", "true")

        name_el = etree.SubElement(clip_el, "Name")
        clip_label = payload.get("locatorName") or payload.get("clipName") or "AI Clip"
        name_el.set("Value", clip_label)

        loop_el = etree.SubElement(clip_el, "Loop")
        loop_el.set("LoopStart", "0")
        loop_el.set("LoopEnd", str(end_beat - start_beat))
        loop_el.set("StartRelative", "0")
        loop_el.set("LoopOn", "false")
        loop_el.set("OutMarker", str(end_beat - start_beat))
        loop_el.set("HiddenLoopStart", "0")
        loop_el.set("HiddenLoopEnd", str(end_beat - start_beat))

        if clip_type == "midi":
            notes_el = etree.SubElement(clip_el, "Notes")
            key_tracks = etree.SubElement(notes_el, "KeyTracks")

            notes = payload.get("notes") or []
            by_pitch: Dict[int, List[Dict]] = {}
            for note in notes:
                p = int(note.get("pitch", 60))
                by_pitch.setdefault(p, []).append(note)

            for pitch, pitch_notes in sorted(by_pitch.items()):
                kt = etree.SubElement(key_tracks, "KeyTrack")
                kt.set("Id", str(uuid.uuid4().int % 999999))
                kt.set("MidiKey", str(pitch))
                notes_container = etree.SubElement(kt, "Notes")
                for n in pitch_notes:
                    ne = etree.SubElement(notes_container, "MidiNoteEvent")
                    ne.set("Time", str(float(n.get("time", 0.0))))
                    ne.set("Duration", str(float(n.get("duration", 0.25))))
                    ne.set("Velocity", str(min(127, max(0, int(n.get("velocity", 100))))))
                    ne.set("OffVelocity", "64")
                    ne.set("IsEnabled", "true")
                    ne.set("NoteId", str(uuid.uuid4().int % 999999))

            # NextNoteId required by Live
            next_id_el = etree.SubElement(notes_el, "NextNoteId")
            next_id_el.set("Value", str(len(notes) + 1))
            events_sub = etree.SubElement(notes_el, "Events")

        return None  # Success

    def _extend_clip(self, payload: Dict[str, Any]) -> Optional[str]:
        """Extend the last clip in a track to a new end beat."""
        track_id = payload.get("targetTrackId")
        track_name = payload.get("targetTrackName")
        new_end = float(payload.get("endBeat", 0.0))

        target_el = self._find_track_element(track_id, track_name)
        if target_el is None:
            return f"Track not found: {track_id or track_name}"

        arranger_auto = target_el.find("ArrangerAutomation")
        if arranger_auto is None:
            return "No ArrangerAutomation found on track"

        events = arranger_auto.find("Events")
        if events is None or len(events) == 0:
            return "No clips found in track"

        # Find the last clip by time
        last_clip = None
        last_time = -1.0
        for clip_el in events:
            t = float(clip_el.get("Time", -1))
            if t > last_time:
                last_time = t
                last_clip = clip_el

        if last_clip is None:
            return "Could not find last clip"

        last_clip.set("CurrentEnd", str(new_end))
        loop_el = last_clip.find("Loop")
        if loop_el is not None:
            clip_start = float(last_clip.get("Time", 0.0))
            new_len = new_end - clip_start
            loop_el.set("LoopEnd", str(new_len))
            loop_el.set("OutMarker", str(new_len))
            loop_el.set("HiddenLoopEnd", str(new_len))

        return None

    def _create_midi_track(self, name: str) -> Optional[etree._Element]:
        """
        Create a minimal valid MidiTrack XML element and append it to Tracks.
        Returns the new element, or None on failure.
        """
        tracks_el = self.liveset.find("Tracks")
        if tracks_el is None:
            self.warnings.append("Cannot create new track: no <Tracks> element")
            return None

        track_id = str(uuid.uuid4().int % 999999)
        track_el = etree.SubElement(tracks_el, "MidiTrack")
        track_el.set("Id", track_id)

        name_el = etree.SubElement(track_el, "UserName")
        name_el.set("Value", name)

        eff_name_el = etree.SubElement(track_el, "EffectiveName")
        eff_name_el.set("Value", name)

        color_el = etree.SubElement(track_el, "ColorIndex")
        color_el.set("Value", "16")

        device_chain = etree.SubElement(track_el, "DeviceChain")
        devices = etree.SubElement(device_chain, "Devices")
        mixer = etree.SubElement(device_chain, "Mixer")

        vol_el = etree.SubElement(mixer, "Volume")
        vol_manual = etree.SubElement(vol_el, "Manual")
        vol_manual.set("Value", "1")
        vol_auto = etree.SubElement(vol_el, "AutomationTarget")
        vol_auto.set("Id", str(uuid.uuid4().int % 999999))

        pan_el = etree.SubElement(mixer, "Pan")
        pan_manual = etree.SubElement(pan_el, "Manual")
        pan_manual.set("Value", "0")

        arr_auto = etree.SubElement(track_el, "ArrangerAutomation")
        events = etree.SubElement(arr_auto, "Events")

        # Update track index
        self._track_index[track_id] = track_el
        self._track_index[name] = track_el

        self.warnings.append(f"Created new MidiTrack '{name}' with Id={track_id}")
        return track_el


def patch_als(
    als_bytes: bytes,
    mutation_payloads: List[Dict[str, Any]],
) -> PatchResult:
    """
    High-level function: load an ALS, apply mutations, validate, return patched result.
    On validation failure, als_bytes will be None (safe patch bundle mode).
    """
    patcher = ALSPatcher(als_bytes)
    return patcher.apply(mutation_payloads)
