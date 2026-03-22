#!/usr/bin/env python3
"""
Apply-Mutations Runner.
Called by the Node.js job runner to apply a specific set of user-selected mutations
to an existing ALS file without re-running the full analysis pipeline.

Input (via sys.argv[1]): JSON with:
  - project_id: str
  - file_path: str  (path to original .als)
  - mutation_payloads: list of mutation payload dicts (pre-filtered to user selection)

Output (stdout): JSON with:
  - success: bool
  - patched_als_path: str | null
  - patch_summary: dict | null
  - error: str | null
"""

import sys
import json
import logging
import os

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger("apply_mutations")

sys.path.insert(0, __file__.rsplit("/", 1)[0])

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
    mutation_payloads = payload.get("mutation_payloads", [])

    if not project_id or not file_path:
        print(json.dumps({"success": False, "error": "Missing project_id or file_path"}))
        sys.exit(1)

    if not os.path.exists(file_path):
        print(json.dumps({"success": False, "error": f"ALS file not found: {file_path}"}))
        sys.exit(1)

    if not mutation_payloads:
        print(json.dumps({"success": False, "error": "No mutation payloads provided"}))
        sys.exit(1)

    try:
        logger.info(f"Applying {len(mutation_payloads)} mutations to {file_path}")
        with open(file_path, "rb") as f:
            als_bytes = f.read()

        patch_result = patch_als(als_bytes, mutation_payloads)
        patch_summary = patch_result.to_summary_dict()

        patched_als_path = None
        if patch_result.als_bytes:
            base = os.path.splitext(file_path)[0]
            patched_als_path = f"{base}_ai_patch.als"
            with open(patched_als_path, "wb") as f:
                f.write(patch_result.als_bytes)
            logger.info(f"Patched ALS saved: {patched_als_path} ({len(patch_result.als_bytes)} bytes)")
        else:
            logger.warning(f"Patcher returned no bytes. Trust: {patch_result.trust_label}")

        result = {
            "success": True,
            "patched_als_path": patched_als_path,
            "patch_summary": patch_summary,
        }
        print(json.dumps(result))

    except Exception as e:
        logger.exception(f"Apply mutations failed: {e}")
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
