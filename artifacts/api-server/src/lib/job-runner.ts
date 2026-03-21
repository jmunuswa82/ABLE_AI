/**
 * Job runner that calls the Python pipeline service via child_process.
 * In-process for dev mode, architected to support queue backends later.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { randomUUID } from "crypto";
import archiver from "archiver";
import { db, jobsTable, projectsTable, parseResultsTable, completionPlansTable, artifactFilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const ARTIFACT_DIR = path.resolve(process.cwd(), "../../storage/artifacts");
const SERVICES_DIR = path.resolve(process.cwd(), "../../services");
const PYTHON_RUNNER = path.join(SERVICES_DIR, "run_pipeline.py");

function sanitizeFileName(name: string): string {
  return path.basename(name).replace(/[^\w.\-() ]/g, "_").substring(0, 200);
}

async function updateJob(
  jobId: string,
  state: string,
  progress?: number,
  message?: string,
  error?: string
) {
  await db.update(jobsTable).set({
    state,
    progress: progress ?? null,
    message: message ?? null,
    error: error ?? null,
    completedAt: ["completed", "failed", "exported", "partial_success"].includes(state)
      ? new Date()
      : null,
  }).where(eq(jobsTable.id, jobId));
}

async function updateProjectStatus(projectId: string, status: string, extra?: {
  completionScore?: number;
  styleTags?: string[];
  warnings?: string[];
}) {
  await db.update(projectsTable).set({
    status,
    ...(extra?.completionScore !== undefined ? { completionScore: extra.completionScore } : {}),
    ...(extra?.styleTags !== undefined ? { styleTags: extra.styleTags } : {}),
    ...(extra?.warnings !== undefined ? { warnings: extra.warnings } : {}),
  }).where(eq(projectsTable.id, projectId));
}

export async function runPipelineJob(
  projectId: string,
  jobId: string,
  filePath: string,
  originalFileName: string,
): Promise<void> {
  logger.info({ projectId, jobId }, "Starting pipeline job");

  try {
    await updateJob(jobId, "parsing", 0, "Parsing ALS file...");
    await updateProjectStatus(projectId, "parsing");

    // Run Python pipeline
    const result = await runPython({
      project_id: projectId,
      job_id: jobId,
      file_path: filePath,
      source_file: originalFileName,
    });

    if (!result.success) {
      await updateJob(jobId, "failed", undefined, undefined, result.error || "Pipeline failed");
      await updateProjectStatus(projectId, "failed");
      return;
    }

    const { project_graph, completion_plan, warnings, patched_als_path, patch_summary } = result;

    // Save parse result
    const parseId = randomUUID();
    await db.insert(parseResultsTable).values({
      id: parseId,
      projectId,
      jobId,
      projectGraph: project_graph,
      parseQuality: project_graph?.parseQuality ?? 0,
      warnings: warnings ?? [],
    });

    await updateJob(jobId, "analyzed", 70, "Analysis complete, saving plan...");

    // Save completion plan
    const planId = randomUUID();
    await db.insert(completionPlansTable).values({
      id: planId,
      projectId,
      jobId,
      planData: completion_plan,
      confidence: completion_plan?.confidence ?? 0,
      completionScore: completion_plan?.completionScore ?? 0,
      styleTags: completion_plan?.styleTags ?? [],
    });

    // Save export artifacts
    const artifactsDir = path.join(ARTIFACT_DIR, projectId);
    await fs.mkdir(artifactsDir, { recursive: true });

    // 1. Register original ALS as artifact
    const originalAlsArtifactId = randomUUID();
    try {
      const alsStats = await fs.stat(filePath);
      await db.insert(artifactFilesTable).values({
        id: originalAlsArtifactId,
        projectId,
        jobId,
        type: "original_als",
        fileName: originalFileName,
        filePath: filePath,
        fileSize: alsStats.size,
        mimeType: "application/x-ableton-live-set",
        description: "Original uploaded Ableton Live Set",
      });
    } catch (e) {
      logger.warn({ err: e }, "Could not register original ALS artifact");
    }

    // 2. Write project graph JSON
    const graphPath = path.join(artifactsDir, "project-graph.json");
    await fs.writeFile(graphPath, JSON.stringify(project_graph, null, 2));

    const graphArtifactId = randomUUID();
    await db.insert(artifactFilesTable).values({
      id: graphArtifactId,
      projectId,
      jobId,
      type: "project_graph",
      fileName: "project-graph.json",
      filePath: graphPath,
      fileSize: (await fs.stat(graphPath)).size,
      mimeType: "application/json",
      description: "Parsed project structure and track analysis",
    });

    // 3. Write completion plan JSON
    const planPath = path.join(artifactsDir, "completion-plan.json");
    await fs.writeFile(planPath, JSON.stringify(completion_plan, null, 2));

    const planArtifactId = randomUUID();
    await db.insert(artifactFilesTable).values({
      id: planArtifactId,
      projectId,
      jobId,
      type: "completion_plan",
      fileName: "completion-plan.json",
      filePath: planPath,
      fileSize: (await fs.stat(planPath)).size,
      mimeType: "application/json",
      description: "AI completion plan with ranked actions",
    });

    // 4. Write human-readable completion instructions
    const instructionsContent = buildInstructions(completion_plan, project_graph, originalFileName);
    const instrPath = path.join(artifactsDir, "completion-instructions.md");
    await fs.writeFile(instrPath, instructionsContent);

    const instrArtifactId = randomUUID();
    await db.insert(artifactFilesTable).values({
      id: instrArtifactId,
      projectId,
      jobId,
      type: "instructions",
      fileName: "completion-instructions.md",
      filePath: instrPath,
      fileSize: (await fs.stat(instrPath)).size,
      mimeType: "text/markdown",
      description: "Human-readable completion instructions",
    });

    // 5. Register patched ALS if available
    let registeredPatchedAlsPath: string | null = null;
    if (patched_als_path) {
      try {
        const patchedStats = await fs.stat(patched_als_path);
        const patchedAlsId = randomUUID();
        const patchedFileName = path.basename(patched_als_path);
        await db.insert(artifactFilesTable).values({
          id: patchedAlsId,
          projectId,
          jobId,
          type: "patched_als",
          fileName: patchedFileName,
          filePath: patched_als_path,
          fileSize: patchedStats.size,
          mimeType: "application/x-ableton-live-set",
          description: `AI-patched .als — ${patch_summary?.trustLabel ?? "unknown trust"} · ${patch_summary?.mutationsApplied ?? 0} mutations applied`,
        });
        registeredPatchedAlsPath = patched_als_path;
        logger.info({ patchedFileName, trustLabel: patch_summary?.trustLabel }, "Registered patched ALS artifact");
      } catch (e) {
        logger.warn({ err: e }, "Could not register patched ALS artifact");
      }
    }

    // 6. Build ALS Patch Package (zip containing original + all analysis artifacts)
    let patchPackageBuilt = false;
    try {
      const safeName = sanitizeFileName(originalFileName);
      const baseName = safeName.replace(/\.als$/i, "");
      const zipFileName = `${baseName}-patch-package.zip`;
      const zipPath = path.join(artifactsDir, zipFileName);

      await buildPatchPackageZip(zipPath, {
        originalAlsPath: filePath,
        originalFileName: safeName,
        graphPath,
        planPath,
        instrPath,
        patchedAlsPath: registeredPatchedAlsPath,
        patchSummary: patch_summary,
        projectGraph: project_graph,
        completionPlan: completion_plan,
      });

      const zipStats = await fs.stat(zipPath);
      if (zipStats.size < 100) {
        throw new Error("Patch package zip is suspiciously small");
      }

      const zipArtifactId = randomUUID();
      await db.insert(artifactFilesTable).values({
        id: zipArtifactId,
        projectId,
        jobId,
        type: "patch_package",
        fileName: zipFileName,
        filePath: zipPath,
        fileSize: zipStats.size,
        mimeType: "application/zip",
        description: "ALS Patch Package — original .als + completion plan + analysis + instructions",
      });
      patchPackageBuilt = true;
    } catch (e) {
      logger.error({ err: e }, "Failed to build patch package zip");
    }

    // Update project
    await updateProjectStatus(projectId, "exported", {
      completionScore: completion_plan?.completionScore,
      styleTags: completion_plan?.styleTags ?? [],
      warnings: warnings?.slice(0, 20) ?? [],
    });

    const exportMessage = patchPackageBuilt
      ? "Complete — all artifacts ready"
      : "Complete — analysis artifacts ready (patch package failed)";
    await updateJob(jobId, "exported", 100, exportMessage);
    logger.info({ projectId, jobId, patchPackageBuilt }, "Pipeline job complete");

  } catch (err: any) {
    logger.error({ err, projectId, jobId }, "Pipeline job error");
    await updateJob(jobId, "failed", undefined, undefined, err?.message ?? "Unknown error");
    await updateProjectStatus(projectId, "failed");
  }
}

function runPython(payload: Record<string, any>): Promise<any> {
  return new Promise((resolve) => {
    const python = spawn("python3", [PYTHON_RUNNER, JSON.stringify(payload)], {
      cwd: SERVICES_DIR,
    });

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    python.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    python.on("close", (code) => {
      if (code !== 0) {
        logger.error({ code, stderr }, "Python pipeline exited with error");
        resolve({ success: false, error: stderr || `Python exited with code ${code}` });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        logger.error({ stdout, stderr }, "Failed to parse Python output");
        resolve({ success: false, error: `Failed to parse pipeline output: ${stdout.slice(0, 200)}` });
      }
    });

    python.on("error", (err) => {
      logger.error({ err }, "Failed to spawn Python process");
      resolve({ success: false, error: `Failed to start Python: ${err.message}` });
    });
  });
}

function buildInstructions(plan: any, graph: any, fileName: string): string {
  const lines: string[] = [
    `# Completion Instructions for: ${fileName}`,
    ``,
    `Generated by Ableton AI Track Completion Studio`,
    ``,
    `## Project Summary`,
    ``,
    `- **Tempo**: ${graph?.tempo ?? "Unknown"} BPM`,
    `- **Time Signature**: ${graph?.timeSignatureNumerator ?? 4}/${graph?.timeSignatureDenominator ?? 4}`,
    `- **Arrangement Length**: ${graph?.arrangementLength ?? 0} bars`,
    `- **Style**: ${(plan?.styleTags ?? []).join(", ") || "techno"}`,
    `- **Completion Score**: ${Math.round((plan?.completionScore ?? 0) * 100)}%`,
    ``,
    `## Analysis Summary`,
    ``,
    plan?.summary ?? "",
    ``,
    `## Completion Actions`,
    ``,
  ];

  const actions = plan?.actions ?? [];
  const byCategory: Record<string, any[]> = {};
  for (const action of actions) {
    if (!byCategory[action.category]) byCategory[action.category] = [];
    byCategory[action.category].push(action);
  }

  for (const [cat, catActions] of Object.entries(byCategory)) {
    lines.push(`### ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
    lines.push(``);
    for (const action of catActions) {
      lines.push(`#### ${action.title} (${action.priority} priority, confidence: ${Math.round(action.confidence * 100)}%)`);
      lines.push(``);
      lines.push(action.description);
      lines.push(``);
      if (action.affectedBars) lines.push(`**Bars affected**: ${action.affectedBars}`);
      if (action.affectedTracks?.length) lines.push(`**Tracks**: ${action.affectedTracks.join(", ")}`);
      lines.push(`**Expected impact**: ${action.expectedImpact}`);
      lines.push(`**Rationale**: ${action.rationale}`);
      lines.push(``);
    }
  }

  if (plan?.weaknesses?.length) {
    lines.push(`## Detected Weaknesses`);
    lines.push(``);
    for (const w of plan.weaknesses) {
      lines.push(`- ${w}`);
    }
    lines.push(``);
  }

  if (plan?.warnings?.length) {
    lines.push(`## Parser Warnings`);
    lines.push(``);
    for (const w of plan.warnings.slice(0, 10)) {
      lines.push(`- ${w}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Generated at ${new Date().toISOString()} by Ableton AI Track Completion Studio*`);

  return lines.join("\n");
}

async function buildPatchPackageZip(
  zipPath: string,
  opts: {
    originalAlsPath: string;
    originalFileName: string;
    graphPath: string;
    planPath: string;
    instrPath: string;
    patchedAlsPath?: string | null;
    patchSummary?: any;
    projectGraph: any;
    completionPlan: any;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    let settled = false;
    const fail = (err: Error) => {
      if (!settled) { settled = true; reject(err); }
    };

    output.on("close", () => { if (!settled) { settled = true; resolve(); } });
    output.on("error", (err: Error) => fail(err));
    archive.on("error", (err: Error) => fail(err));
    archive.on("warning", (err: Error) => {
      logger.warn({ err }, "Archiver warning during zip creation");
    });

    archive.pipe(output);

    const safeEntryName = sanitizeFileName(opts.originalFileName);
    archive.file(opts.originalAlsPath, { name: `original/${safeEntryName}` });
    archive.file(opts.graphPath, { name: "analysis/project-graph.json" });
    archive.file(opts.planPath, { name: "analysis/completion-plan.json" });
    archive.file(opts.instrPath, { name: "analysis/completion-instructions.md" });

    // Include patched ALS if available
    if (opts.patchedAlsPath) {
      const patchedName = `patched/${safeEntryName.replace(/\.als$/i, "_ai_patch.als")}`;
      archive.file(opts.patchedAlsPath, { name: patchedName });
    }

    const manifest = {
      version: "2.0.0",
      generatedAt: new Date().toISOString(),
      generator: "Ableton AI Track Completion Studio",
      originalFile: opts.originalFileName,
      tempo: opts.projectGraph?.tempo,
      completionScore: opts.completionPlan?.completionScore,
      styleTags: opts.completionPlan?.styleTags,
      actionCount: opts.completionPlan?.actions?.length ?? 0,
      mutationPlanVersion: opts.completionPlan?.mutationPlanVersion ?? "1.0.0",
      patchSummary: opts.patchSummary ?? null,
      hasPatchedAls: !!opts.patchedAlsPath,
    };

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

    const patchTrust = opts.patchSummary?.trustLabel ?? "none";
    const patchApplied = opts.patchSummary?.mutationsApplied ?? 0;
    const patchSkipped = opts.patchSummary?.mutationsSkipped ?? 0;

    const readme = [
      "# ALS Patch Package",
      "",
      `Original file: ${opts.originalFileName}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Contents",
      "",
      "- `original/` — Your original .als file (unchanged)",
      ...(opts.patchedAlsPath ? [
        `- \`patched/\` — AI-patched .als candidate (trust: ${patchTrust}, ${patchApplied} mutations applied, ${patchSkipped} skipped)`,
      ] : []),
      "- `analysis/project-graph.json` — Full parsed project structure",
      "- `analysis/completion-plan.json` — AI completion plan with ranked actions and mutation payloads",
      "- `analysis/completion-instructions.md` — Human-readable completion guide",
      "- `manifest.json` — Package metadata",
      "",
      "## How to Use",
      "",
      "1. Open `analysis/completion-instructions.md` for step-by-step guidance",
      "2. Open `original/" + opts.originalFileName + "` in Ableton Live",
      ...(opts.patchedAlsPath ? [
        `3. (Optional) Open the patched ALS in \`patched/\` — trust label: ${patchTrust}`,
        "   - SAFE_LOCATOR_ONLY: Only locator markers were added",
        "   - SAFE_AUTOMATION_ADDED: Locators + automation envelopes added",
        "   - STRUCTURALLY_VALID_ALS: Clips were also added (review before using in a live set)",
        "   - REQUIRES_MANUAL_REVIEW: Mutations required manual steps (not auto-applied)",
      ] : []),
      "4. Follow the completion plan actions in priority order",
      "5. Reference `analysis/project-graph.json` for detailed track/clip data",
      "",
    ].join("\n");

    archive.append(readme, { name: "README.md" });

    archive.finalize();
  });
}
