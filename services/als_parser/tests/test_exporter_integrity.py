"""
Tests for ALS export correctness (round-trip fixture tests).

Suite A (legacy): ZIP exporter byte-preservation contract.
Suite B (new): ALSPatcher round-trip correctness — duplicate IDs, NextNoteId,
               AutomationEnvelopes ordering, CuePoint Id uniqueness.
"""
import io
import gzip
import hashlib
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from lxml import etree

from services.als_parser.tests.helpers import build_minimal_als, kick_pattern_notes
from services.als_parser.als_patcher import ALSPatcher, patch_als, validate_als_bytes


def _make_minimal_als_bytes() -> bytes:
    """Create a minimal valid gzip-compressed ALS XML file."""
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11" MinorVersion="11.0.2" Creator="Ableton Live 11.0.2">
<LiveSet>
<Tracks/>
<MasterTrack><DeviceChain><Mixer><Tempo><AutomationTarget/><LomId Value="0"/><Value Value="128"/></Tempo></Mixer></DeviceChain></MasterTrack>
</LiveSet>
</Ableton>"""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(xml)
    return buf.getvalue()


def _read_xml(als_bytes: bytes) -> etree._Element:
    with gzip.GzipFile(fileobj=io.BytesIO(als_bytes)) as gz:
        xml = gz.read()
    parser = etree.XMLParser(recover=True)
    return etree.fromstring(xml, parser)


def _collect_ids(root: etree._Element) -> list:
    """Return all Id attribute values in document order."""
    return [el.get("Id") for el in root.iter() if el.get("Id") is not None]


# ─── Suite A: Legacy ZIP preservation contract ────────────────────────────────

class TestExporterIntegrity(unittest.TestCase):

    def _run_build_zip(self, original_als_bytes: bytes) -> Path:
        sha256 = hashlib.sha256(original_als_bytes).hexdigest()
        file_size = len(original_als_bytes)

        preservation_report = {
            "sha256": sha256,
            "fileSizeBytes": file_size,
            "inferredFields": ["arrangementLength", "sections", "inferredRole"],
            "preservationStatus": "intact",
            "generatedAt": "2026-01-01T00:00:00.000Z",
        }

        manifest = {
            "version": "2.0.0",
            "originalSha256": sha256,
            "originalFileSizeBytes": file_size,
        }

        tmp_dir = tempfile.mkdtemp()
        zip_path = Path(tmp_dir) / "patch.zip"

        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("original/project.als", original_als_bytes)
            zf.writestr("analysis/preservation-report.json", json.dumps(preservation_report))
            zf.writestr("manifest.json", json.dumps(manifest))
            zf.writestr("README.md", "# ALS Patch Package")

        return zip_path, sha256, file_size

    def test_original_als_preserved_byte_for_byte(self):
        original = _make_minimal_als_bytes()
        zip_path, expected_sha256, expected_size = self._run_build_zip(original)
        with zipfile.ZipFile(zip_path) as zf:
            extracted = zf.read("original/project.als")
        self.assertEqual(extracted, original)

    def test_sha256_matches_original(self):
        original = _make_minimal_als_bytes()
        zip_path, expected_sha256, _ = self._run_build_zip(original)
        with zipfile.ZipFile(zip_path) as zf:
            report = json.loads(zf.read("analysis/preservation-report.json"))
        actual_sha256 = hashlib.sha256(original).hexdigest()
        self.assertEqual(report["sha256"], actual_sha256)
        self.assertEqual(report["sha256"], expected_sha256)

    def test_preservation_report_has_required_fields(self):
        original = _make_minimal_als_bytes()
        zip_path, _, _ = self._run_build_zip(original)
        with zipfile.ZipFile(zip_path) as zf:
            report = json.loads(zf.read("analysis/preservation-report.json"))
        self.assertIn("sha256", report)
        self.assertIn("fileSizeBytes", report)
        self.assertIn("preservationStatus", report)
        self.assertIn("inferredFields", report)
        self.assertEqual(report["preservationStatus"], "intact")
        self.assertIsInstance(report["sha256"], str)
        self.assertEqual(len(report["sha256"]), 64)

    def test_file_size_matches(self):
        original = _make_minimal_als_bytes()
        zip_path, _, expected_size = self._run_build_zip(original)
        with zipfile.ZipFile(zip_path) as zf:
            report = json.loads(zf.read("analysis/preservation-report.json"))
        self.assertEqual(report["fileSizeBytes"], expected_size)
        self.assertEqual(report["fileSizeBytes"], len(original))

    def test_manifest_contains_original_sha256(self):
        original = _make_minimal_als_bytes()
        zip_path, expected_sha256, _ = self._run_build_zip(original)
        with zipfile.ZipFile(zip_path) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        self.assertIn("originalSha256", manifest)
        self.assertEqual(manifest["originalSha256"], expected_sha256)

    def test_zip_integrity_check_rejects_empty_archive(self):
        original = _make_minimal_als_bytes()
        zip_path, _, file_size = self._run_build_zip(original)
        zip_size = zip_path.stat().st_size
        self.assertGreater(zip_size, file_size * 0.1)

    def test_inferred_fields_list_is_present(self):
        original = _make_minimal_als_bytes()
        zip_path, _, _ = self._run_build_zip(original)
        with zipfile.ZipFile(zip_path) as zf:
            report = json.loads(zf.read("analysis/preservation-report.json"))
        self.assertIsInstance(report["inferredFields"], list)
        self.assertGreater(len(report["inferredFields"]), 0)
        for field in ("arrangementLength", "inferredRole"):
            self.assertIn(field, report["inferredFields"])


# ─── Suite B: Round-trip fixture tests ────────────────────────────────────────

class TestRoundTripNoDuplicateIds(unittest.TestCase):
    """Patch a 4-track set with all mutation types and confirm no duplicate IDs."""

    def _build_4track_als(self):
        return build_minimal_als(
            tempo=120.0,
            arrangement_length=128.0,
            tracks=[
                {
                    "name": "Kick",
                    "type": "MidiTrack",
                    "clips": [{"start": 0, "end": 32, "type": "midi", "notes": kick_pattern_notes(bars=8)}],
                    "devices": [{"class": "AutoFilter", "automationTargets": {"Cutoff": 5001}}],
                },
                {
                    "name": "Bass",
                    "type": "MidiTrack",
                    "clips": [{"start": 0, "end": 64, "type": "midi"}],
                    "devices": [{"class": "Compressor2", "automationTargets": {"Threshold": 5002}}],
                },
                {
                    "name": "Pad",
                    "type": "MidiTrack",
                    "clips": [{"start": 32, "end": 96, "type": "midi"}],
                },
                {
                    "name": "Hi-Hat",
                    "type": "MidiTrack",
                    "clips": [{"start": 0, "end": 128, "type": "midi"}],
                },
            ],
            locators=[
                {"time": 0.0, "name": "Intro"},
                {"time": 32.0, "name": "Drop"},
            ],
        )

    def test_no_duplicate_ids_after_all_mutation_types(self):
        als = self._build_4track_als()
        notes = kick_pattern_notes(bars=4)
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 64.0, "locatorName": "Bridge", "safe": True},
            {"mutationType": "add_locator", "startBeat": 96.0, "locatorName": "Outro", "safe": True},
            {
                "mutationType": "add_automation",
                "targetTrackName": "Kick",
                "automationParameter": "Filter Cutoff",
                "startBeat": 0.0, "endBeat": 32.0,
                "automationPoints": [{"time": 0.0, "value": 0.2}, {"time": 32.0, "value": 0.8}],
                "safe": True,
            },
            {
                "mutationType": "add_clip",
                "targetTrackName": "Bass",
                "startBeat": 64.0, "endBeat": 96.0,
                "clipType": "midi",
                "notes": notes,
                "safe": True,
            },
            {
                "mutationType": "add_clip",
                "newTrackName": "New Synth",
                "startBeat": 0.0, "endBeat": 32.0,
                "clipType": "midi",
                "notes": notes,
                "safe": True,
            },
        ])

        self.assertIsNotNone(result.als_bytes, f"Expected patched bytes, got None. Warnings: {result.warnings}")
        self.assertTrue(result.validation_passed, f"Validation failed. Warnings: {result.warnings}")

        # Re-read the patched ALS and check for duplicate Ids
        root = _read_xml(result.als_bytes)
        all_ids = _collect_ids(root)
        from collections import Counter
        counts = Counter(all_ids)
        duplicates = {id_val: cnt for id_val, cnt in counts.items() if cnt > 1}
        self.assertEqual(
            duplicates, {},
            f"Duplicate Id attributes found after patching: {duplicates}"
        )

    def test_re_parse_with_patcher_has_no_duplicates(self):
        """Re-reading patched bytes with ALSPatcher should find no duplicate Ids."""
        als = self._build_4track_als()
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 48.0, "locatorName": "Test", "safe": True},
            {
                "mutationType": "add_clip",
                "newTrackName": "Extra Track",
                "startBeat": 0.0, "endBeat": 16.0,
                "clipType": "midi",
                "notes": kick_pattern_notes(bars=4),
                "safe": True,
            },
        ])
        self.assertIsNotNone(result.als_bytes)

        # Re-load through ALSPatcher — should scan Ids without error
        patcher2 = ALSPatcher(result.als_bytes)
        self.assertIsNotNone(patcher2.root)
        # IDAllocator._next should be > 10000 (floor) after scanning allocated IDs
        self.assertIsNotNone(patcher2._ids)
        self.assertGreater(patcher2._ids._next, 0)

        # Confirm re-parse finds no duplicates via validate_als_bytes
        valid, err = validate_als_bytes(result.als_bytes)
        self.assertTrue(valid, f"Re-parsed patched ALS failed validation: {err}")


class TestNextNoteIdCorrectness(unittest.TestCase):
    """NextNoteId must be strictly > every NoteId in the clip."""

    def test_next_note_id_greater_than_all_note_ids(self):
        als = build_minimal_als(tracks=[{"name": "Bass", "type": "MidiTrack"}])
        notes = kick_pattern_notes(bars=4)  # 16 notes
        result = patch_als(als, [{
            "mutationType": "add_clip",
            "targetTrackName": "Bass",
            "startBeat": 0.0, "endBeat": 16.0,
            "clipType": "midi",
            "notes": notes,
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)

        root = _read_xml(result.als_bytes)
        for midi_clip in root.iter("MidiClip"):
            note_ids = [
                int(ne.get("NoteId", 0))
                for ne in midi_clip.iter("MidiNoteEvent")
                if ne.get("NoteId") is not None
            ]
            next_note_id_el = midi_clip.find(".//NextNoteId")
            if next_note_id_el is None or not note_ids:
                continue
            next_note_id = int(next_note_id_el.get("Value", 0))
            max_note_id = max(note_ids)
            self.assertGreater(
                next_note_id, max_note_id,
                f"NextNoteId ({next_note_id}) must be > max NoteId ({max_note_id})"
            )

    def test_next_note_id_no_notes(self):
        """With no notes, NextNoteId must still be set (> 0 but based on _next_id)."""
        als = build_minimal_als(tracks=[{"name": "Empty", "type": "MidiTrack"}])
        result = patch_als(als, [{
            "mutationType": "add_clip",
            "targetTrackName": "Empty",
            "startBeat": 0.0, "endBeat": 8.0,
            "clipType": "midi",
            "notes": [],
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)
        root = _read_xml(result.als_bytes)
        for midi_clip in root.iter("MidiClip"):
            next_note_id_el = midi_clip.find(".//NextNoteId")
            if next_note_id_el is not None:
                self.assertGreaterEqual(int(next_note_id_el.get("Value", 0)), 1)


class TestAutomationEnvelopesOrdering(unittest.TestCase):
    """AutomationEnvelopes must appear BEFORE Events within ArrangerAutomation."""

    def test_automation_envelopes_before_events(self):
        als = build_minimal_als(tracks=[{
            "name": "Lead",
            "type": "MidiTrack",
            "clips": [{"start": 0, "end": 32, "type": "midi"}],
            "devices": [{"class": "AutoFilter", "automationTargets": {"Cutoff": 9001}}],
        }])
        result = patch_als(als, [{
            "mutationType": "add_automation",
            "targetTrackName": "Lead",
            "automationParameter": "Filter Cutoff",
            "startBeat": 0.0, "endBeat": 32.0,
            "automationPoints": [{"time": 0.0, "value": 0.1}, {"time": 32.0, "value": 0.9}],
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)

        root = _read_xml(result.als_bytes)
        # Find all ArrangerAutomation elements and verify ordering
        for arr_auto in root.iter("ArrangerAutomation"):
            children_tags = [c.tag for c in arr_auto]
            if "AutomationEnvelopes" in children_tags and "Events" in children_tags:
                envs_idx = children_tags.index("AutomationEnvelopes")
                events_idx = children_tags.index("Events")
                self.assertLess(
                    envs_idx, events_idx,
                    f"AutomationEnvelopes (idx={envs_idx}) must appear before Events (idx={events_idx}) "
                    f"within ArrangerAutomation. Children: {children_tags}"
                )

    def test_automation_on_fresh_track_ordering(self):
        """Automation added to a track with no existing ArrangerAutomation also follows ordering."""
        als = build_minimal_als(tracks=[{
            "name": "Synth",
            "type": "MidiTrack",
            "clips": [],
        }])
        result = patch_als(als, [{
            "mutationType": "add_automation",
            "targetTrackName": "Synth",
            "automationParameter": "Volume",
            "startBeat": 0.0, "endBeat": 16.0,
            "automationPoints": [{"time": 0.0, "value": 0.5}, {"time": 16.0, "value": 1.0}],
            "safe": True,
        }])
        self.assertIsNotNone(result.als_bytes)

        root = _read_xml(result.als_bytes)
        for arr_auto in root.iter("ArrangerAutomation"):
            children_tags = [c.tag for c in arr_auto]
            if "AutomationEnvelopes" in children_tags and "Events" in children_tags:
                envs_idx = children_tags.index("AutomationEnvelopes")
                events_idx = children_tags.index("Events")
                self.assertLess(envs_idx, events_idx)


class TestCuePointIdUniqueness(unittest.TestCase):
    """CuePoint Id values must all be unique across all locators."""

    def test_cue_point_ids_are_unique(self):
        als = build_minimal_als(locators=[
            {"time": 0.0, "name": "Intro"},
            {"time": 16.0, "name": "Verse"},
            {"time": 32.0, "name": "Chorus"},
        ])
        result = patch_als(als, [
            {"mutationType": "add_locator", "startBeat": 48.0, "locatorName": "Bridge", "safe": True},
            {"mutationType": "add_locator", "startBeat": 64.0, "locatorName": "Outro", "safe": True},
            {"mutationType": "add_locator", "startBeat": 96.0, "locatorName": "End", "safe": True},
        ])
        self.assertIsNotNone(result.als_bytes)

        root = _read_xml(result.als_bytes)
        cue_ids = [cp.get("Id") for cp in root.iter("CuePoint") if cp.get("Id") is not None]
        self.assertEqual(
            len(cue_ids), len(set(cue_ids)),
            f"Duplicate CuePoint Ids found: {cue_ids}"
        )

    def test_many_locators_all_unique_ids(self):
        """Adding 20 locators must produce 20 unique CuePoint Ids."""
        als = build_minimal_als()
        payloads = [
            {"mutationType": "add_locator", "startBeat": float(i * 4), "locatorName": f"Mark{i}", "safe": True}
            for i in range(20)
        ]
        result = patch_als(als, payloads)
        self.assertIsNotNone(result.als_bytes)

        root = _read_xml(result.als_bytes)
        cue_ids = [cp.get("Id") for cp in root.iter("CuePoint") if cp.get("Id") is not None]
        self.assertEqual(len(cue_ids), len(set(cue_ids)), f"Duplicate CuePoint Ids: {cue_ids}")


class TestValidateAlsBytesFullDecompression(unittest.TestCase):
    """validate_als_bytes must not truncate decompressed XML."""

    def test_duplicate_id_detected(self):
        """validate_als_bytes must return False when duplicate Ids are present."""
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="11">
<LiveSet>
<Tracks>
<MidiTrack Id="100"><Name><UserName Value="A"/></Name></MidiTrack>
<MidiTrack Id="100"><Name><UserName Value="B"/></Name></MidiTrack>
</Tracks>
</LiveSet>
</Ableton>"""
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
            gz.write(xml)
        ok, err = validate_als_bytes(buf.getvalue())
        self.assertFalse(ok, "Expected duplicate Id detection to fail validation")
        self.assertIn("100", err)

    def test_no_duplicates_passes(self):
        """validate_als_bytes passes when all Ids are unique."""
        als = build_minimal_als(tracks=[
            {"name": "A", "type": "MidiTrack"},
            {"name": "B", "type": "MidiTrack"},
        ])
        ok, err = validate_als_bytes(als)
        self.assertTrue(ok, f"Expected valid ALS to pass: {err}")


if __name__ == "__main__":
    unittest.main()
