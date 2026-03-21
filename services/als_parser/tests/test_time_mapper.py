"""
Tests for time-signature-aware beat-to-bar conversion.
These tests validate that _beats_per_bar() and _bars_label() correctly handle
common time signatures used in electronic music production.
"""
import unittest
from ..completion_engine import _beats_per_bar, _bars_label, _bl
from ..models import ProjectGraph


def _make_graph(numerator: int = 4, denominator: int = 4) -> ProjectGraph:
    """Create a minimal ProjectGraph with the given time signature."""
    return ProjectGraph(
        project_id="ts_test",
        source_file="test.als",
        time_signature_numerator=numerator,
        time_signature_denominator=denominator,
        arrangement_length=128.0,
    )


class TestBeatsPerBar(unittest.TestCase):
    """_beats_per_bar() must return correct quarter-note beats per bar."""

    def test_4_4_returns_4(self):
        g = _make_graph(4, 4)
        self.assertAlmostEqual(_beats_per_bar(g), 4.0)

    def test_3_4_returns_3(self):
        g = _make_graph(3, 4)
        self.assertAlmostEqual(_beats_per_bar(g), 3.0)

    def test_6_8_returns_3(self):
        # 6/8 → 6 * (4/8) = 6 * 0.5 = 3.0 quarter-note beats per bar
        g = _make_graph(6, 8)
        self.assertAlmostEqual(_beats_per_bar(g), 3.0)

    def test_5_4_returns_5(self):
        g = _make_graph(5, 4)
        self.assertAlmostEqual(_beats_per_bar(g), 5.0)

    def test_7_8_returns_3_5(self):
        # 7/8 → 7 * (4/8) = 7 * 0.5 = 3.5 quarter-note beats per bar
        g = _make_graph(7, 8)
        self.assertAlmostEqual(_beats_per_bar(g), 3.5)

    def test_2_2_returns_4(self):
        # 2/2 (cut time) → 2 * (4/2) = 2 * 2 = 4.0 quarter-note beats per bar
        g = _make_graph(2, 2)
        self.assertAlmostEqual(_beats_per_bar(g), 4.0)

    def test_missing_time_signature_defaults_to_4_4(self):
        # ProjectGraph always has time_signature_numerator/denominator defaults of 4/4
        g = ProjectGraph(project_id="default_ts", source_file="test.als")
        self.assertAlmostEqual(_beats_per_bar(g), 4.0)


class TestBarsLabel(unittest.TestCase):
    """_bars_label() must produce correct bar ranges for given time signatures."""

    def test_4_4_start_of_bar_2(self):
        # Beat 4 is the start of bar 2 in 4/4
        label = _bars_label(4.0, 8.0, beats_per_bar=4.0)
        self.assertEqual(label, "2–3")

    def test_3_4_bar_boundaries(self):
        # Beat 0 → bar 1, beat 3 → bar 2, beat 6 → bar 3
        label = _bars_label(0.0, 6.0, beats_per_bar=3.0)
        self.assertEqual(label, "1–3")

    def test_6_8_bar_boundaries(self):
        # 6/8: 3 quarter-note beats per bar
        label = _bars_label(0.0, 9.0, beats_per_bar=3.0)
        self.assertEqual(label, "1–4")

    def test_5_4_bar_boundaries(self):
        # 5/4: 5 quarter-note beats per bar
        label = _bars_label(0.0, 20.0, beats_per_bar=5.0)
        self.assertEqual(label, "1–5")

    def test_same_bar_returns_single(self):
        # Beats 0–3 are all in bar 1 for 4/4
        label = _bars_label(0.0, 3.0, beats_per_bar=4.0)
        self.assertEqual(label, "1")

    def test_default_beats_per_bar_is_4(self):
        # Default beats_per_bar=4.0 (4/4)
        label = _bars_label(0.0, 16.0)
        self.assertEqual(label, "1–5")


class TestBlConvenienceWrapper(unittest.TestCase):
    """_bl(graph, start, end) must use the graph's time signature."""

    def test_4_4_project(self):
        g = _make_graph(4, 4)
        label = _bl(g, 0.0, 16.0)
        self.assertEqual(label, "1–5")

    def test_3_4_project(self):
        g = _make_graph(3, 4)
        # 9 beats / 3 bpb = 3 bars → bars 1–4
        label = _bl(g, 0.0, 9.0)
        self.assertEqual(label, "1–4")

    def test_6_8_project(self):
        g = _make_graph(6, 8)
        # 6/8 = 3.0 qn/bar; 12 beats / 3 bpb = 4 bars → 1–5
        label = _bl(g, 0.0, 12.0)
        self.assertEqual(label, "1–5")


if __name__ == "__main__":
    unittest.main()
