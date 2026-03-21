#!/usr/bin/env python3
"""
CLI runner for the ALS pipeline.
Called by the Node.js job runner with a JSON payload via stdin arg.
Outputs a JSON result to stdout.
"""

import sys
import json
import logging
import os
import tempfile

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger("run_pipeline")

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from als_parser.pipeline import run_full_pipeline
from als_parser.als_patcher import patch_als


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No payload argument provided"}))
        sys.exit(1)

    try:
        payload = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON payload: {e}"}))
        sys.exit(1)

    project_id = payload.get("project_id", "")
    file_path = payload.get("file_path", "")
    source_file = payload.get("source_file", "")

    if not project_id or not file_path:
        print(json.dumps({"success": False, "error": "Missing project_id or file_path"}))
        sys.exit(1)

    try:
        logger.info(f"Running pipeline: project={project_id}, file={file_path}")
        graph, plan, warnings = run_full_pipeline(
            file_path_or_bytes=file_path,
            project_id=project_id,
            source_file=source_file,
        )

        # Collect safe mutation payloads from completion plan
        mutation_payloads = []
        for action in plan.actions:
            for mp in action.mutation_payloads:
                if mp.safe:
                    mutation_payloads.append(mp.to_dict())

        # Attempt ALS patching
        patched_als_path = None
        patch_summary = None

        if mutation_payloads and os.path.exists(file_path):
            try:
                logger.info(f"Applying {len(mutation_payloads)} mutation payloads to ALS")
                with open(file_path, "rb") as f:
                    als_bytes = f.read()

                patch_result = patch_als(als_bytes, mutation_payloads)

                if patch_result.als_bytes:
                    # Save next to original with _ai_patch suffix
                    base = os.path.splitext(file_path)[0]
                    patched_als_path = f"{base}_ai_patch.als"
                    with open(patched_als_path, "wb") as f:
                        f.write(patch_result.als_bytes)
                    logger.info(f"Patched ALS saved to {patched_als_path} ({len(patch_result.als_bytes)} bytes)")

                patch_summary = patch_result.to_summary_dict()
                logger.info(f"Patch summary: {patch_summary}")

            except Exception as e:
                logger.error(f"ALS patching failed: {e}")
                patch_summary = {"error": str(e), "trustLabel": "FAILED", "mutationsApplied": 0, "mutationsSkipped": len(mutation_payloads)}

        result = {
            "success": True,
            "project_graph": graph.to_dict(),
            "completion_plan": plan.to_dict(),
            "warnings": warnings[:100],
            "patch_summary": patch_summary,
            "patched_als_path": patched_als_path,
        }

        print(json.dumps(result))
    except Exception as e:
        logger.exception(f"Pipeline failed: {e}")
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
