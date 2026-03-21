"""
End-to-end tests: upload (bytes) → parse → analyze → propose → patch → validate.
"""
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from services.als_parser.tests.helpers import build_minimal_als, kick_pattern_notes
from services.als_parser.parser import ALSParser
from services.als_parser.completion_engine import generate_completion_plan
from services.als_parser.als_patcher import ALSPatcher, validate_als_bytes
from services.als_parser.weakness_detection import detect_weaknesses
from services.als_parser.role_inference import apply_role_inference
from services.als_parser.section_inference import infer_sections


class TestEndToEndFullPipeline(unittest.TestCase):
    def _build_rich_als(self):
        return build_minimal_als(
            tempo=128.0,
            arrangement_length=256.0,
            tracks=[
                {
                    "name": "Kick",
                    "type": "MidiTrack",
                    "clips": [
                        {"start": 0, "end": 64, "type": "midi", "notes": kick_pattern_notes(bars=16)},
                        {"start": 128, "end": 192, "type": "midi", "notes": kick_pattern_notes(bars=16)},
                    ],
                },
                {
                    "name": "Bass",
                    "type": "MidiTrack",
                    "clips": [
                        {"start": 16, "end": 64, "type": "midi"},
                        {"start": 128, "end": 192, "type": "midi"},
                    ],
                    "devices": [{"class": "Compressor2"}],
                },
                {
                    "name": "Synth Pad",
                    "type": "MidiTrack",
                    "clips": [
                        {"start": 32, "end": 96, "type": "midi"},
                        {"start": 160, "end": 224, "type": "midi"},
                    ],
                },
                {
                    "name": "Hi-Hat",
                    "type": "MidiTrack",
                    "clips": [{"start": 0, "end": 256, "type": "midi"}],
                },
            ],
            locators=[
                {"time": 0.0, "name": "Intro"},
                {"time": 32.0, "name": "Build"},
                {"time": 96.0, "name": "Drop"},
                {"time": 192.0, "name": "Outro"},
            ],
        )

    def test_parse_step(self):
        als = self._build_rich_als()
        parser = ALSParser(project_id="e2e-1")
        graph = parser.parse(als)
        self.assertGreater(len(graph.tracks), 0)
        self.assertAlmostEqual(graph.tempo, 128.0, places=0)

    def test_role_inference_step(self):
        als = self._build_rich_als()
        parser = ALSParser(project_id="e2e-2")
        graph = parser.parse(als)
        apply_role_inference(graph.all_tracks)
        roles = [t.inferred_role for t in graph.tracks]
        self.assertIn("kick", roles, f"Should infer kick role, got: {roles}")

    def test_weakness_detection_step(self):
        als = self._build_rich_als()
        parser = ALSParser(project_id="e2e-3")
        graph = parser.parse(als)
        apply_role_inference(graph.all_tracks)
        weaknesses = detect_weaknesses(graph)
        self.assertIsInstance(weaknesses, list)

    def test_completion_plan_step(self):
        als = self._build_rich_als()
        parser = ALSParser(project_id="e2e-4")
        graph = parser.parse(als)
        apply_role_inference(graph.all_tracks)
        weaknesses = detect_weaknesses(graph)
        plan = generate_completion_plan(graph, weaknesses)
        self.assertIsNotNone(plan)
        self.assertGreater(len(plan.actions), 0)

    def test_patch_step_produces_valid_als(self):
        als = self._build_rich_als()
        parser = ALSParser(project_id="e2e-5")
        graph = parser.parse(als)
        apply_role_inference(graph.all_tracks)
        weaknesses = detect_weaknesses(graph)
        plan = generate_completion_plan(graph, weaknesses)

        # Collect safe mutation payloads and convert to camelCase dicts for the patcher
        safe_payloads = []
        for action in plan.actions:
            for mp in action.mutation_payloads:
                if mp.safe:
                    safe_payloads.append(mp)
                    if len(safe_payloads) >= 5:
                        break
            if len(safe_payloads) >= 5:
                break

        if not safe_payloads:
            self.skipTest("No safe payloads generated — skipping patcher test")

        # Convert MutationPayload dataclasses to camelCase dicts that the patcher expects
        normalized = []
        for p in safe_payloads:
            normalized.append({
                "mutationType": p.mutation_type,
                "startBeat": p.start_beat,
                "endBeat": p.end_beat,
                "locatorName": p.locator_name,
                "targetTrackId": p.target_track_id,
                "targetTrackName": p.target_track_name,
                "automationParameter": p.automation_parameter,
                "automationPoints": p.automation_points,
                "notes": p.notes,
                "clipType": p.clip_type,
                "newTrackName": p.new_track_name,
                "safe": p.safe,
            })

        patcher = ALSPatcher(als)
        result = patcher.apply(normalized)
        self.assertGreater(len(result.mutations_applied), 0, "Should apply at least one mutation")

        if result.als_bytes:
            valid, err = validate_als_bytes(result.als_bytes)
            self.assertTrue(valid, f"Patched ALS failed validation: {err}")

    def test_full_pipeline_produces_plan_with_beat_coordinates(self):
        als = self._build_rich_als()
        parser = ALSParser(project_id="e2e-6")
        graph = parser.parse(als)
        apply_role_inference(graph.all_tracks)
        weaknesses = detect_weaknesses(graph)
        plan = generate_completion_plan(graph, weaknesses)

        for action in plan.actions:
            if action.start_beat is not None:
                self.assertGreaterEqual(action.start_beat, 0.0)
            if action.end_beat is not None and action.start_beat is not None:
                self.assertGreaterEqual(action.end_beat, action.start_beat)


if __name__ == "__main__":
    unittest.main()
