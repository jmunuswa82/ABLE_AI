"""
Test helpers: generate synthetic .als (gzip XML) bytes for unit testing.
"""
from __future__ import annotations

import gzip
import io
from lxml import etree


def build_minimal_als(
    tempo: float = 128.0,
    tracks: list | None = None,
    locators: list | None = None,
    arrangement_length: float = 128.0,
) -> bytes:
    """
    Build a minimal valid Ableton .als file (gzip-compressed XML) for testing.

    tracks: list of dicts with keys: name, type (MidiTrack|AudioTrack), clips, devices
    locators: list of dicts with keys: time, name
    """
    root = etree.Element("Ableton")
    root.set("MajorVersion", "11")
    root.set("MinorVersion", "0")
    root.set("Creator", "TestHelper")
    root.set("Revision", "0")

    ls = etree.SubElement(root, "LiveSet")

    # Master track (needed for tempo)
    master = etree.SubElement(ls, "MasterTrack")
    master.set("Id", "0")
    eff_name = etree.SubElement(master, "EffectiveName")
    eff_name.set("Value", "Master")
    master_dc = etree.SubElement(master, "DeviceChain")
    master_mixer = etree.SubElement(master_dc, "Mixer")
    tempo_el = etree.SubElement(master_mixer, "Tempo")
    tempo_manual = etree.SubElement(tempo_el, "Manual")
    tempo_manual.set("Value", str(tempo))
    master_arr = etree.SubElement(master, "ArrangerAutomation")
    master_events = etree.SubElement(master_arr, "Events")

    # Time signature
    ts = etree.SubElement(ls, "TimeSelection")
    ts.set("AnchorTime", "0")
    ts.set("CurrentTime", "0")

    # Arrangement length
    arr_end_el = etree.SubElement(ls, "Loop")
    arr_end_el.set("LoopStart", "0")
    arr_end_el.set("LoopEnd", str(arrangement_length))
    arr_end_el.set("LoopOn", "false")

    # Locators
    if locators:
        locs_el = etree.SubElement(ls, "Locators")
        locs_inner = etree.SubElement(locs_el, "Locators")
        for i, loc in enumerate(locators):
            cue = etree.SubElement(locs_inner, "CuePoint")
            cue.set("Id", str(i + 1))
            cue.set("Time", str(float(loc.get("time", 0))))
            name_el = etree.SubElement(cue, "Name")
            name_el.set("Value", loc.get("name", "Cue"))
            ann_el = etree.SubElement(cue, "Annotation")
            ann_el.set("Value", "")
            ss = etree.SubElement(cue, "IsSongStart")
            ss.set("Value", "false")

    # Tracks
    tracks_el = etree.SubElement(ls, "Tracks")
    for i, t in enumerate(tracks or []):
        tag = t.get("type", "MidiTrack")
        track_el = etree.SubElement(tracks_el, tag)
        ableton_id = str(100 + i)
        track_el.set("Id", ableton_id)

        # Track name must be nested under <Name><UserName> for the parser to read it
        name_wrapper = etree.SubElement(track_el, "Name")
        un = etree.SubElement(name_wrapper, "UserName")
        un.set("Value", t.get("name", f"Track {i+1}"))
        en = etree.SubElement(name_wrapper, "EffectiveName")
        en.set("Value", t.get("name", f"Track {i+1}"))
        ci = etree.SubElement(track_el, "ColorIndex")
        ci.set("Value", str(t.get("colorIndex", 16)))

        dc = etree.SubElement(track_el, "DeviceChain")
        devices_el = etree.SubElement(dc, "Devices")

        # Add devices
        for d in t.get("devices", []):
            dev_tag = d.get("class", "AutoFilter")
            dev_el = etree.SubElement(devices_el, dev_tag)
            dev_el.set("Id", str(200 + i))
            on_el = etree.SubElement(dev_el, "On")
            on_el.set("Value", "true")

            # Add automation targets for the device
            for param_tag, pointee_id in d.get("automationTargets", {}).items():
                param_el = etree.SubElement(dev_el, param_tag)
                manual_el = etree.SubElement(param_el, "Manual")
                manual_el.set("Value", "0.5")
                auto_target = etree.SubElement(param_el, "AutomationTarget")
                auto_target.set("Id", str(pointee_id))

            if d.get("hasSidechain"):
                sc_el = etree.SubElement(dev_el, "SidechainInput")
                sc_el.set("Value", "1")

        mixer = etree.SubElement(dc, "Mixer")
        vol_el = etree.SubElement(mixer, "Volume")
        vol_manual = etree.SubElement(vol_el, "Manual")
        vol_manual.set("Value", "1")
        vol_auto = etree.SubElement(vol_el, "AutomationTarget")
        vol_auto.set("Id", str(300 + i))

        # Add clips to ArrangerAutomation
        arr_auto = etree.SubElement(track_el, "ArrangerAutomation")
        events = etree.SubElement(arr_auto, "Events")
        for j, c in enumerate(t.get("clips", [])):
            clip_tag = "MidiClip" if c.get("type", "midi") == "midi" else "AudioClip"
            clip_el = etree.SubElement(events, clip_tag)
            clip_el.set("Id", str(400 + i * 10 + j))
            clip_el.set("Time", str(float(c.get("start", 0))))
            clip_el.set("CurrentEnd", str(float(c.get("end", 16))))
            clip_el.set("ColorIndex", "16")
            name_el = etree.SubElement(clip_el, "Name")
            name_el.set("Value", c.get("name", "Clip"))
            loop_el = etree.SubElement(clip_el, "Loop")
            clip_len = float(c.get("end", 16)) - float(c.get("start", 0))
            loop_el.set("LoopStart", "0")
            loop_el.set("LoopEnd", str(clip_len))
            loop_el.set("StartRelative", "0")
            loop_el.set("LoopOn", "false")
            loop_el.set("OutMarker", str(clip_len))

            if c.get("type", "midi") == "midi" and c.get("notes"):
                notes_el = etree.SubElement(clip_el, "Notes")
                key_tracks_el = etree.SubElement(notes_el, "KeyTracks")
                for pitch, note_list in _group_notes_by_pitch(c.get("notes", [])).items():
                    kt = etree.SubElement(key_tracks_el, "KeyTrack")
                    kt.set("Id", str(500 + pitch))
                    kt.set("MidiKey", str(pitch))
                    notes_container = etree.SubElement(kt, "Notes")
                    for n in note_list:
                        ne = etree.SubElement(notes_container, "MidiNoteEvent")
                        ne.set("Time", str(n.get("time", 0)))
                        ne.set("Duration", str(n.get("duration", 0.25)))
                        ne.set("Velocity", str(n.get("velocity", 100)))
                        ne.set("OffVelocity", "64")
                        ne.set("IsEnabled", "true")
                        ne.set("NoteId", str(600 + pitch))
                nid = etree.SubElement(notes_el, "NextNoteId")
                nid.set("Value", str(len(c.get("notes", [])) + 1))

        # Add automation lanes
        if t.get("automationLanes"):
            auto_envs = etree.SubElement(arr_auto, "AutomationEnvelopes")
            envs = etree.SubElement(auto_envs, "Envelopes")
            for lane in t.get("automationLanes", []):
                env = etree.SubElement(envs, "AutomationEnvelope")
                env.set("Id", str(700 + i))
                env_target = etree.SubElement(env, "EnvelopeTarget")
                pid = etree.SubElement(env_target, "PointeeId")
                pid.set("Value", str(lane.get("pointeeId", 300 + i)))
                automation_el = etree.SubElement(env, "Automation")
                events_auto = etree.SubElement(automation_el, "Events")
                for pt in lane.get("points", []):
                    ae = etree.SubElement(events_auto, "AutomationEvent")
                    ae.set("Time", str(pt.get("time", 0)))
                    ae.set("Value", str(pt.get("value", 0.5)))

    xml_bytes = etree.tostring(root, xml_declaration=True, encoding="UTF-8", pretty_print=True)
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(xml_bytes)
    return buf.getvalue()


def _group_notes_by_pitch(notes: list) -> dict:
    by_pitch: dict = {}
    for n in notes:
        p = int(n.get("pitch", 60))
        by_pitch.setdefault(p, []).append(n)
    return by_pitch


def kick_pattern_notes(bars: int = 4) -> list:
    """Generate a 4-on-the-floor kick pattern for the given number of bars."""
    notes = []
    for bar in range(bars):
        for beat in range(4):
            notes.append({
                "pitch": 36,
                "time": float(bar * 4 + beat),
                "duration": 0.25,
                "velocity": 100 if beat == 0 else 95,
            })
    return notes
