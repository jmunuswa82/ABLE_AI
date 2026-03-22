"""
Unit tests for ALSPatcher.

Tests:
- validate_als_bytes: valid/invalid gzip, invalid XML
- add_locator: CuePoint written at correct beat position
- add_automation: envelope written to correct track with correct PointeeId
- add_automation fallback to MasterTrack when track not found
- add_clip: MIDI clip written to existing track
- add_clip: creates new track when newTrackName provided and no existing track
- extend_clip: last clip's CurrentEnd updated
- Trust label assignment: SAFE_LOCATOR, SAFE_AUTO, STRUCTURAL
- Post-apply validation: patched bytes are valid gzip XML
"""
import sys
import os
import gzip
import io
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from lxml import etree
from services.als_parser.tests.helpers import build_minimal_als, kick_pattern_notes
from services.als_parser.als_patcher import (
    ALSPatcher, patch_als, validate_als_bytes,
    TRUST_SAFE_LOCATOR, TRUST_SAFE_AUTO, TRUST_STRUCTURAL, TRUST_MANUAL,
)


def _read_xml(als_bytes: bytes) -> etree._Element:
    with gzip.GzipFile(fileobj=io.BytesIO(als_bytes)) as gz:
        xml = gz.read()
    parser = etree.XMLParser(recover=True)
    return etree.fromstring(xml, parser)


class TestValidateAlsBytes(unittest.TestCase):
    def test_valid_als_passes(self):
        data = build_minimal_als()
        ok, err = validate_als_bytes(data)
        self.assertTrue(ok, f"Expected valid ALS to pass, got: {err}")

    def test_empty_bytes_fail(self):
        ok, err = validate_als_bytes(b"")
        self.assertFalse(ok)

    def test_plain_text_fails(self):
        ok, err = validate_als_bytes(b"this is not gzip data at all")
        self.assertFalse(ok)

    def test_gzip_non_xml_fails(self):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(b"not xml content here")
        ok, err = validate_als_bytes(buf.getvalue())
        self.assertFalse(ok)

    def test_gzip_wrong_root_fails(self):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(b'<?xml version="1.0"?><WrongRoot/>')
        ok, err = validate_als_bytes(buf.getvalue())
        self.assertFalse(ok)


class TestPatcherLocator(unittest.TestCase):
    def test_locator_added(self):
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 32.0, "locatorName": "Drop", "safe": True},
        ])
        self.assertIsNotNone(result.als_bytes, "Patched bytes must not be None")
        root = _read_xml(result.als_bytes)
        # CuePoint should be under Locators/Locators
        cue_points = root.findall(".//CuePoint")
        self.assertGreater(len(cue_points), 0, "Should have at least one CuePoint")
        times = [float(cp.get("Time", -1)) for cp in cue_points]
        self.assertIn(32.0, times, f"CuePoint at 32.0 should exist, found: {times}")

    def test_locator_name_written(self):
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "Intro", "safe": True},
        ])
        root = _read_xml(result.als_bytes)
        names = [el.get("Value", "") for el in root.findall(".//CuePoint/Name")]
        self.assertIn("Intro", names)

    def test_locator_trust_label(self):
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "Test", "safe": True},
        ])
        self.assertEqual(result.trust_label, TRUST_SAFE_LOCATOR)

    def test_multiple_locators(self):
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "A", "safe": True},
            {"mutationType": "add_locator", "startBeat": 16.0, "locatorName": "B", "safe": True},
            {"mutationType": "add_locator", "startBeat": 64.0, "locatorName": "C", "safe": True},
        ])
        root = _read_xml(result.als_bytes)
        cue_points = root.findall(".//CuePoint")
        self.assertGreaterEqual(len(cue_points), 3)

    def test_validation_passes_after_locator(self):
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 48.0, "locatorName": "Breakdown", "safe": True},
        ])
        self.assertTrue(result.validation_passed)


class TestPatcherAutomation(unittest.TestCase):
    def test_automation_written_to_track(self):
        als = build_minimal_als(tracks=[{
            "name": "Bass",
            "type": "MidiTrack",
            "clips": [],
            "devices": [{"class": "AutoFilter", "automationTargets": {"Cutoff": 12345}}],
        }])
        result = patch_als(als, [{
            "mutationType": "add_automation",
            "targetTrackName": "Bass",
            "automationParameter": "Filter Cutoff",
            "startBeat": 0.0,
            "endBeat": 32.0,
            "automationPoints": [{"time": 0.0, "value": 0.2}, {"time": 32.0, "value": 0.8}],
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)
        root = _read_xml(result.als_bytes)
        envelopes = root.findall(".//AutomationEnvelope")
        self.assertGreater(len(envelopes), 0, "Should have written at least one automation envelope")

    def test_automation_points_written(self):
        als = build_minimal_als(tracks=[{
            "name": "Lead",
            "type": "MidiTrack",
            "clips": [],
            "devices": [{"class": "AutoFilter", "automationTargets": {"DryWet": 99999}}],
        }])
        result = patch_als(als, [{
            "mutationType": "add_automation",
            "targetTrackName": "Lead",
            "automationParameter": "Dry/Wet",
            "startBeat": 8.0,
            "endBeat": 24.0,
            "automationPoints": [
                {"time": 8.0, "value": 0.0},
                {"time": 16.0, "value": 0.5},
                {"time": 24.0, "value": 1.0},
            ],
            "safe": True,
        }])
        root = _read_xml(result.als_bytes)
        events = root.findall(".//AutomationEnvelope//AutomationEvent")
        self.assertGreaterEqual(len(events), 3)

    def test_automation_trust_label(self):
        als = build_minimal_als(tracks=[{"name": "Bass", "type": "MidiTrack"}])
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "X", "safe": True},
            {
                "mutationType": "add_automation",
                "targetTrackName": "Bass",
                "automationParameter": "Volume",
                "startBeat": 0.0, "endBeat": 16.0,
                "automationPoints": [{"time": 0.0, "value": 0.5}, {"time": 16.0, "value": 1.0}],
                "safe": True,
            },
        ])
        self.assertEqual(result.trust_label, TRUST_SAFE_AUTO)

    def test_automation_fallback_with_warning(self):
        """When track not found, automation falls back to master track with a warning."""
        als = build_minimal_als()  # No tracks
        result = patch_als(als, [{
            "mutationType": "add_automation",
            "targetTrackId": "nonexistent_track_id_999",
            "targetTrackName": "Ghost Track",
            "automationParameter": "Volume",
            "startBeat": 0.0, "endBeat": 16.0,
            "automationPoints": [{"time": 0.0, "value": 0.5}],
            "safe": True,
        }])
        # Should still succeed (writes to master) but with a warning
        has_warning = any("not found" in w.lower() or "master" in w.lower() for w in result.warnings)
        self.assertTrue(has_warning, f"Expected warning about fallback, got: {result.warnings}")


class TestPatcherClip(unittest.TestCase):
    def test_clip_added_to_existing_track(self):
        als = build_minimal_als(tracks=[{
            "name": "Kick",
            "type": "MidiTrack",
            "clips": [],
        }])
        notes = kick_pattern_notes(bars=4)
        result = patch_als(als, [{
            "mutationType": "add_clip",
            "targetTrackName": "Kick",
            "startBeat": 0.0,
            "endBeat": 16.0,
            "clipType": "midi",
            "notes": notes,
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)
        root = _read_xml(result.als_bytes)
        clips = root.findall(".//MidiClip")
        self.assertGreater(len(clips), 0, "MidiClip should be present after add_clip")

    def test_clip_creates_new_track(self):
        als = build_minimal_als()  # No tracks
        result = patch_als(als, [{
            "mutationType": "add_clip",
            "newTrackName": "Hi-Hat",
            "startBeat": 0.0,
            "endBeat": 16.0,
            "clipType": "midi",
            "notes": [],
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)
        root = _read_xml(result.als_bytes)
        tracks = root.findall(".//MidiTrack")
        self.assertGreater(len(tracks), 0, "Should create a new MidiTrack")
        # EffectiveName is under <Name><EffectiveName> in Ableton format — use deep search
        track_names = [el.get("Value", "") for el in root.findall(".//MidiTrack//EffectiveName")]
        # Also check UserName in case EffectiveName path differs
        if not track_names:
            track_names = [el.get("Value", "") for el in root.findall(".//MidiTrack//UserName")]
        self.assertIn("Hi-Hat", track_names)

    def test_clip_trust_label_structural(self):
        als = build_minimal_als(tracks=[{"name": "Bass", "type": "MidiTrack"}])
        result = patch_als(als, [{
            "mutationType": "add_clip",
            "targetTrackName": "Bass",
            "startBeat": 0.0, "endBeat": 16.0,
            "clipType": "midi",
            "safe": True,
        }])
        self.assertEqual(result.trust_label, TRUST_STRUCTURAL)

    def test_clip_notes_written(self):
        als = build_minimal_als(tracks=[{"name": "Kick", "type": "MidiTrack"}])
        notes = kick_pattern_notes(bars=1)
        result = patch_als(als, [{
            "mutationType": "add_clip",
            "targetTrackName": "Kick",
            "startBeat": 0.0, "endBeat": 4.0,
            "clipType": "midi",
            "notes": notes,
            "safe": True,
        }])
        root = _read_xml(result.als_bytes)
        note_events = root.findall(".//MidiNoteEvent")
        self.assertGreater(len(note_events), 0)


class TestPatcherExtendClip(unittest.TestCase):
    def test_extend_last_clip(self):
        als = build_minimal_als(tracks=[{
            "name": "Bass",
            "type": "MidiTrack",
            "clips": [{"start": 0.0, "end": 32.0}],
        }])
        result = patch_als(als, [{
            "mutationType": "extend_clip",
            "targetTrackName": "Bass",
            "endBeat": 64.0,
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)
        root = _read_xml(result.als_bytes)
        clips = root.findall(".//MidiClip") + root.findall(".//AudioClip")
        ends = [float(c.get("CurrentEnd", 0)) for c in clips]
        self.assertIn(64.0, ends, f"Clip should be extended to 64.0, found: {ends}")


class TestPatcherSafetyAndSkipping(unittest.TestCase):
    def test_unsafe_mutation_skipped(self):
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "Safe", "safe": True},
            {"mutationType": "add_locator", "startBeat": 16.0, "locatorName": "Unsafe", "safe": False},
        ])
        self.assertEqual(len(result.mutations_applied), 1)
        self.assertEqual(len(result.mutations_skipped), 1)

    def test_sidechain_proposal_always_skipped(self):
        als = build_minimal_als()
        result = patch_als(als, [{
            "mutationType": "add_sidechain_proposal",
            "targetTrackName": "Bass",
            "safe": True,
        }])
        self.assertEqual(len(result.mutations_applied), 0)
        self.assertGreater(len(result.mutations_skipped), 0)

    def test_no_applied_mutations_returns_no_bytes(self):
        als = build_minimal_als()
        result = patch_als(als, [{
            "mutationType": "add_sidechain_proposal",
            "safe": True,
        }])
        self.assertIsNone(result.als_bytes)
        self.assertEqual(result.trust_label, TRUST_MANUAL)

    def test_validation_passes_after_mixed_mutations(self):
        als = build_minimal_als(tracks=[{"name": "Kick", "type": "MidiTrack"}])
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "A", "safe": True},
            {"mutationType": "add_clip", "targetTrackName": "Kick",
             "startBeat": 0.0, "endBeat": 16.0, "clipType": "midi",
             "notes": kick_pattern_notes(bars=4), "safe": True},
        ])
        self.assertTrue(result.validation_passed)
        self.assertIsNotNone(result.als_bytes)

    def test_unknown_mutation_type_skipped(self):
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0, "locatorName": "L", "safe": True},
            {"mutationType": "totally_unknown_type", "safe": True},
        ])
        skipped_types = [s["type"] for s in result.mutations_skipped]
        self.assertIn("totally_unknown_type", skipped_types)


class TestIDAllocatorInvariants(unittest.TestCase):
    """
    Property/invariant tests for the IDAllocator.
    All new IDs must be unique and above any pre-existing ID in the document.
    """

    def _get_all_ids(self, als_bytes: bytes) -> list[int]:
        """Extract all integer Id attribute values from a patched ALS."""
        from lxml import etree
        root = _read_xml(als_bytes)
        ids = []
        for elem in root.iter():
            raw = elem.get("Id", "")
            if raw:
                try:
                    ids.append(int(raw))
                except ValueError:
                    pass
        return ids

    def test_no_duplicate_ids_after_locators(self):
        """Adding multiple locators must not produce duplicate IDs."""
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "A", "safe": True},
            {"mutationType": "add_locator", "startBeat": 16.0, "locatorName": "B", "safe": True},
            {"mutationType": "add_locator", "startBeat": 32.0, "locatorName": "C", "safe": True},
            {"mutationType": "add_locator", "startBeat": 48.0, "locatorName": "D", "safe": True},
            {"mutationType": "add_locator", "startBeat": 64.0, "locatorName": "E", "safe": True},
        ])
        self.assertIsNotNone(result.als_bytes)
        ids = self._get_all_ids(result.als_bytes)
        self.assertEqual(len(ids), len(set(ids)), f"Duplicate IDs found: {ids}")

    def test_no_duplicate_ids_after_clips(self):
        """Adding clips with notes must not produce duplicate IDs."""
        als = build_minimal_als(tracks=[{"name": "Kick", "type": "MidiTrack"}])
        notes = kick_pattern_notes(bars=4)
        result = patch_als(als, [
            {"mutationType": "add_clip", "targetTrackName": "Kick",
             "startBeat": 0.0, "endBeat": 16.0, "clipType": "midi",
             "notes": notes, "safe": True},
            {"mutationType": "add_clip", "targetTrackName": "Kick",
             "startBeat": 16.0, "endBeat": 32.0, "clipType": "midi",
             "notes": notes, "safe": True},
        ])
        self.assertIsNotNone(result.als_bytes)
        ids = self._get_all_ids(result.als_bytes)
        self.assertEqual(len(ids), len(set(ids)), f"Duplicate IDs after clip adds: {ids}")

    def test_new_ids_above_existing_maximum(self):
        """All IDs added by the patcher must be above the max pre-existing ID."""
        # Build ALS with known high IDs
        als = build_minimal_als(tracks=[{"name": "Track", "type": "MidiTrack"}])
        original_ids = set(self._get_all_ids(als))
        max_original = max(original_ids) if original_ids else 0

        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "X", "safe": True},
            {"mutationType": "add_clip", "targetTrackName": "Track",
             "startBeat": 0.0, "endBeat": 16.0, "clipType": "midi",
             "notes": kick_pattern_notes(bars=1), "safe": True},
        ])
        self.assertIsNotNone(result.als_bytes)
        patched_ids = set(self._get_all_ids(result.als_bytes))
        new_ids = patched_ids - original_ids
        for new_id in new_ids:
            self.assertGreater(
                new_id, max_original,
                f"New ID {new_id} is not above original max {max_original}"
            )

    def test_id_zero_not_assigned_to_new_elements(self):
        """The IDAllocator must never assign Id='0' to newly created elements."""
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "Test", "safe": True},
            {"mutationType": "add_clip", "newTrackName": "NewTrack",
             "startBeat": 0.0, "endBeat": 8.0, "clipType": "midi",
             "notes": [], "safe": True},
        ])
        self.assertIsNotNone(result.als_bytes)
        root = _read_xml(result.als_bytes)
        # Id=0 is only valid for MasterTrack; new elements must not get it
        for elem in root.iter():
            if elem.tag in ("CuePoint", "MidiClip", "AudioClip", "MidiTrack",
                            "AudioTrack", "AutomationEnvelope", "KeyTrack"):
                eid = elem.get("Id", "")
                self.assertNotEqual(eid, "0", f"<{elem.tag}> must not have Id='0'")

    def test_deterministic_id_allocation_order(self):
        """IDs are allocated in strictly increasing order within a session."""
        als = build_minimal_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 0.0, "locatorName": "First", "safe": True},
            {"mutationType": "add_locator", "startBeat": 16.0, "locatorName": "Second", "safe": True},
        ])
        self.assertIsNotNone(result.als_bytes)
        root = _read_xml(result.als_bytes)
        cue_ids = [int(cp.get("Id", "0")) for cp in root.findall(".//CuePoint")]
        # IDs should be monotonically increasing for sequential allocations
        self.assertEqual(cue_ids, sorted(cue_ids), "CuePoint IDs should be in ascending order")

    def test_pre_export_validator_catches_structural_issue(self):
        """validate_pre_export must flag duplicate IDs as hard errors."""
        from lxml import etree as _etree
        from services.als_parser.als_patcher import validate_pre_export
        root = _etree.fromstring(b"""
        <Ableton>
          <LiveSet>
            <Tracks>
              <MidiTrack Id="42"/>
              <MidiTrack Id="42"/>
            </Tracks>
          </LiveSet>
        </Ableton>""")
        passed, errors = validate_pre_export(root)
        self.assertFalse(passed, "Should fail due to duplicate Id=42")
        self.assertTrue(any("42" in e and "DUPLICATE" in e for e in errors),
                        f"Expected DUPLICATE_ID error, got: {errors}")

    def test_pre_export_validator_passes_clean_document(self):
        """validate_pre_export must pass for a clean minimal ALS document."""
        from services.als_parser.als_patcher import validate_pre_export
        als = build_minimal_als(tracks=[
            {"name": "Kick", "type": "MidiTrack"},
            {"name": "Bass", "type": "MidiTrack"},
        ])
        root = _read_xml(als)
        passed, errors = validate_pre_export(root)
        hard_errors = [e for e in errors if not e.startswith("WARN:")]
        self.assertTrue(passed, f"Expected clean document to pass, got: {hard_errors}")


class TestRoundTripSmokeTest(unittest.TestCase):
    """
    Round-trip test: patch a synthetic ALS, re-parse the patched bytes through ALSParser,
    and confirm that the locator, clip, and automation lane appear in the resulting ProjectGraph.

    This exercises both root-cause fixes:
    - Bug 1: track ID extraction (track_<type>_<ableton_id>_<order> → parts[2])
    - Bug 2/3: ArrangerAutomation deep search (.//ArrangerAutomation)
    - Bug 4: locator flat insertion into <Locators>
    """

    def test_round_trip_locator_clip_automation(self):
        from services.als_parser.parser import ALSParser

        track_name = "Synth Lead"
        als = build_minimal_als(
            tempo=120.0,
            tracks=[{
                "name": track_name,
                "type": "MidiTrack",
                "clips": [],
                "devices": [{"class": "AutoFilter", "automationTargets": {"Cutoff": 5001}}],
            }],
        )

        mutations = [
            {
                "mutationType": "add_locator",
                "startBeat": 16.0,
                "locatorName": "Section A",
                "safe": True,
            },
            {
                "mutationType": "add_clip",
                "targetTrackName": track_name,
                "startBeat": 0.0,
                "endBeat": 16.0,
                "clipType": "midi",
                "notes": kick_pattern_notes(bars=4),
                "safe": True,
            },
            {
                "mutationType": "add_automation",
                "targetTrackName": track_name,
                "automationParameter": "Filter Cutoff",
                "startBeat": 0.0,
                "endBeat": 16.0,
                "automationPoints": [
                    {"time": 0.0, "value": 0.2},
                    {"time": 16.0, "value": 0.8},
                ],
                "safe": True,
            },
        ]

        result = patch_als(als, mutations)

        self.assertIsNotNone(result.als_bytes, f"Patched bytes must not be None. Warnings: {result.warnings}")
        self.assertTrue(result.validation_passed, f"Validation failed. Diagnostics: {result.diagnostics}")
        self.assertEqual(len(result.mutations_applied), 3, f"All 3 mutations must apply. Skipped: {result.mutations_skipped}")

        parser = ALSParser(project_id="test_round_trip")
        graph = parser.parse(result.als_bytes)

        # (a) locator appears in graph.locators
        locator_times = [loc["time"] for loc in graph.locators]
        self.assertIn(16.0, locator_times,
                      f"Expected locator at beat 16.0 in graph.locators, got: {graph.locators}")

        # (b) track's clips count increased
        track = next((t for t in graph.tracks if t.name == track_name), None)
        self.assertIsNotNone(track, f"Track '{track_name}' must exist in graph after round-trip")
        self.assertGreater(len(track.clips), 0,
                           f"Track '{track_name}' must have at least 1 clip after add_clip, got: {track.clips}")

        # (c) track's automation_lanes count increased
        self.assertGreater(len(track.automation_lanes), 0,
                           f"Track '{track_name}' must have at least 1 automation lane, got: {track.automation_lanes}")


if __name__ == "__main__":
    unittest.main()
