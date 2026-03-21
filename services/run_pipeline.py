#!/usr/bin/env python3
"""
CLI runner for the ALS pipeline.
Called by the Node.js job runner with a JSON payload via stdin arg.
Outputs a JSON result to stdout.
"""

import sys
import json
import logging

# Configure logging to stderr only
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger("run_pipeline")

# Make sure the als_parser package is importable
sys.path.insert(0, __file__.rsplit("/", 1)[0])

from als_parser.pipeline import run_full_pipeline


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

        result = {
            "success": True,
            "project_graph": graph.to_dict(),
            "completion_plan": plan.to_dict(),
            "warnings": warnings[:100],  # cap warnings
        }

        print(json.dumps(result))
    except Exception as e:
        logger.exception(f"Pipeline failed: {e}")
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
