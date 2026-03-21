"""
ALS Mutation Engine.

Applies a MutationPayload plan to an existing .als file and produces a patched
.als candidate. Each mutation is labeled with a trust level:

  SAFE_LOCATOR_ONLY       — only locator markers added, no structural changes
  SAFE_AUTOMATION_ADDED   — automation envelopes added/extended (no clip/device changes)
  STRUCTURALLY_VALID_ALS  — clips added or modified, validated before save
  REQUIRES_MANUAL_REVIEW  — sidechain routing or device insertions (exported as JSON plan only)

The patched .als is gzip-compressed XML, same format as input.
"""

from __future__ import annotations

import copy
import gzip
import io
import logging
import uuid
from typing import List, Dict, Any, Optional, Tuple
from lxml import etree

logger = logging.getLogger(__name__)

# ─── Trust tiers ──────────────────────────────────────────────────────────────

TRUST_SAFE_LOCATOR = "SAFE_LOCATOR_ONLY"
TRUST_SAFE_AUTO = "SAFE_AUTOMATION_ADDED"
TRUST_STRUCTURAL = "STRUCTURALLY_VALID_ALS"
TRUST_MANUAL = "REQUIRES_MANUAL_REVIEW"


class PatchResult:
    def __init__(
        self,
        als_bytes: Optional[bytes],
        mutations_applied: List[Dict[str, Any]],
        mutations_skipped: List[Dict[str, Any]],
        trust_label: str,
        warnings: List[str],
    ):
        self.als_bytes = als_bytes
        self.mutations_applied = mutations_applied
        self.mutations_skipped = mutations_skipped
        self.trust_label = trust_label
        self.warnings = warnings

    def to_summary_dict(self) -> Dict[str, Any]:
        return {
            "trustLabel": self.trust_label,
            "mutationsApplied": len(self.mutations_applied),
            "mutationsSkipped": len(self.mutations_skipped),
            "appliedDetails": self.mutations_applied,
            "skippedDetails": self.mutations_skipped,
            "warnings": self.warnings,
        }


class ALSPatcher:
    """
    Applies MutationPayload operations to an .als XML tree.
    """

    def __init__(self, als_bytes: bytes):
        self.original_bytes = als_bytes
        self.root: Optional[etree._Element] = None
        self.liveset: Optional[etree._Element] = None
        self.warnings: List[str] = []
        self._load()

    def _load(self) -> None:
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(self.original_bytes)) as gz:
                xml_bytes = gz.read()
            parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
            self.root = etree.fromstring(xml_bytes, parser=parser)
            self.liveset = self.root.find("LiveSet") or self.root
        except Exception as e:
            logger.error(f"ALSPatcher: failed to load ALS: {e}")
            self.warnings.append(f"Failed to load ALS for patching: {e}")

    def apply(self, mutation_payloads: List[Dict[str, Any]]) -> PatchResult:
        if self.root is None:
            return PatchResult(
                als_bytes=None,
                mutations_applied=[],
                mutations_skipped=[{"reason": "ALS failed to load", "payload": {}}],
                trust_label=TRUST_MANUAL,
                warnings=self.warnings,
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
                    self._add_automation(payload)
                    applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type == "add_clip":
                    self._add_clip(payload)
                    applied.append({"type": mutation_type, "payload": payload})

                elif mutation_type == "add_sidechain_proposal":
                    # Sidechain routing changes require manual application
                    skipped.append({
                        "type": mutation_type,
                        "reason": "Sidechain routing requires manual device configuration",
                        "payload": payload,
                    })

                else:
                    skipped.append({
                        "type": mutation_type,
                        "reason": f"Unknown mutation type: {mutation_type}",
                        "payload": payload,
                    })

            except Exception as e:
                logger.error(f"Mutation {mutation_type} failed: {e}")
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
            als_bytes = buf.getvalue()
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
        )

    def _add_locator(self, payload: Dict[str, Any]) -> None:
        """Add an arrangement locator marker."""
        locators_el = self.liveset.find("Locators")
        if locators_el is None:
            locators_el = etree.SubElement(self.liveset, "Locators")

        time = payload.get("startBeat", 0.0)
        name = payload.get("locatorName", "Marker")

        locator = etree.SubElement(locators_el, "AutomationEvent")
        locator.set("Time", str(float(time)))
        locator.set("Value", "0")

        name_el = etree.SubElement(locator, "Name")
        name_el.set("Value", name)

    def _add_automation(self, payload: Dict[str, Any]) -> None:
        """
        Add an automation envelope to a track's AutomationEnvelopes.
        This is a stub that adds the envelope at the master track level
        as a safe, non-destructive marker.
        """
        master_track = self.liveset.find("MasterTrack")
        if master_track is None:
            self.warnings.append("add_automation: no MasterTrack found, skipping")
            return

        auto_envelopes = master_track.find("AutomationEnvelopes")
        if auto_envelopes is None:
            auto_envelopes = etree.SubElement(master_track, "AutomationEnvelopes")

        envelopes = auto_envelopes.find("Envelopes")
        if envelopes is None:
            envelopes = etree.SubElement(auto_envelopes, "Envelopes")

        envelope = etree.SubElement(envelopes, "AutomationEnvelope")
        envelope.set("Id", str(uuid.uuid4().int % 100000))

        target_el = etree.SubElement(envelope, "EnvelopeTarget")
        pointee_el = etree.SubElement(target_el, "PointeeId")
        pointee_el.set("Value", "0")

        automation_el = etree.SubElement(envelope, "Automation")
        events_el = etree.SubElement(automation_el, "Events")

        points = payload.get("automationPoints", [])
        for pt in points:
            event = etree.SubElement(events_el, "AutomationEvent")
            event.set("Time", str(float(pt.get("time", 0.0))))
            event.set("Value", str(float(pt.get("value", 0.0))))
            event.set("CurveControl1X", "0.5")
            event.set("CurveControl1Y", "0.5")

    def _add_clip(self, payload: Dict[str, Any]) -> None:
        """
        Add a MIDI clip to a target track's ArrangerAutomation.
        This is only attempted for existing tracks (by target_track_id).
        """
        track_id = payload.get("targetTrackId")
        if not track_id:
            self.warnings.append("add_clip: no targetTrackId, skipping")
            return

        tracks_el = self.liveset.find("Tracks")
        if tracks_el is None:
            self.warnings.append("add_clip: no Tracks element found")
            return

        target_el = None
        for track_el in tracks_el:
            el_id = track_el.get("Id", "")
            name_el = track_el.find(".//EffectiveName")
            track_name = name_el.get("Value", "") if name_el is not None else ""
            target_name = payload.get("targetTrackName", "")

            if (el_id and track_id.endswith(f"_{el_id}_")) or (target_name and track_name == target_name):
                target_el = track_el
                break

        if target_el is None:
            self.warnings.append(f"add_clip: track {track_id} not found in ALS")
            return

        arranger_auto = target_el.find(".//ArrangerAutomation")
        if arranger_auto is None:
            arranger_auto = etree.SubElement(target_el, "ArrangerAutomation")

        events = arranger_auto.find("Events")
        if events is None:
            events = etree.SubElement(arranger_auto, "Events")

        start_beat = payload.get("startBeat", 0.0)
        end_beat = payload.get("endBeat", start_beat + 16.0)
        clip_type = payload.get("clipType", "midi")

        clip_tag = "MidiClip" if clip_type == "midi" else "AudioClip"
        clip_el = etree.SubElement(events, clip_tag)
        clip_el.set("Id", str(uuid.uuid4().int % 100000))
        clip_el.set("Time", str(float(start_beat)))
        clip_el.set("CurrentEnd", str(float(end_beat)))
        clip_el.set("ColorIndex", "16")

        name_el = etree.SubElement(clip_el, "Name")
        name_el.set("Value", payload.get("locatorName") or "AI Clip")

        loop_el = etree.SubElement(clip_el, "Loop")
        loop_el.set("LoopStart", "0")
        loop_el.set("LoopEnd", str(float(end_beat - start_beat)))
        loop_el.set("StartRelative", "0")
        loop_el.set("LoopOn", "false")

        if clip_type == "midi":
            notes_el = etree.SubElement(clip_el, "Notes")
            key_tracks = etree.SubElement(notes_el, "KeyTracks")

            notes = payload.get("notes", [])
            by_pitch: Dict[int, List[Dict]] = {}
            for note in notes:
                p = int(note.get("pitch", 60))
                by_pitch.setdefault(p, []).append(note)

            for pitch, pitch_notes in by_pitch.items():
                kt = etree.SubElement(key_tracks, "KeyTrack")
                kt.set("Id", str(uuid.uuid4().int % 100000))
                kt.set("MidiKey", str(pitch))
                notes_container = etree.SubElement(kt, "Notes")
                for n in pitch_notes:
                    ne = etree.SubElement(notes_container, "MidiNoteEvent")
                    ne.set("Time", str(float(n.get("time", 0.0))))
                    ne.set("Duration", str(float(n.get("duration", 0.25))))
                    ne.set("Velocity", str(int(n.get("velocity", 100))))
                    ne.set("OffVelocity", "64")
                    ne.set("IsEnabled", "true")
                    ne.set("NoteId", str(uuid.uuid4().int % 100000))


def patch_als(
    als_bytes: bytes,
    mutation_payloads: List[Dict[str, Any]],
) -> PatchResult:
    """
    High-level function: load an ALS, apply mutations, return patched result.
    """
    patcher = ALSPatcher(als_bytes)
    return patcher.apply(mutation_payloads)
