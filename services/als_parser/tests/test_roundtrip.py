"""
Round-trip tests for ALS container correctness.

These tests verify that the serialisation pipeline produces valid
Ableton-readable output at the binary/container level.
"""
from __future__ import annotations

import gzip
import io
import re
import unittest

from lxml import etree

from als_parser.als_patcher import (
    _serialize_als_gzip,
    validate_als_bytes,
    patch_als,
    _GZIP_OS_UNIX,
)
from als_parser.tests.helpers import build_minimal_als


class TestSerializeAlsGzip(unittest.TestCase):

    def _make_root(self) -> etree._Element:
        root = etree.Element("Ableton")
        root.set("MajorVersion", "5")
        root.set("MinorVersion", "12.0_12120")
        root.set("Creator", "Ableton Live 12.1.1")
        root.set("Revision", "test")
        ls = etree.SubElement(root, "LiveSet")
        tracks = etree.SubElement(ls, "Tracks")
        midi = etree.SubElement(tracks, "MidiTrack")
        midi.set("Id", "100")
        name = etree.SubElement(midi, "Name")
        eff = etree.SubElement(name, "EffectiveName")
        eff.set("Value", "Bass")
        return root

    def test_output_is_valid_gzip(self):
        result = _serialize_als_gzip(self._make_root())
        self.assertEqual(result[:2], b"\x1f\x8b")
        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            xml_data = gz.read()
        self.assertIn(b"<Ableton", xml_data)

    def test_xml_declaration_double_quotes(self):
        result = _serialize_als_gzip(self._make_root())
        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            xml_data = gz.read()
        self.assertTrue(xml_data.startswith(b'<?xml version="1.0" encoding="UTF-8"?>'))

    def test_self_closing_tags_have_space(self):
        result = _serialize_als_gzip(self._make_root())
        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            xml_data = gz.read()
        nospace_count = len(re.findall(rb'[^ ]/>', xml_data))
        self.assertEqual(nospace_count, 0, "All self-closing tags must have a space before />")

    def test_gzip_os_byte_is_unix(self):
        result = _serialize_als_gzip(self._make_root())
        self.assertEqual(result[9], _GZIP_OS_UNIX)

    def test_gzip_mtime_is_zero(self):
        result = _serialize_als_gzip(self._make_root())
        self.assertEqual(result[4:8], b"\x00\x00\x00\x00")

    def test_validate_als_bytes_passes(self):
        result = _serialize_als_gzip(self._make_root())
        valid, err = validate_als_bytes(result)
        self.assertTrue(valid, f"Validation failed: {err}")

    def test_json_attribute_uses_single_quotes(self):
        root = self._make_root()
        vd = etree.SubElement(root.find(".//MidiTrack"), "ViewData")
        vd.set("Value", '{"mode": "play", "notes": [36]}')
        result = _serialize_als_gzip(root)
        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            xml_data = gz.read()
        self.assertIn(b"Value='{\"mode\":", xml_data)
        self.assertNotIn(b"&quot;", xml_data)

    def test_json_attribute_with_apostrophe_stays_valid(self):
        root = self._make_root()
        vd = etree.SubElement(root.find(".//MidiTrack"), "ViewData")
        vd.set("Value", """{"text": "don't stop"}""")
        result = _serialize_als_gzip(root)
        valid, err = validate_als_bytes(result)
        self.assertTrue(valid, f"Apostrophe in JSON attr broke XML: {err}")

        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            xml_data = gz.read()
        parser = etree.XMLParser(recover=False, resolve_entities=False)
        root2 = etree.fromstring(xml_data, parser)
        vd2 = root2.find(".//ViewData")
        self.assertIn("don't stop", vd2.get("Value", ""))

    def test_hex_character_entities(self):
        root = self._make_root()
        ann = etree.SubElement(root.find(".//MidiTrack"), "Annotation")
        ann.set("Value", "line1\r\nline2\ttab")
        result = _serialize_als_gzip(root)
        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            xml_data = gz.read()
        self.assertIn(b"&#x0D;", xml_data)
        self.assertIn(b"&#x0A;", xml_data)
        self.assertIn(b"&#x09;", xml_data)
        self.assertNotIn(b"&#13;", xml_data)
        self.assertNotIn(b"&#10;", xml_data)
        self.assertNotIn(b"&#9;", xml_data)

    def test_trailing_newline(self):
        result = _serialize_als_gzip(self._make_root())
        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            xml_data = gz.read()
        self.assertTrue(xml_data.endswith(b"\n"))


class TestVanillaRoundTrip(unittest.TestCase):

    def test_roundtrip_no_mutations(self):
        als_bytes = build_minimal_als(
            tracks=[{"name": "Kick", "type": "MidiTrack"}],
            locators=[{"time": 0, "name": "Start"}],
        )
        with gzip.GzipFile(fileobj=io.BytesIO(als_bytes)) as gz:
            orig_xml = gz.read()

        parser = etree.XMLParser(recover=True, resolve_entities=False, no_network=True)
        root = etree.fromstring(orig_xml, parser=parser)

        result = _serialize_als_gzip(root)

        valid, err = validate_als_bytes(result)
        self.assertTrue(valid, f"Round-trip validation failed: {err}")

        with gzip.GzipFile(fileobj=io.BytesIO(result)) as gz:
            rt_xml = gz.read()

        rt_parser = etree.XMLParser(recover=False, resolve_entities=False, no_network=True)
        rt_root = etree.fromstring(rt_xml, rt_parser)
        self.assertEqual(rt_root.tag, "Ableton")
        self.assertIsNotNone(rt_root.find("LiveSet"))
        self.assertIsNotNone(rt_root.find("LiveSet/Tracks"))


class TestMutationRoundTrip(unittest.TestCase):

    def test_locator_roundtrip(self):
        als_bytes = build_minimal_als(
            tracks=[{"name": "Kick", "type": "MidiTrack"}],
        )
        mutations = [{"mutationType": "add_locator", "startBeat": 16.0, "locatorName": "Drop"}]
        result = patch_als(als_bytes, mutations)
        self.assertIsNotNone(result.als_bytes, "Patcher must produce output bytes")
        self.assertTrue(result.validation_passed)

        valid, err = validate_als_bytes(result.als_bytes)
        self.assertTrue(valid, f"Post-mutation validation failed: {err}")

        with gzip.GzipFile(fileobj=io.BytesIO(result.als_bytes)) as gz:
            xml_data = gz.read()

        self.assertTrue(xml_data.startswith(b'<?xml version="1.0" encoding="UTF-8"?>'))

        nospace = len(re.findall(rb'[^ ]/>', xml_data))
        self.assertEqual(nospace, 0)

        self.assertEqual(result.als_bytes[9], _GZIP_OS_UNIX)

        parser = etree.XMLParser(recover=False)
        root = etree.fromstring(xml_data, parser)
        cue_points = root.findall(".//CuePoint")
        names = []
        for cp in cue_points:
            name_el = cp.find("Name")
            if name_el is not None:
                names.append(name_el.get("Value", ""))
        self.assertIn("Drop", names)

    def test_clip_add_roundtrip(self):
        als_bytes = build_minimal_als(
            tracks=[{"name": "Synth", "type": "MidiTrack"}],
        )
        mutations = [{
            "mutationType": "add_clip",
            "targetTrackName": "Synth",
            "startBeat": 0,
            "endBeat": 16,
            "notes": [{"pitch": 60, "time": 0, "duration": 4, "velocity": 100}],
        }]
        result = patch_als(als_bytes, mutations)
        self.assertIsNotNone(result.als_bytes)
        self.assertTrue(result.validation_passed)

        valid, err = validate_als_bytes(result.als_bytes)
        self.assertTrue(valid, f"Post-clip-add validation failed: {err}")

    def test_automation_roundtrip(self):
        als_bytes = build_minimal_als(
            tracks=[{
                "name": "Lead",
                "type": "MidiTrack",
                "devices": [{"name": "AutoFilter", "params": ["Frequency"]}],
            }],
        )
        mutations = [{
            "mutationType": "add_automation",
            "targetTrackName": "Lead",
            "automationParameter": "Filter Cutoff",
            "points": [
                {"time": 0, "value": 0.2},
                {"time": 8, "value": 0.8},
                {"time": 16, "value": 0.4},
            ],
        }]
        result = patch_als(als_bytes, mutations)
        self.assertIsNotNone(result.als_bytes)
        self.assertTrue(result.validation_passed)

        valid, err = validate_als_bytes(result.als_bytes)
        self.assertTrue(valid, f"Post-automation validation failed: {err}")


class TestNoFakeAls(unittest.TestCase):

    def test_als_is_gzip_not_zip(self):
        als_bytes = build_minimal_als()
        mutations = [{"mutationType": "add_locator", "time": 0, "name": "Test"}]
        result = patch_als(als_bytes, mutations)
        self.assertIsNotNone(result.als_bytes)
        self.assertEqual(result.als_bytes[:2], b"\x1f\x8b")
        self.assertNotEqual(result.als_bytes[:2], b"PK")

    def test_als_is_not_raw_xml(self):
        als_bytes = build_minimal_als()
        mutations = [{"mutationType": "add_locator", "time": 0, "name": "Test"}]
        result = patch_als(als_bytes, mutations)
        self.assertIsNotNone(result.als_bytes)
        self.assertFalse(result.als_bytes.startswith(b"<?xml"))
        self.assertFalse(result.als_bytes.startswith(b"<Ableton"))


class TestContainerFormatRegression(unittest.TestCase):

    def test_no_single_quote_xml_declaration(self):
        als_bytes = build_minimal_als(
            tracks=[{"name": "Test", "type": "MidiTrack"}],
        )
        mutations = [{"mutationType": "add_locator", "time": 4, "name": "Marker"}]
        result = patch_als(als_bytes, mutations)
        self.assertIsNotNone(result.als_bytes)

        with gzip.GzipFile(fileobj=io.BytesIO(result.als_bytes)) as gz:
            xml_data = gz.read()
        self.assertNotIn(b"version='1.0'", xml_data)
        self.assertNotIn(b"encoding='UTF-8'", xml_data)
        self.assertIn(b'version="1.0"', xml_data)
        self.assertIn(b'encoding="UTF-8"', xml_data)

    def test_reopenable_by_parser(self):
        als_bytes = build_minimal_als(
            tracks=[{"name": "Bass", "type": "MidiTrack"}],
        )
        mutations = [{"mutationType": "add_locator", "time": 8, "name": "Chorus"}]
        result = patch_als(als_bytes, mutations)
        self.assertIsNotNone(result.als_bytes)

        valid, err = validate_als_bytes(result.als_bytes)
        self.assertTrue(valid, f"Output not reopenable: {err}")

        second_result = patch_als(result.als_bytes, [])
        self.assertEqual(len(second_result.mutations_applied), 0)
        self.assertEqual(len(second_result.mutations_skipped), 0)


if __name__ == "__main__":
    unittest.main()
