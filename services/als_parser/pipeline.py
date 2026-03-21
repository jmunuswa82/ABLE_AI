"""
Analysis Pipeline.

Orchestrates: parse → role inference → style inference → section inference → weakness detection → completion plan.
"""

from __future__ import annotations

import logging
from typing import Dict, Any, List, Tuple
from .parser import parse_als_file
from .models import ProjectGraph, CompletionPlan
from .role_inference import apply_role_inference
from .style_inference import infer_style_tags
from .section_inference import infer_sections
from .weakness_detection import detect_weaknesses
from .completion_engine import generate_completion_plan

logger = logging.getLogger(__name__)


def run_full_pipeline(
    file_path_or_bytes,
    project_id: str,
    source_file: str = "",
) -> Tuple[ProjectGraph, CompletionPlan, List[str]]:
    """
    Run the full analysis pipeline on an ALS file.
    Returns (project_graph, completion_plan, all_warnings).
    Never raises.
    """
    all_warnings: List[str] = []

    # Step 1: Parse
    logger.info(f"Starting parse for project {project_id}")
    graph, parse_warnings = parse_als_file(file_path_or_bytes, project_id, source_file)
    all_warnings.extend(parse_warnings)

    # Step 2: Role inference
    logger.info("Running role inference")
    apply_role_inference(graph.all_tracks)

    # Step 3: Style inference
    logger.info("Running style inference")
    style_tags = infer_style_tags(graph)
    graph.style_tags = style_tags

    # Step 4: Section inference
    logger.info("Running section inference")
    sections = infer_sections(graph)
    graph.sections = sections

    # Step 5: Weakness detection
    logger.info("Running weakness detection")
    weaknesses = detect_weaknesses(graph)

    # Collect per-track warnings
    for track in graph.all_tracks:
        all_warnings.extend(track.warnings)

    # Step 6: Completion plan
    logger.info("Generating completion plan")
    plan = generate_completion_plan(graph, weaknesses)

    logger.info(f"Pipeline complete: {len(plan.actions)} actions, score={plan.completion_score:.2f}")
    return graph, plan, all_warnings


def run_parse_only(
    file_path_or_bytes,
    project_id: str,
    source_file: str = "",
) -> Tuple[ProjectGraph, List[str]]:
    """
    Run only the parse step.
    """
    graph, warnings = parse_als_file(file_path_or_bytes, project_id, source_file)
    apply_role_inference(graph.all_tracks)
    style_tags = infer_style_tags(graph)
    graph.style_tags = style_tags
    sections = infer_sections(graph)
    graph.sections = sections
    return graph, warnings
