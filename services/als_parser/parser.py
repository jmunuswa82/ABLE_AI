"""
ALS Parser: Robust Ableton Live Set (.als) file parser.

.als files are gzip-compressed XML. This parser:
- Safely decompresses with size limits (gzip bomb protection)
- Parses XML with lxml (tolerant mode)
- Extracts: tempo, time signature, tracks, clips, devices, automation, returns, master
- Degrades gracefully on unknown nodes, emitting precise warnings
- Returns a canonical ProjectGraph
"""

from __future__ import annotations

import gzip
import io
import uuid
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from lxml import etree

from .models import (
    ProjectGraph, TrackNode, ClipNode, DeviceNode,
    AutomationLane, AutomationPoint, MidiNote, ArrangementSection,
    SidechainLink,
)

logger = logging.getLogger(__name__)

MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024  # 256 MB safety limit
MAX_COMPRESSED_BYTES = 64 * 1024 * 1024     # 64 MB input limit


class ALSParseError(Exception):
    pass


class ALSParser:
    """
    Stateful ALS file parser. Call parse(path_or_bytes) to get a ProjectGraph.
    """

    def __init__(self, project_id: str, source_file: str = ""):
        self.project_id = project_id
        self.source_file = source_file
        self.warnings: List[str] = []
        self._track_counter = 0

    def parse(self, path_or_bytes) -> ProjectGraph:
        """
        Main entry point. Accepts file path (str/Path) or raw bytes.
        Returns a ProjectGraph.
        """
        raw_bytes = self._load_bytes(path_or_bytes)
        xml_bytes = self._decompress(raw_bytes)
        root = self._parse_xml(xml_bytes)
        return self._extract_graph(root)

    def _load_bytes(self, path_or_bytes) -> bytes:
        if isinstance(path_or_bytes, (str, Path)):
            p = Path(path_or_bytes)
            if not p.exists():
                raise ALSParseError(f"File not found: {p}")
            size = p.stat().st_size
            if size > MAX_COMPRESSED_BYTES:
                raise ALSParseError(f"File too large: {size} bytes (max {MAX_COMPRESSED_BYTES})")
            return p.read_bytes()
        elif isinstance(path_or_bytes, bytes):
            if len(path_or_bytes) > MAX_COMPRESSED_BYTES:
                raise ALSParseError(f"Input too large: {len(path_or_bytes)} bytes")
            return path_or_bytes
        else:
            raise ALSParseError(f"Unsupported input type: {type(path_or_bytes)}")

    def _decompress(self, data: bytes) -> bytes:
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
                chunks = []
                total = 0
                while True:
                    chunk = gz.read(65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_DECOMPRESSED_BYTES:
                        raise ALSParseError(
                            f"Decompressed size exceeds {MAX_DECOMPRESSED_BYTES} bytes (gzip bomb protection)"
                        )
                    chunks.append(chunk)
                return b"".join(chunks)
        except ALSParseError:
            raise
        except Exception as e:
            raise ALSParseError(f"Failed to decompress .als file: {e}") from e

    def _parse_xml(self, xml_bytes: bytes) -> etree._Element:
        try:
            parser = etree.XMLParser(
                recover=True,
                resolve_entities=False,
                no_network=True,
                huge_tree=False,
            )
            root = etree.fromstring(xml_bytes, parser=parser)
            if root is None:
                raise ALSParseError("XML parse returned empty root")
            return root
        except ALSParseError:
            raise
        except Exception as e:
            raise ALSParseError(f"Failed to parse XML: {e}") from e

    def _safe_float(self, el, attr: str, default: float = 0.0) -> float:
        try:
            val = el.get(attr)
            if val is not None:
                return float(val)
            child = el.find(attr)
            if child is not None:
                child_val = child.get("Value")
                if child_val is not None:
                    return float(child_val)
                if child.text and child.text.strip():
                    return float(child.text.strip())
        except (ValueError, TypeError):
            pass
        return default

    def _safe_int(self, el, attr: str, default: int = 0) -> int:
        try:
            val = el.get(attr)
            if val is not None:
                return int(val)
            child = el.find(attr)
            if child is not None:
                child_val = child.get("Value")
                if child_val is not None:
                    return int(child_val)
                if child.text and child.text.strip():
                    return int(child.text.strip())
        except (ValueError, TypeError):
            pass
        return default

    def _safe_bool(self, el, attr: str, default: bool = False) -> bool:
        val = el.get(attr, "").lower()
        if val == "true":
            return True
        if val == "false":
            return False
        return default

    def _text_value(self, el, default: str = "") -> str:
        val = el.get("Value", "")
        return val if val else default

    def _extract_graph(self, root: etree._Element) -> ProjectGraph:
        graph = ProjectGraph(
            project_id=self.project_id,
            source_file=self.source_file,
        )

        # LiveSet is the main container
        liveset = root.find("LiveSet")
        if liveset is None:
            liveset = root
            self.warnings.append("Could not find <LiveSet> element, using root")

        # Tempo
        graph.tempo = self._extract_tempo(liveset)

        # Time signature
        graph.time_signature_numerator, graph.time_signature_denominator = \
            self._extract_time_signature(liveset)

        # Arrangement length (from transport)
        graph.arrangement_length = self._extract_arrangement_length(liveset)

        # Locators
        graph.locators = self._extract_locators(liveset)

        # Tracks
        tracks_el = liveset.find("Tracks")
        if tracks_el is None:
            self.warnings.append("No <Tracks> element found")
        else:
            midi_order = 0
            audio_order = 0
            group_order = 0
            return_order = 0

            for child in tracks_el:
                tag = child.tag
                if tag == "MidiTrack":
                    track = self._extract_track(child, "midi", midi_order)
                    graph.tracks.append(track)
                    midi_order += 1
                elif tag == "AudioTrack":
                    track = self._extract_track(child, "audio", audio_order)
                    graph.tracks.append(track)
                    audio_order += 1
                elif tag == "GroupTrack":
                    track = self._extract_track(child, "group", group_order)
                    graph.tracks.append(track)
                    group_order += 1
                elif tag == "ReturnTrack":
                    track = self._extract_track(child, "return", return_order)
                    graph.return_tracks.append(track)
                    return_order += 1
                else:
                    self.warnings.append(f"Unknown track type: <{tag}>")

        # Master track
        master_el = liveset.find("MasterTrack")
        if master_el is not None:
            graph.master_track = self._extract_track(master_el, "master", 0)

        # Sidechain detection (after all tracks are parsed)
        graph.sidechain_links = self._detect_sidechain_links(graph)

        graph.warnings = self.warnings
        return graph

    def _extract_tempo(self, liveset: etree._Element) -> float:
        # Try Master track tempo
        master = liveset.find("MasterTrack")
        if master is not None:
            tempo_el = master.find(".//AutomatedParameterProperty/AutomatedParameter/Automation")
            # Simpler: try direct ManualTempo
            mt = master.find(".//DeviceChain/Mixer/Tempo/Manual")
            if mt is not None:
                try:
                    return float(mt.get("Value", "120"))
                except ValueError:
                    pass

        # Try Transport
        transport = liveset.find("Transport")
        if transport is not None:
            tempo_el = transport.find("CurrentTime")
            # LiveSet often has a "Tempo" attribute on transport
            tempo_val = transport.get("Tempo")
            if tempo_val:
                try:
                    return float(tempo_val)
                except ValueError:
                    pass

        # Fallback: search for any Tempo element
        for el in liveset.iter("Tempo"):
            val = el.get("Value") or el.get("Manual")
            if val:
                try:
                    t = float(val)
                    if 40 <= t <= 999:
                        return t
                except ValueError:
                    pass

        # Search for manual tempo in master device chain
        for el in liveset.iter("Manual"):
            parent = el.getparent()
            if parent is not None and "Tempo" in parent.tag:
                try:
                    t = float(el.get("Value", "120"))
                    if 40 <= t <= 999:
                        return t
                except ValueError:
                    pass

        self.warnings.append("Could not detect tempo, defaulting to 120 BPM")
        return 120.0

    def _extract_time_signature(self, liveset: etree._Element) -> Tuple[int, int]:
        # Search for time signature numerator/denominator
        for el in liveset.iter():
            if "TimeSignature" in el.tag:
                num = self._safe_int(el, "Numerator", 4)
                den = self._safe_int(el, "Denominator", 4)
                if num > 0 and den > 0:
                    return num, den

        # Try MasterTrack
        for el in liveset.iter("TimeSignature"):
            num = self._safe_int(el, "Numerator", 4)
            den = self._safe_int(el, "Denominator", 4)
            if num > 0 and den > 0:
                return num, den

        return 4, 4

    def _extract_arrangement_length(self, liveset: etree._Element) -> float:
        last_end = 0.0

        for track_el in liveset.iter("MidiTrack", "AudioTrack", "GroupTrack"):
            for clip_el in track_el.iter("AudioClip", "MidiClip"):
                end_time = self._safe_float(clip_el, "CurrentEnd", 0.0)
                if end_time > last_end:
                    last_end = end_time

        if last_end > 0:
            return last_end

        for el in liveset.iter("LoopEnd"):
            val = self._safe_float(el, "Value", 0.0)
            if val > 0:
                return val

        return 128.0

    def _extract_locators(self, liveset: etree._Element) -> List[Dict[str, Any]]:
        locators = []
        locators_el = liveset.find("Locators")
        if locators_el is None:
            return locators

        for loc_el in locators_el.iter("AutomationEvent", "Locator"):
            time_val = self._safe_float(loc_el, "Time", 0.0)
            name_el = loc_el.find("Name")
            name = name_el.get("Value", "") if name_el is not None else ""
            if not name:
                name = loc_el.get("Name", "")
            locators.append({"time": time_val, "name": name})

        return locators

    def _extract_track(self, track_el: etree._Element, track_type: str, order: int) -> TrackNode:
        track_id_attr = self._safe_int(track_el, "Id", 0)
        track_id = f"track_{track_type}_{track_id_attr}_{order}"

        # Name
        name_el = track_el.find("Name")
        if name_el is not None:
            eff_name = name_el.find("EffectiveName")
            user_name = name_el.find("UserName")
            if user_name is not None and user_name.get("Value"):
                name = user_name.get("Value", "")
            elif eff_name is not None:
                name = eff_name.get("Value", f"Track {order + 1}")
            else:
                name = f"Track {order + 1}"
        else:
            name = f"{track_type.title()} {order + 1}"

        # State flags
        muted = False
        solo = False
        frozen = False
        armed = False
        color = None

        muted_el = track_el.find(".//TrackDelay/IsSendActive")
        if muted_el is None:
            muted_el = track_el.find(".//Mute")
        if muted_el is not None:
            muted = self._safe_bool(muted_el, "Value", False)

        solo_el = track_el.find(".//Solo")
        if solo_el is None:
            solo_el = track_el.find("Solo")
        if solo_el is not None:
            solo = self._safe_bool(solo_el, "Value", False)

        freeze_el = track_el.find("Freeze")
        if freeze_el is None:
            freeze_el = track_el.find(".//Freeze")
        if freeze_el is not None:
            frozen = self._safe_bool(freeze_el, "Value", False)

        arm_el = track_el.find("Armed")
        if arm_el is None:
            arm_el = track_el.find(".//Armed")
        if arm_el is not None:
            armed = self._safe_bool(arm_el, "Value", False)

        color_el = track_el.find("ColorIndex")
        if color_el is None:
            color_el = track_el.find(".//ColorIndex")
        if color_el is not None:
            color = self._safe_int(color_el, "Value", 0)

        track = TrackNode(
            id=track_id,
            name=name,
            type=track_type,
            order_index=order,
            muted=muted,
            solo=solo,
            frozen=frozen,
            armed=armed,
            color=color,
        )

        # Group parenting
        group_id_el = track_el.find("TrackGroupId")
        if group_id_el is None:
            group_id_el = track_el.find(".//TrackGroupId")
        if group_id_el is not None:
            gid = self._safe_int(group_id_el, "Value", -1)
            if gid >= 0:
                track.parent_group_id = f"group_{gid}"

        # Devices
        track.devices = self._extract_devices(track_el, track_id)

        # Clips
        track.clips = self._extract_clips(track_el, track_id)

        # Automation lanes
        track.automation_lanes = self._extract_automation_lanes(track_el)

        # Routing info
        track.routing = self._extract_routing(track_el)

        return track

    def _extract_devices(self, track_el: etree._Element, track_id: str) -> List[DeviceNode]:
        devices = []
        device_counter = 0

        device_chain = track_el.find("DeviceChain")
        if device_chain is None:
            return devices

        inner_chain = device_chain.find("DeviceChain")
        device_chain_el = inner_chain if inner_chain is not None else device_chain

        for el in device_chain_el:
            tag = el.tag
            if tag in ("Devices",):
                for dev_el in el:
                    device = self._parse_device_element(dev_el, track_id, device_counter)
                    if device:
                        devices.append(device)
                        device_counter += 1
            elif tag.endswith("Device") or "Plugin" in tag or tag in (
                "PluginDevice", "AuPluginDevice", "VstPluginDevice", "Vst3PluginDevice",
                "InstrumentGroupDevice", "DrumGroupDevice", "EffectGroupDevice",
                "Eq8", "Compressor2", "Gate", "AutoFilter", "Saturator",
                "Reverb", "Delay", "Looper", "Beat", "Resonator",
                "Corpus", "Redux", "Chorus", "Flanger", "FrequencyShifter",
                "MultibandDynamics", "Overdrive", "Pedal",
                "Limiter", "Vinyl", "Pitch", "Dynamic",
                "Simpler", "Impulse", "Operator", "Wavetable", "Meld", "Drift",
                "OriginalSimpler", "MultiSampler",
            ):
                device = self._parse_device_element(el, track_id, device_counter)
                if device:
                    devices.append(device)
                    device_counter += 1

        return devices

    def _parse_device_element(self, el: etree._Element, track_id: str, counter: int) -> Optional[DeviceNode]:
        tag = el.tag
        if not tag or tag in ("AutomationEnvelopes", "Envelopes"):
            return None

        dev_id = f"{track_id}_dev_{counter}"
        plugin_name = None

        # Try to get plugin name from nested elements
        for name_tag in ("PluginDesc", "VstPluginInfo", "AuPluginInfo", "Vst3PluginInfo"):
            desc_el = el.find(f".//{name_tag}")
            if desc_el is not None:
                name_el = desc_el.find(".//Name")
                if name_el is None:
                    name_el = desc_el.find(".//FileName")
                if name_el is not None:
                    plugin_name = name_el.get("Value") or name_el.get("Name")
                    break

        enabled_el = el.find("On")
        enabled = True
        if enabled_el is not None:
            enabled = self._safe_bool(enabled_el, "Value", True)

        # Infer purpose from tag name
        inferred_purpose = self._infer_device_purpose(tag, plugin_name or "")

        return DeviceNode(
            id=dev_id,
            device_class=tag,
            plugin_name=plugin_name,
            enabled=enabled,
            inferred_purpose=inferred_purpose,
        )

    def _infer_device_purpose(self, tag: str, plugin_name: str) -> str:
        tag_lower = tag.lower()
        name_lower = plugin_name.lower()
        combined = tag_lower + " " + name_lower

        if any(k in combined for k in ["reverb", "hall", "room", "space"]):
            return "reverb"
        if any(k in combined for k in ["delay", "echo", "dub"]):
            return "delay"
        if any(k in combined for k in ["compressor", "compress", "limiter", "dynamics", "gate"]):
            return "dynamics"
        if any(k in combined for k in ["eq", "filter", "autofilter", "freq"]):
            return "eq_filter"
        if any(k in combined for k in ["distort", "saturator", "overdrive", "chorus", "flanger", "modulation"]):
            return "modulation_distortion"
        if any(k in combined for k in ["simpler", "sampler", "impulse", "instrument"]):
            return "sampler_instrument"
        if any(k in combined for k in ["operator", "wavetable", "drift", "meld", "synth"]):
            return "synth"
        if any(k in combined for k in ["drum", "beat"]):
            return "drum_machine"
        if any(k in combined for k in ["utility", "volume", "gain", "stereo"]):
            return "utility"
        if any(k in combined for k in ["midi", "arpeggio", "chord", "scale", "pitch"]):
            return "midi_effect"
        return "effect"

    def _extract_clips(self, track_el: etree._Element, track_id: str) -> List[ClipNode]:
        clips = []
        clip_counter = 0

        # Arrangement clips are in ArrangerAutomation > ClipTimeable
        arr_auto = track_el.find(".//ArrangerAutomation")
        if arr_auto is not None:
            events = arr_auto.find("Events")
            if events is not None:
                for clip_slot_el in events:
                    clip = self._parse_clip_element(clip_slot_el, track_id, clip_counter)
                    if clip:
                        clips.append(clip)
                        clip_counter += 1

        # Session clips in ClipSlotList > ClipSlot > ClipSlot > ...
        clip_slot_list = track_el.find(".//ClipSlotList")
        if clip_slot_list is not None:
            for slot_el in clip_slot_list:
                clip_el = slot_el.find(".//AudioClip")
                if clip_el is None:
                    clip_el = slot_el.find(".//MidiClip")
                if clip_el is not None:
                    clip = self._parse_clip_element(clip_el, track_id, clip_counter)
                    if clip:
                        clips.append(clip)
                        clip_counter += 1

        return clips

    def _parse_clip_element(self, el: etree._Element, track_id: str, counter: int) -> Optional[ClipNode]:
        tag = el.tag
        if tag not in ("AudioClip", "MidiClip", "AudioClipRef", "MidiClipRef"):
            # Could be an automation event
            if tag not in ("AutomationEvent",):
                return None
            return None

        clip_id = f"{track_id}_clip_{counter}"
        clip_type = "audio" if "Audio" in tag else "midi"

        start = self._safe_float(el, "Time", 0.0)
        end_attr = el.get("CurrentEnd") or el.get("LoopEnd")
        end = float(end_attr) if end_attr else start + 4.0

        loop_el = el.find(".//Loop")
        loop = False
        if loop_el is not None:
            loop = self._safe_bool(loop_el, "LoopOn", False)

        # Gain
        gain_val = 1.0
        gain_el = el.find(".//Gain")
        if gain_el is not None:
            gain_val = self._safe_float(gain_el, "Value", 1.0)

        # MIDI notes
        midi_notes = []
        if clip_type == "midi":
            notes_el = el.find(".//Notes")
            if notes_el is not None:
                for key_track in notes_el.iter("KeyTrack"):
                    for note_el in key_track.iter("MidiNoteEvent"):
                        try:
                            note = MidiNote(
                                pitch=self._safe_int(note_el, "NoteId", 60),
                                time=self._safe_float(note_el, "Time", 0.0),
                                duration=self._safe_float(note_el, "Duration", 0.25),
                                velocity=self._safe_int(note_el, "Velocity", 100),
                            )
                            # Actually KeyTrack has a MidiKey attribute
                            midi_notes.append(note)
                        except Exception:
                            pass

        content_summary = f"{clip_type} clip, {end - start:.1f} bars"
        if midi_notes:
            content_summary += f", {len(midi_notes)} notes"

        return ClipNode(
            id=clip_id,
            track_id=track_id,
            clip_type=clip_type,
            start=start,
            end=end,
            loop=loop,
            gain_info=gain_val,
            midi_notes=midi_notes,
            content_summary=content_summary,
        )

    def _extract_automation_lanes(self, track_el: etree._Element) -> List[AutomationLane]:
        lanes = []
        lane_counter = 0

        auto_el = track_el.find("AutomationEnvelopes")
        if auto_el is None:
            auto_el = track_el.find(".//AutomationEnvelopes")

        if auto_el is None:
            return lanes

        for envelope_el in auto_el.iter("AutomationEnvelope"):
            # Get parameter info
            param_el = envelope_el.find(".//EnvelopeTarget/PointeeId")
            param_name = "unknown"

            for pname_el in envelope_el.iter("AutomationTarget"):
                pname_attr = pname_el.get("Id") or pname_el.get("ParameterName")
                if pname_attr:
                    param_name = pname_attr
                    break

            target_path = f"envelope_{lane_counter}"

            # Extract automation points
            points = []
            for event_el in envelope_el.iter("AutomationEvent"):
                t = self._safe_float(event_el, "Time", 0.0)
                v = self._safe_float(event_el, "Value", 0.0)
                points.append(AutomationPoint(time=t, value=v))

            if not points:
                continue

            density = len(points) / max(1.0, points[-1].time - points[0].time) if len(points) > 1 else 0.0

            # Determine shape
            if len(points) <= 1:
                shape = "static"
            elif len(points) <= 3:
                shape = "sparse"
            elif density < 0.5:
                shape = "gentle_ramp"
            else:
                shape = "complex"

            lane = AutomationLane(
                target_path=target_path,
                parameter_name=param_name,
                points=points,
                density=min(density, 100.0),
                shape_summary=shape,
                confidence=0.7,
            )
            lanes.append(lane)
            lane_counter += 1

        return lanes


    def _extract_routing(self, track_el: etree._Element) -> Dict[str, Any]:
        routing: Dict[str, Any] = {}

        device_chain = track_el.find("DeviceChain")
        if device_chain is None:
            return routing

        # Audio input routing
        audio_in = device_chain.find("AudioInputRouting")
        if audio_in is not None:
            target = audio_in.find("Target")
            upper = audio_in.find("UpperDisplayString")
            lower = audio_in.find("LowerDisplayString")
            routing["audioInput"] = {
                "target": target.get("Value", "") if target is not None else "",
                "upper": upper.get("Value", "") if upper is not None else "",
                "lower": lower.get("Value", "") if lower is not None else "",
            }

        # Audio output routing
        audio_out = device_chain.find("AudioOutputRouting")
        if audio_out is not None:
            target = audio_out.find("Target")
            upper = audio_out.find("UpperDisplayString")
            lower = audio_out.find("LowerDisplayString")
            routing["audioOutput"] = {
                "target": target.get("Value", "") if target is not None else "",
                "upper": upper.get("Value", "") if upper is not None else "",
                "lower": lower.get("Value", "") if lower is not None else "",
            }

        # Sends
        sends = device_chain.find(".//Sends")
        if sends is not None:
            send_list = []
            for send_el in sends:
                send_active = send_el.find("Active")
                send_amount = send_el.find("Amount")
                if send_amount is not None:
                    manual = send_amount.find("Manual")
                    active = send_active.get("Value", "true") if send_active is not None else "true"
                    val = self._safe_float(manual, "Value", 0.0) if manual is not None else 0.0
                    send_list.append({
                        "active": active.lower() == "true",
                        "amount": val,
                    })
            if send_list:
                routing["sends"] = send_list

        return routing

    def _detect_sidechain_links(self, graph: ProjectGraph) -> List[SidechainLink]:
        links: List[SidechainLink] = []

        all_tracks = list(graph.tracks) + list(graph.return_tracks)
        if graph.master_track:
            all_tracks.append(graph.master_track)

        track_map: Dict[str, TrackNode] = {t.id: t for t in all_tracks}

        for track in all_tracks:
            for device in track.devices:
                if device.device_class not in ("Compressor2", "GlueCompressor", "MultibandDynamics", "Gate"):
                    continue

                # Heuristic sidechain detection:
                # 1. Compressor on non-kick track that has a kick track in the project = likely sidechain
                # 2. Check routing for sidechain indicators
                if track.inferred_role == "kick":
                    continue

                kick_tracks = [t for t in graph.tracks if t.inferred_role == "kick"]
                if not kick_tracks:
                    continue

                # A compressor on a bass/pad/synth track likely has sidechain from kick
                if track.inferred_role in ("bass", "rumble", "lead", "synth_stab", "drone", "texture", "vocal"):
                    source = kick_tracks[0]
                    confidence = 0.6
                    if device.device_class == "Compressor2":
                        confidence = 0.75
                    if track.inferred_role in ("bass", "rumble"):
                        confidence = 0.85

                    links.append(SidechainLink(
                        source_track_id=source.id,
                        target_track_id=track.id,
                        source_track_name=source.name,
                        target_track_name=track.name,
                        device_class=device.device_class,
                        device_id=device.id,
                        confidence=confidence,
                    ))

        return links


def parse_als_file(path_or_bytes, project_id: str, source_file: str = "") -> Tuple[ProjectGraph, List[str]]:
    """
    High-level parse function.
    Returns (ProjectGraph, warnings).
    Never raises — always returns something with a quality score.
    """
    parser = ALSParser(project_id=project_id, source_file=source_file)
    try:
        graph = parser.parse(path_or_bytes)
        return graph, parser.warnings
    except ALSParseError as e:
        logger.error(f"ALS parse error: {e}")
        # Return minimal graph with error
        graph = ProjectGraph(
            project_id=project_id,
            source_file=source_file,
            parse_quality=0.0,
        )
        graph.warnings = [f"Parse failed: {e}"]
        return graph, graph.warnings
    except Exception as e:
        logger.exception(f"Unexpected parse error: {e}")
        graph = ProjectGraph(
            project_id=project_id,
            source_file=source_file,
            parse_quality=0.0,
        )
        graph.warnings = [f"Unexpected parse error: {e}"]
        return graph, graph.warnings
