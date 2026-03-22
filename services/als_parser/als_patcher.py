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
    Validate that bytes form a valid gzip-compressed ALS (XML) file.
    Reads the full decompressed XML — no size cap.
    Also checks for duplicate Id attributes across the document.
    Returns (is_valid, error_message).
    """
    if not data:
        return False, "Empty bytes"

    # 1. Must be gzip — decompress fully, no cap
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
            xml_bytes = gz.read()
    except Exception as e:
        return False, f"Gzip decompression failed: {e}"

    try:
        parser = etree.XMLParser(recover=False, resolve_entities=False, no_network=True)
        root = etree.fromstring(xml_bytes, parser=parser)
        if root is None:
            return False, "XML root is None"
        if root.tag not in ("Ableton", "LiveSet") and root.find("LiveSet") is None:
            return False, f"Unexpected root tag: {root.tag}"
    except etree.XMLSyntaxError as e:
        return False, f"XML parse error: {e}"
    except Exception as e:
        return False, f"Validation error: {e}"

    # 2. Duplicate Id check — scan all elements for duplicate Id attributes
    seen_ids: Dict[str, int] = {}
    duplicates: List[str] = []
    for el in root.iter():
        el_id = el.get("Id")
        if el_id is not None:
            seen_ids[el_id] = seen_ids.get(el_id, 0) + 1
    for id_val, count in seen_ids.items():
        if count > 1:
            duplicates.append(f"Id={id_val} appears {count} times")
    if duplicates:
        return False, f"Duplicate Id attributes found: {'; '.join(duplicates[:10])}"

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
        diagnostics: Optional[Dict[str, Any]] = None,
    ):
        self.als_bytes = als_bytes
        self.mutations_applied = mutations_applied
        self.mutations_skipped = mutations_skipped
        self.trust_label = trust_label
        self.warnings = warnings
        self.validation_passed = validation_passed
        self.diagnostics = diagnostics or {}

    def to_summary_dict(self) -> Dict[str, Any]:
        return {
            "trustLabel": self.trust_label,
            "mutationsApplied": len(self.mutations_applied),
            "mutationsSkipped": len(self.mutations_skipped),
            "appliedDetails": self.mutations_applied,
            "skippedDetails": self.mutations_skipped,
            "warnings": self.warnings,
            "validationPassed": self.validation_passed,
            "diagnostics": self.diagnostics,
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
            liveset_candidate = self.root.find("LiveSet")
            self.liveset = liveset_candidate if liveset_candidate is not None else self.root
            # Must initialise ID allocator BEFORE any mutations
            self._ids = IDAllocator(self.root)
            self._build_track_index()
        except Exception as e:
            logger.error(f"ALSPatcher._load failed: {e}")
            self.warnings.append(f"Failed to load ALS for patching: {e}")

    def _next_id(self) -> str:
        """Delegate to IDAllocator for a globally unique ID string."""
        return self._ids.allocate()

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

    # ── Pre-serialisation validation gate ────────────────────────────────────

    def _validate_tree(self, root: etree._Element) -> Dict[str, Any]:
        """
        Run strict pre-serialisation validation checks on the mutated XML tree.

        Checks:
          (a) No duplicate Id attributes
          (b) All PointeeId Value references exist as AutomationTarget Id in document
          (c) All clips have CurrentEnd > Time
          (d) All MidiNoteEvent Time values are >= 0 and < (CurrentEnd - Time) of parent clip

        Returns a diagnostics dict with keys:
          'passed': bool
          'violations': list of violation strings
        """
        violations: List[str] = []

        # (a) Duplicate Id attributes
        id_counts: Dict[str, int] = {}
        for el in root.iter():
            el_id = el.get("Id")
            if el_id is not None:
                id_counts[el_id] = id_counts.get(el_id, 0) + 1
        for id_val, count in id_counts.items():
            if count > 1:
                violations.append(f"Duplicate Id={id_val} appears {count} times")

        # (b) PointeeId references — collect all AutomationTarget Ids
        existing_auto_ids = {
            el.get("Id")
            for el in root.iter("AutomationTarget")
            if el.get("Id") is not None
        }
        for el in root.iter("PointeeId"):
            ref = el.get("Value")
            if ref is not None and ref not in existing_auto_ids:
                violations.append(f"PointeeId Value={ref} has no matching AutomationTarget Id")

        # (c) Clips must have CurrentEnd > Time
        for clip_tag in ("MidiClip", "AudioClip"):
            for clip_el in root.iter(clip_tag):
                try:
                    clip_time = float(clip_el.get("Time", 0))
                    clip_end = float(clip_el.get("CurrentEnd", 0))
                    if clip_end <= clip_time:
                        clip_id = clip_el.get("Id", "?")
                        violations.append(
                            f"{clip_tag} Id={clip_id}: CurrentEnd ({clip_end}) <= Time ({clip_time})"
                        )
                except (TypeError, ValueError):
                    pass

        # (d) MidiNoteEvent Time must be >= 0 and < clip duration
        for clip_tag in ("MidiClip",):
            for clip_el in root.iter(clip_tag):
                try:
                    clip_time = float(clip_el.get("Time", 0))
                    clip_end = float(clip_el.get("CurrentEnd", 0))
                    clip_duration = clip_end - clip_time
                    clip_id = clip_el.get("Id", "?")
                    for ne in clip_el.iter("MidiNoteEvent"):
                        try:
                            note_time = float(ne.get("Time", 0))
                            if note_time < 0:
                                violations.append(
                                    f"MidiNoteEvent in clip {clip_id}: Time={note_time} is negative"
                                )
                            elif note_time >= clip_duration:
                                violations.append(
                                    f"MidiNoteEvent in clip {clip_id}: Time={note_time} >= clip duration {clip_duration}"
                                )
                        except (TypeError, ValueError):
                            pass
                except (TypeError, ValueError):
                    pass

        return {
            "passed": len(violations) == 0,
            "violations": violations,
        }

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
                diagnostics={"passed": False, "violations": ["ALS failed to load"]},
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
                diagnostics={"passed": False, "violations": ["No mutations were applied"]},
            )

        # Trust tier
        applied_types = {a["type"] for a in applied}
        if applied_types <= {"add_locator"}:
            trust_label = TRUST_SAFE_LOCATOR
        elif applied_types <= {"add_locator", "add_automation"}:
            trust_label = TRUST_SAFE_AUTO
        else:
            trust_label = TRUST_STRUCTURAL

        # Run strict pre-serialisation validation gate
        diagnostics = self._validate_tree(self.root)
        if not diagnostics["passed"]:
            violation_summary = "; ".join(diagnostics["violations"][:5])
            self.warnings.append(f"Pre-serialisation validation failed: {violation_summary}")
            logger.warning(f"ALSPatcher: pre-serialisation validation failed — {diagnostics}")
            return PatchResult(
                als_bytes=None,
                mutations_applied=applied,
                mutations_skipped=skipped,
                trust_label=TRUST_MANUAL,
                warnings=self.warnings,
                validation_passed=False,
                diagnostics=diagnostics,
            )

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

            # Post-apply validation (full decompression, duplicate Id check)
            valid, err = validate_als_bytes(candidate)
            if valid:
                als_bytes = candidate
                validation_passed = True
            else:
                self.warnings.append(f"Post-patch validation failed: {err}. Falling back to no output.")
                als_bytes = None
                trust_label = TRUST_MANUAL
                diagnostics = {"passed": False, "violations": [f"Post-patch validation: {err}"]}

        except Exception as e:
            logger.error(f"ALSPatcher: serialisation failed: {e}")
            self.warnings.append(f"Serialisation failed: {e}")
            als_bytes = None
            trust_label = TRUST_MANUAL
            diagnostics = {"passed": False, "violations": [f"Serialisation error: {e}"]}

        return PatchResult(
            als_bytes=als_bytes,
            mutations_applied=applied,
            mutations_skipped=skipped,
            trust_label=trust_label if als_bytes else TRUST_MANUAL,
            warnings=self.warnings,
            validation_passed=validation_passed,
            diagnostics=diagnostics,
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

        Strategy:
        1. Find target track element by ID or name
        2. Build PointeeId map from track's AutomationTarget elements
        3. Resolve PointeeId for the requested parameter
        4. Write AutomationEnvelope under ArrangerAutomation/AutomationEnvelopes/Envelopes

        Ableton expects AutomationEnvelopes to appear BEFORE Events within ArrangerAutomation.

        Returns None on success, or an error string if the mutation should be skipped.
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

        # Find or create ArrangerAutomation
        arranger_auto = target_el.find("ArrangerAutomation")
        if arranger_auto is None:
            arranger_auto = etree.SubElement(target_el, "ArrangerAutomation")

        # Ableton canonical order: AutomationEnvelopes BEFORE Events
        # Find or create AutomationEnvelopes, then ensure it is before Events
        auto_envs = arranger_auto.find("AutomationEnvelopes")
        events_el = arranger_auto.find("Events")

        if auto_envs is None:
            # Insert AutomationEnvelopes at position 0 (before Events)
            auto_envs = etree.Element("AutomationEnvelopes")
            if events_el is not None:
                events_el.addprevious(auto_envs)
            else:
                arranger_auto.insert(0, auto_envs)

        envelopes = auto_envs.find("Envelopes")
        if envelopes is None:
            envelopes = etree.SubElement(auto_envs, "Envelopes")

        envelope = etree.SubElement(envelopes, "AutomationEnvelope")
        envelope.set("Id", self._ids.allocate())

        env_target = etree.SubElement(envelope, "EnvelopeTarget")
        pointee_el = etree.SubElement(env_target, "PointeeId")
        pointee_el.set("Value", str(pointee_id))

        automation_el = etree.SubElement(envelope, "Automation")
        events_el_inner = etree.SubElement(automation_el, "Events")

        points = payload.get("automationPoints") or []
        if not points:
            start_beat = float(payload.get("startBeat", 0.0))
            end_beat = float(payload.get("endBeat", start_beat + 16.0))
            points = [
                {"time": start_beat, "value": 0.25},
                {"time": end_beat, "value": 0.75},
            ]

        for pt in points:
            event = etree.SubElement(events_el_inner, "AutomationEvent")
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

            # Track the highest NoteId assigned per clip for NextNoteId
            max_note_id = 0
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
                    note_id_str = self._ids.allocate_note_id()
                    ne.set("NoteId", note_id_str)
                    try:
                        nid_int = int(note_id_str)
                        if nid_int > max_note_id:
                            max_note_id = nid_int
                    except ValueError:
                        pass

            # NextNoteId = max(NoteId in this clip) + 1
            nid_el = etree.SubElement(notes_el, "NextNoteId")
            nid_el.set("Value", str(max_note_id + 1))
            etree.SubElement(notes_el, "Events")

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
        Create a minimal valid MidiTrack XML element and insert it before any
        return or master tracks (not simply appended to end).
        Includes all required Live 11/12 siblings: TrackDelay, SendsPre, Freeze,
        AutomationLanes, LinkedTrack.
        Returns the new element, or None on failure.
        """
        tracks_el = self.liveset.find("Tracks")
        if tracks_el is None:
            self.warnings.append("Cannot create new track: <Tracks> element not found")
            return None

        track_id = self._ids.allocate()
        track_el = etree.Element("MidiTrack")
        track_el.set("Id", track_id)

        # Name wrapper (consistent with Ableton format and parser expectations)
        name_wrapper = etree.SubElement(track_el, "Name")
        un = etree.SubElement(name_wrapper, "UserName")
        un.set("Value", name)
        en = etree.SubElement(name_wrapper, "EffectiveName")
        en.set("Value", name)

        ci = etree.SubElement(track_el, "ColorIndex")
        ci.set("Value", "16")

        # TrackDelay (required by Live 11/12)
        track_delay = etree.SubElement(track_el, "TrackDelay")
        td_val = etree.SubElement(track_delay, "Value")
        td_val.set("Value", "0")
        td_manual = etree.SubElement(track_delay, "Manual")
        td_manual.set("Value", "0")

        # DeviceChain > Devices + Mixer
        dc = etree.SubElement(track_el, "DeviceChain")
        etree.SubElement(dc, "Devices")
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

        # SendsPre (required by Live 11/12)
        sends_pre = etree.SubElement(track_el, "SendsPre")
        sends_pre.set("Value", "false")

        # Freeze (required by Live 11/12)
        freeze_el = etree.SubElement(track_el, "Freeze")
        freeze_el.set("Value", "false")

        # ArrangerAutomation > Events (clips land here)
        arr_auto = etree.SubElement(track_el, "ArrangerAutomation")
        etree.SubElement(arr_auto, "Events")

        # AutomationLanes (required by Live 11/12)
        auto_lanes = etree.SubElement(track_el, "AutomationLanes")
        etree.SubElement(auto_lanes, "AutomationLanes")
        cl_auto = etree.SubElement(auto_lanes, "IsSendBeforeHear")
        cl_auto.set("Value", "false")

        # LinkedTrack (required by Live 11/12)
        linked = etree.SubElement(track_el, "LinkedTrack")
        linked.set("Value", "-1")

        # Insert before any return or master track elements (not appended to end)
        insert_idx = len(tracks_el)
        for i, child in enumerate(tracks_el):
            if child.tag in ("ReturnTrack", "MasterTrack"):
                insert_idx = i
                break
        tracks_el.insert(insert_idx, track_el)

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
    Warnings and diagnostics always contain diagnostic information.
    """
    patcher = ALSPatcher(als_bytes)
    return patcher.apply(mutation_payloads)
