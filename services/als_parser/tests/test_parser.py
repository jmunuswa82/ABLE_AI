"""
Unit tests for ALSParser.

Tests:
- Tempo extraction
- Track extraction (midi, audio, group)
- Clip position accuracy (beat alignment)
- MIDI note extraction
- Automation lane extraction with PointeeId → param name
- Sidechain detection (DETECTED, INFERRED, AI_PROPOSED)
- Locator extraction
- Parse quality / warnings
"""
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from services.als_parser.tests.helpers import build_minimal_als, kick_pattern_notes
from services.als_parser.parser import ALSParser


class TestParserTempo(unittest.TestCase):
    def test_extracts_tempo(self):
        als = build_minimal_als(tempo=140.0)
        parser = ALSParser(project_id="test-1")
        graph = parser.parse(als)
        self.assertAlmostEqual(graph.tempo, 140.0, places=1)

    def test_default_tempo_fallback(self):
        als = build_minimal_als(tempo=120.0)
        parser = ALSParser(project_id="test-2")
        graph = parser.parse(als)
        self.assertGreater(graph.tempo, 0)


class TestParserTracks(unittest.TestCase):
    def test_midi_track_extracted(self):
        als = build_minimal_als(tracks=[
            {"name": "Kick", "type": "MidiTrack", "clips": [{"start": 0, "end": 16}]},
        ])
        parser = ALSParser(project_id="test-3")
        graph = parser.parse(als)
        self.assertEqual(len(graph.tracks), 1)
        self.assertEqual(graph.tracks[0].name, "Kick")
        self.assertEqual(graph.tracks[0].type, "midi")

    def test_audio_track_extracted(self):
        als = build_minimal_als(tracks=[
            {"name": "Synth Pad", "type": "AudioTrack", "clips": []},
        ])
        parser = ALSParser(project_id="test-4")
        graph = parser.parse(als)
        self.assertEqual(len(graph.tracks), 1)
        self.assertEqual(graph.tracks[0].type, "audio")

    def test_multiple_tracks(self):
        als = build_minimal_als(tracks=[
            {"name": "Kick", "type": "MidiTrack"},
            {"name": "Bass", "type": "MidiTrack"},
            {"name": "Synth", "type": "AudioTrack"},
        ])
        parser = ALSParser(project_id="test-5")
        graph = parser.parse(als)
        self.assertEqual(len(graph.tracks), 3)
        names = [t.name for t in graph.tracks]
        self.assertIn("Kick", names)
        self.assertIn("Bass", names)


class TestParserClipGeometry(unittest.TestCase):
    def test_clip_positions_are_beats(self):
        als = build_minimal_als(tracks=[{
            "name": "Kick",
            "type": "MidiTrack",
            "clips": [
                {"start": 0.0, "end": 16.0},   # bars 1-4
                {"start": 32.0, "end": 48.0},  # bars 9-12
            ],
        }])
        parser = ALSParser(project_id="test-6")
        graph = parser.parse(als)
        track = graph.tracks[0]
        self.assertEqual(len(track.clips), 2)

        c1, c2 = sorted(track.clips, key=lambda c: c.start)
        self.assertAlmostEqual(c1.start, 0.0)
        self.assertAlmostEqual(c1.end, 16.0)
        self.assertAlmostEqual(c2.start, 32.0)
        self.assertAlmostEqual(c2.end, 48.0)

    def test_clip_end_gt_start(self):
        als = build_minimal_als(tracks=[{
            "name": "Test",
            "type": "MidiTrack",
            "clips": [{"start": 8.0, "end": 16.0}],
        }])
        parser = ALSParser(project_id="test-7")
        graph = parser.parse(als)
        clip = graph.tracks[0].clips[0]
        self.assertGreater(clip.end, clip.start)

    def test_bar_alignment(self):
        """Clips at bar boundaries must land on multiples of 4 beats."""
        als = build_minimal_als(tracks=[{
            "name": "Bass",
            "type": "MidiTrack",
            "clips": [{"start": 64.0, "end": 96.0}],  # bars 17-24
        }])
        parser = ALSParser(project_id="test-8")
        graph = parser.parse(als)
        clip = graph.tracks[0].clips[0]
        self.assertEqual(clip.start % 4, 0.0, "Clip start must be bar-aligned (multiple of 4 beats)")
        self.assertEqual(clip.end % 4, 0.0, "Clip end must be bar-aligned (multiple of 4 beats)")


class TestParserMidiNotes(unittest.TestCase):
    def test_midi_notes_extracted(self):
        notes = kick_pattern_notes(bars=1)
        als = build_minimal_als(tracks=[{
            "name": "Kick",
            "type": "MidiTrack",
            "clips": [{"start": 0, "end": 4, "notes": notes}],
        }])
        parser = ALSParser(project_id="test-9")
        graph = parser.parse(als)
        clip = graph.tracks[0].clips[0]
        self.assertGreater(len(clip.midi_notes), 0)
        pitches = [n.pitch for n in clip.midi_notes]
        self.assertIn(36, pitches)  # kick = C1

    def test_midi_note_pitches_in_valid_range(self):
        notes = [{"pitch": p, "time": 0, "duration": 0.25, "velocity": 100} for p in [36, 60, 84]]
        als = build_minimal_als(tracks=[{
            "name": "Test",
            "type": "MidiTrack",
            "clips": [{"start": 0, "end": 4, "notes": notes}],
        }])
        parser = ALSParser(project_id="test-10")
        graph = parser.parse(als)
        clip = graph.tracks[0].clips[0]
        for note in clip.midi_notes:
            self.assertGreaterEqual(note.pitch, 0)
            self.assertLessEqual(note.pitch, 127)


class TestParserAutomation(unittest.TestCase):
    def test_automation_lane_extracted(self):
        als = build_minimal_als(tracks=[{
            "name": "Bass",
            "type": "MidiTrack",
            "clips": [],
            "devices": [{
                "class": "AutoFilter",
                "automationTargets": {"Cutoff": 12345},
            }],
            "automationLanes": [{
                "pointeeId": 12345,
                "points": [
                    {"time": 0, "value": 0.25},
                    {"time": 16, "value": 0.75},
                ],
            }],
        }])
        parser = ALSParser(project_id="test-11")
        graph = parser.parse(als)
        track = graph.tracks[0]
        self.assertGreater(len(track.automation_lanes), 0)
        lane = track.automation_lanes[0]
        self.assertGreater(len(lane.points), 0)

    def test_automation_points_sorted_by_time(self):
        als = build_minimal_als(tracks=[{
            "name": "Lead",
            "type": "MidiTrack",
            "clips": [],
            "devices": [{"class": "AutoFilter", "automationTargets": {"DryWet": 99999}}],
            "automationLanes": [{
                "pointeeId": 99999,
                "points": [
                    {"time": 32, "value": 0.9},
                    {"time": 0, "value": 0.1},
                    {"time": 16, "value": 0.5},
                ],
            }],
        }])
        parser = ALSParser(project_id="test-12")
        graph = parser.parse(als)
        lane = graph.tracks[0].automation_lanes[0]
        times = [p.time for p in lane.points]
        self.assertEqual(times, sorted(times), "Automation points must be sorted by time")

    def test_automation_param_name_resolved(self):
        als = build_minimal_als(tracks=[{
            "name": "Bass",
            "type": "MidiTrack",
            "clips": [],
            "devices": [{"class": "AutoFilter", "automationTargets": {"Cutoff": 55555}}],
            "automationLanes": [{
                "pointeeId": 55555,
                "points": [{"time": 0, "value": 0.5}, {"time": 8, "value": 0.8}],
            }],
        }])
        parser = ALSParser(project_id="test-13")
        graph = parser.parse(als)
        lane = graph.tracks[0].automation_lanes[0]
        self.assertIn("cutoff", lane.parameter_name.lower(),
                      f"Expected 'cutoff' in param name, got: {lane.parameter_name}")


class TestParserSidechainDetection(unittest.TestCase):
    def test_detected_sidechain(self):
        als = build_minimal_als(tracks=[
            {"name": "Kick", "type": "MidiTrack", "clips": []},
            {
                "name": "Bass",
                "type": "MidiTrack",
                "clips": [],
                "devices": [{"class": "Compressor2", "hasSidechain": True}],
            },
        ])
        parser = ALSParser(project_id="test-14")
        graph = parser.parse(als)
        sc_links = graph.sidechain_links
        detected = [l for l in sc_links if "DETECTED" in l.relation_type]
        self.assertGreater(len(detected), 0, "Should detect sidechain from XML evidence")

    def test_no_sidechain_without_evidence(self):
        als = build_minimal_als(tracks=[
            {"name": "Synth Pad", "type": "MidiTrack"},
            {"name": "Lead", "type": "MidiTrack"},
        ])
        parser = ALSParser(project_id="test-15")
        graph = parser.parse(als)
        detected = [l for l in graph.sidechain_links if "DETECTED" in l.relation_type]
        self.assertEqual(len(detected), 0, "No DETECTED links without device evidence")

    def test_sidechain_confidence_range(self):
        als = build_minimal_als(tracks=[
            {"name": "Kick", "type": "MidiTrack"},
            {
                "name": "Bass",
                "type": "MidiTrack",
                "devices": [{"class": "Compressor2", "hasSidechain": True}],
            },
        ])
        parser = ALSParser(project_id="test-16")
        graph = parser.parse(als)
        for link in graph.sidechain_links:
            self.assertGreaterEqual(link.confidence, 0.0)
            self.assertLessEqual(link.confidence, 1.0)


class TestParserLocators(unittest.TestCase):
    def test_locators_extracted(self):
        als = build_minimal_als(locators=[
            {"time": 0.0, "name": "Intro"},
            {"time": 32.0, "name": "Drop"},
            {"time": 96.0, "name": "Outro"},
        ])
        parser = ALSParser(project_id="test-17")
        graph = parser.parse(als)
        self.assertGreaterEqual(len(graph.locators), 2,
                                 "Should extract at least 2 locators from the ALS")

    def test_locator_times_are_positive(self):
        als = build_minimal_als(locators=[
            {"time": 16.0, "name": "Breakdown"},
        ])
        parser = ALSParser(project_id="test-18")
        graph = parser.parse(als)
        for loc in graph.locators:
            # locators are stored as dicts: {"time": float, "name": str}
            t = loc.get("time", 0.0) if isinstance(loc, dict) else loc.time
            self.assertGreaterEqual(t, 0.0)


class TestParserEmpty(unittest.TestCase):
    def test_empty_als_no_tracks(self):
        als = build_minimal_als()
        parser = ALSParser(project_id="test-19")
        graph = parser.parse(als)
        self.assertIsNotNone(graph)
        self.assertIsInstance(graph.tracks, list)

    def test_parse_quality_field_present(self):
        als = build_minimal_als(tracks=[{"name": "Kick", "type": "MidiTrack"}])
        parser = ALSParser(project_id="test-20")
        graph = parser.parse(als)
        self.assertGreaterEqual(graph.parse_quality, 0.0)
        self.assertLessEqual(graph.parse_quality, 1.0)


if __name__ == "__main__":
    unittest.main()
