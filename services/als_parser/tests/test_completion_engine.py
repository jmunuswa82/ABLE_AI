"""
Unit tests for the completion engine.

Tests:
- Plan is generated from a ProjectGraph
- Actions have required fields (id, title, priority, confidence, startBeat, endBeat)
- Start/end beats are anchored to actual section coordinates
- Mutation payloads are present and executable
- Priority sorting: critical > high > medium > low
- Actions appropriate for missing elements (no kick, no bass, no outro)
- Completion score is in [0, 1]
"""
import sys
import os
import unittest
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from services.als_parser.models import (
    ProjectGraph, TrackNode, ArrangementSection, SidechainLink, ClipNode,
    AutomationLane, AutomationPoint, DeviceNode, MutationPayload,
)
from services.als_parser.completion_engine import generate_completion_plan


def _make_graph(
    total_beats: float = 256.0,
    tracks: list | None = None,
    sections: list | None = None,
    return_tracks: list | None = None,
) -> ProjectGraph:
    graph = ProjectGraph(project_id="test-plan", source_file="test.als")
    graph.tempo = 128.0
    graph.arrangement_length = total_beats
    graph.parse_quality = 0.8
    graph.style_tags = ["techno", "minimal"]

    for t in (tracks or []):
        graph.tracks.append(t)
    for rt in (return_tracks or []):
        graph.return_tracks.append(rt)
    for s in (sections or []):
        graph.sections.append(s)

    return graph


_track_counter = 0

def _make_track(
    name: str,
    role: str,
    clips: list | None = None,
    automation_lanes: list | None = None,
    devices: list | None = None,
) -> TrackNode:
    global _track_counter
    track_id = f"track_{uuid.uuid4().hex[:8]}"
    track = TrackNode(
        id=track_id,
        name=name,
        type="midi",
        order_index=_track_counter,
        inferred_role=role,
        inferred_confidence=0.9,
    )
    _track_counter += 1
    track.clips = clips or []
    track.automation_lanes = automation_lanes or []
    track.devices = devices or []
    return track


def _make_clip(start: float, end: float) -> ClipNode:
    return ClipNode(
        id=str(uuid.uuid4()),
        track_id="",
        clip_type="midi",
        start=start,
        end=end,
    )


def _make_section(label: str, start: float, end: float) -> ArrangementSection:
    return ArrangementSection(
        id=str(uuid.uuid4()),
        label=label,
        start_bar=start,
        end_bar=end,
        energy_score=0.7,
        density_score=0.6,
    )


class TestCompletionPlanBasic(unittest.TestCase):
    def test_plan_generated(self):
        graph = _make_graph()
        plan = generate_completion_plan(graph, [])
        self.assertIsNotNone(plan)
        self.assertIsInstance(plan.actions, list)

    def test_plan_has_required_fields(self):
        graph = _make_graph(tracks=[_make_track("Kick", "kick")])
        plan = generate_completion_plan(graph, [])
        self.assertIsInstance(plan.summary, str)
        self.assertIsInstance(plan.rationale, str)
        self.assertGreaterEqual(plan.confidence, 0.0)
        self.assertLessEqual(plan.confidence, 1.0)
        self.assertGreaterEqual(plan.completion_score, 0.0)
        self.assertLessEqual(plan.completion_score, 1.0)

    def test_all_actions_have_required_fields(self):
        graph = _make_graph()
        plan = generate_completion_plan(graph, ["no kick", "no bass", "static arrangement"])
        for action in plan.actions:
            self.assertIsNotNone(action.id, f"Action missing id: {action}")
            self.assertIsNotNone(action.title, f"Action missing title: {action}")
            self.assertIn(action.priority, ("critical", "high", "medium", "low"),
                          f"Invalid priority: {action.priority}")
            self.assertGreaterEqual(action.confidence, 0.0)
            self.assertLessEqual(action.confidence, 1.0)

    def test_completion_score_range(self):
        graph = _make_graph()
        plan = generate_completion_plan(graph, ["no kick", "no bass", "no outro"])
        self.assertGreaterEqual(plan.completion_score, 0.0)
        self.assertLessEqual(plan.completion_score, 1.0)


class TestActionPrioritySorting(unittest.TestCase):
    def test_critical_before_high_before_medium(self):
        graph = _make_graph()
        plan = generate_completion_plan(graph, ["no kick", "no bass", "static"])
        priorities = [a.priority for a in plan.actions]
        prio_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        prio_nums = [prio_order.get(p, 99) for p in priorities]
        self.assertEqual(
            prio_nums, sorted(prio_nums),
            f"Actions not sorted by priority: {priorities}"
        )


class TestActionBeatAnchoring(unittest.TestCase):
    def test_action_beats_within_arrangement(self):
        total_beats = 256.0
        graph = _make_graph(total_beats=total_beats)
        plan = generate_completion_plan(graph, [])
        for action in plan.actions:
            if action.start_beat is not None:
                self.assertGreaterEqual(action.start_beat, 0.0,
                                        f"start_beat < 0 for action: {action.title}")
            if action.end_beat is not None:
                self.assertGreaterEqual(action.end_beat, 0.0,
                                        f"end_beat < 0 for action: {action.title}")

    def test_action_with_section_uses_section_beats(self):
        """Actions targeting a section should use that section's beat coordinates."""
        section = _make_section("Breakdown", start=64.0, end=128.0)
        graph = _make_graph(
            total_beats=256.0,
            tracks=[_make_track("Kick", "kick"), _make_track("Bass", "bass")],
            sections=[section],
        )
        plan = generate_completion_plan(graph, ["static arrangement"])
        # Find any action that mentions the breakdown or a section-anchored beat range
        section_actions = [a for a in plan.actions if a.start_beat is not None and a.start_beat >= 64.0]
        # At least one action should be in the breakdown's beat range
        self.assertGreater(len(section_actions), 0, "Expected at least one action anchored to section beats")

    def test_start_beat_le_end_beat(self):
        graph = _make_graph()
        plan = generate_completion_plan(graph, ["no kick", "no bass"])
        for action in plan.actions:
            if action.start_beat is not None and action.end_beat is not None:
                self.assertLessEqual(
                    action.start_beat, action.end_beat,
                    f"start_beat > end_beat for action: {action.title}"
                )


class TestMutationPayloads(unittest.TestCase):
    def test_mutation_payloads_present_on_key_actions(self):
        """Critical and high priority actions should have mutation payloads."""
        graph = _make_graph()
        plan = generate_completion_plan(graph, ["no kick", "no bass", "no outro"])
        critical_and_high = [a for a in plan.actions if a.priority in ("critical", "high")]
        actions_with_payloads = [a for a in critical_and_high if a.mutation_payloads]
        self.assertGreater(len(actions_with_payloads), 0,
                           "At least some critical/high actions should have mutation payloads")

    def test_mutation_payload_fields(self):
        graph = _make_graph()
        plan = generate_completion_plan(graph, ["no kick"])
        for action in plan.actions:
            for mp in action.mutation_payloads:
                self.assertIsNotNone(mp.mutation_type, "Mutation payload missing mutation_type")
                self.assertIsInstance(mp.start_beat, (int, float))
                self.assertIn(mp.mutation_type, (
                    "add_locator", "add_automation", "add_clip",
                    "extend_clip", "add_sidechain_proposal",
                ))

    def test_add_locator_mutations_are_safe(self):
        graph = _make_graph()
        plan = generate_completion_plan(graph, ["no outro"])
        for action in plan.actions:
            for mp in action.mutation_payloads:
                if mp.mutation_type == "add_locator":
                    self.assertTrue(mp.safe, "add_locator mutations should be marked safe")


class TestMissingElementDetection(unittest.TestCase):
    def test_no_kick_generates_kick_action(self):
        graph = _make_graph(tracks=[_make_track("Bass", "bass")])
        plan = generate_completion_plan(graph, ["no kick"])
        kick_actions = [a for a in plan.actions
                        if "kick" in a.title.lower() or "kick" in a.description.lower()]
        self.assertGreater(len(kick_actions), 0, "Should generate a kick action when no kick track")

    def test_no_bass_generates_bass_action(self):
        graph = _make_graph(tracks=[_make_track("Kick", "kick")])
        plan = generate_completion_plan(graph, ["no bass"])
        bass_actions = [a for a in plan.actions
                        if "bass" in a.title.lower() or "bass" in a.description.lower()]
        self.assertGreater(len(bass_actions), 0, "Should generate a bass action when no bass track")

    def test_no_outro_generates_outro_action(self):
        graph = _make_graph(
            total_beats=256.0,
            tracks=[_make_track("Kick", "kick"), _make_track("Bass", "bass")],
        )
        plan = generate_completion_plan(graph, [])
        outro_actions = [a for a in plan.actions
                         if "outro" in a.title.lower() or "outro" in a.description.lower()]
        self.assertGreater(len(outro_actions), 0, "Should generate an outro action")

    def test_short_track_gets_extend_action(self):
        graph = _make_graph(total_beats=32.0)  # Only 8 bars — very short
        plan = generate_completion_plan(graph, [])
        extend_actions = [a for a in plan.actions
                          if "extend" in a.title.lower() or "length" in a.title.lower()]
        self.assertGreater(len(extend_actions), 0, "Short track should get an extend action")

    def test_static_arrangement_generates_automation_actions(self):
        graph = _make_graph(
            tracks=[
                _make_track("Kick", "kick", clips=[_make_clip(0, 128)]),
                _make_track("Bass", "bass", clips=[_make_clip(0, 128)]),
            ],
        )
        plan = generate_completion_plan(graph, ["static arrangement", "no automation"])
        auto_actions = [a for a in plan.actions if "automation" in a.description.lower()
                        or "filter" in a.title.lower() or a.adds_automation]
        self.assertGreater(len(auto_actions), 0, "Static arrangement should generate automation actions")


class TestSidechainProposals(unittest.TestCase):
    def test_sidechain_proposal_generated_when_no_sidechain(self):
        """
        Sidechain proposals come from AI_PROPOSED links in graph.sidechain_links.
        We parse a synthetic ALS with kick+bass tracks — the parser now calls role inference
        before sidechain detection, so AI_PROPOSED links will be in the graph.
        """
        from services.als_parser.tests.helpers import build_minimal_als
        from services.als_parser.parser import ALSParser

        als = build_minimal_als(tracks=[
            {"name": "Kick", "type": "MidiTrack", "clips": []},
            {"name": "Bass", "type": "MidiTrack", "clips": []},
        ])
        parser = ALSParser(project_id="sc-test")
        graph = parser.parse(als)

        plan = generate_completion_plan(graph, [])
        sc_actions = [a for a in plan.actions
                      if any(mp.mutation_type == "add_sidechain_proposal"
                             for mp in a.mutation_payloads)]
        self.assertGreater(len(sc_actions), 0,
                           "Should propose sidechain when kick+bass present but no SC detected")


if __name__ == "__main__":
    unittest.main()
