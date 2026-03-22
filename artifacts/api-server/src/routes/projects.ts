import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, jobsTable, parseResultsTable, completionPlansTable, artifactFilesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { runPipelineJob } from "../lib/job-runner";

const router: IRouter = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), "../../storage/uploads");
const ARTIFACT_DIR = path.resolve(process.cwd(), "../../storage/artifacts");

// Ensure dirs exist
(async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
})();

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 64 * 1024 * 1024 }, // 64MB max
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith(".als") || file.mimetype === "application/octet-stream") {
      cb(null, true);
    } else {
      cb(new Error("Only .als files are accepted"));
    }
  },
});

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
});

// GET /projects
router.get("/projects", async (req: Request, res: Response) => {
  try {
    const projects = await db
      .select()
      .from(projectsTable)
      .orderBy(desc(projectsTable.createdAt));

    res.json(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        completionScore: p.completionScore,
        originalFileName: p.originalFileName,
        styleTags: p.styleTags ?? [],
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Failed to list projects" });
  }
});

// POST /projects
router.post("/projects", async (req: Request, res: Response) => {
  const parsed = CreateProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.message });
    return;
  }

  const { name, description } = parsed.data;
  const id = randomUUID();

  try {
    const [project] = await db.insert(projectsTable).values({
      id,
      name,
      description: description ?? null,
      status: "created",
      styleTags: [],
      warnings: [],
    }).returning();

    res.status(201).json({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      completionScore: project.completionScore,
      originalFileName: project.originalFileName,
      styleTags: project.styleTags ?? [],
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Failed to create project" });
  }
});

// GET /projects/:id
router.get("/projects/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const jobs = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.projectId, id))
      .orderBy(desc(jobsTable.createdAt));

    res.json({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      completionScore: project.completionScore,
      originalFileName: project.originalFileName,
      styleTags: project.styleTags ?? [],
      warnings: project.warnings ?? [],
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      jobs: jobs.map((j) => ({
        id: j.id,
        projectId: j.projectId,
        type: j.type,
        state: j.state,
        progress: j.progress,
        message: j.message,
        error: j.error,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Failed to get project" });
  }
});

// DELETE /projects/:id
router.delete("/projects/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await db.delete(projectsTable).where(eq(projectsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// POST /projects/:id/upload
router.post("/projects/:id/upload", upload.single("file"), async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const file = req.file;
  const originalName = file.originalname;

  // Validate extension
  if (!originalName.toLowerCase().endsWith(".als")) {
    await fs.unlink(file.path).catch(() => {});
    res.status(400).json({ error: "Only .als files are accepted" });
    return;
  }

  // Sanitize filename
  const safeFileName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = path.join(UPLOAD_DIR, `${id}_${safeFileName}`);

  try {
    // Check project exists
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) {
      await fs.unlink(file.path).catch(() => {});
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Move file to final location
    await fs.rename(file.path, destPath);

    // Update project
    await db.update(projectsTable).set({
      originalFileName: originalName,
      filePath: destPath,
      status: "uploaded",
    }).where(eq(projectsTable.id, id));

    // Create parse job
    const jobId = randomUUID();
    await db.insert(jobsTable).values({
      id: jobId,
      projectId: id,
      type: "parse",
      state: "queued",
    });

    // Trigger full pipeline in background
    runPipelineJob(id, jobId, destPath, originalName).catch((err) => {
      logger.error({ err, projectId: id }, "Pipeline job failed");
    });

    res.json({
      projectId: id,
      jobId,
      fileName: originalName,
      status: "queued",
    });
  } catch (err) {
    await fs.unlink(file.path).catch(() => {});
    req.log.error({ err }, "Upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

// GET /projects/:id/project-graph
router.get("/projects/:id/project-graph", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [parseResult] = await db
      .select()
      .from(parseResultsTable)
      .where(eq(parseResultsTable.projectId, id))
      .orderBy(desc(parseResultsTable.createdAt))
      .limit(1);

    if (!parseResult || !parseResult.projectGraph) {
      res.status(404).json({ error: "No parse result available" });
      return;
    }

    res.json(parseResult.projectGraph);
  } catch (err) {
    req.log.error({ err }, "Failed to get project graph");
    res.status(500).json({ error: "Failed to get project graph" });
  }
});

// GET /projects/:id/completion-plan
router.get("/projects/:id/completion-plan", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [plan] = await db
      .select()
      .from(completionPlansTable)
      .where(eq(completionPlansTable.projectId, id))
      .orderBy(desc(completionPlansTable.createdAt))
      .limit(1);

    if (!plan || !plan.planData) {
      res.status(404).json({ error: "No completion plan available yet" });
      return;
    }

    res.json(plan.planData);
  } catch (err) {
    req.log.error({ err }, "Failed to get completion plan");
    res.status(500).json({ error: "Failed to get completion plan" });
  }
});

// GET /projects/:id/artifacts
router.get("/projects/:id/artifacts", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const artifacts = await db
      .select()
      .from(artifactFilesTable)
      .where(eq(artifactFilesTable.projectId, id))
      .orderBy(desc(artifactFilesTable.createdAt));

    res.json(
      artifacts.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        type: a.type,
        fileName: a.fileName,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        description: a.description,
        createdAt: a.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list artifacts");
    res.status(500).json({ error: "Failed to list artifacts" });
  }
});

// GET /projects/:id/artifacts/:artifactId/download
router.get("/projects/:id/artifacts/:artifactId/download", async (req: Request, res: Response) => {
  const { id, artifactId } = req.params;
  try {
    const [artifact] = await db
      .select()
      .from(artifactFilesTable)
      .where(eq(artifactFilesTable.id, artifactId));

    if (!artifact || artifact.projectId !== id) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }

    if (!existsSync(artifact.filePath)) {
      res.status(404).json({ error: "Artifact file not found on disk" });
      return;
    }

    if (artifact.mimeType) {
      res.setHeader("Content-Type", artifact.mimeType);
    }
    res.download(artifact.filePath, artifact.fileName);
  } catch (err) {
    req.log.error({ err }, "Failed to download artifact");
    res.status(500).json({ error: "Failed to download artifact" });
  }
});

// GET /projects/:id/export-status
router.get("/projects/:id/export-status", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const artifacts = await db
      .select()
      .from(artifactFilesTable)
      .where(eq(artifactFilesTable.projectId, id))
      .orderBy(desc(artifactFilesTable.createdAt));

    const patchedAls = artifacts.find((a) => a.type === "patched_als");
    const patchedAlsExists = patchedAls ? existsSync(patchedAls.filePath) : false;

    const jobs = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.projectId, id))
      .orderBy(desc(jobsTable.createdAt))
      .limit(1);

    const latestJob = jobs[0] ?? null;

    // Count mutations from description field if available
    const mutationsApplied = patchedAls
      ? parseInt((patchedAls.description ?? "0 mutations").match(/(\d+) mutations/)?.[1] ?? "0")
      : 0;

    const trustLabel = patchedAls?.description?.match(/(SAFE_\w+|STRUCTURALLY_VALID_ALS|REQUIRES_MANUAL_REVIEW)/)?.[1] ?? null;

    res.json({
      projectId: id,
      projectStatus: project.status,
      hasPatchedAls: patchedAlsExists,
      patchedAlsFileName: patchedAls?.fileName ?? null,
      patchedAlsFileSize: patchedAls?.fileSize ?? null,
      mutationsApplied,
      trustLabel,
      jobState: latestJob?.state ?? null,
      jobMessage: latestJob?.message ?? null,
      originalFileName: project.originalFileName ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get export status");
    res.status(500).json({ error: "Failed to get export status" });
  }
});

// GET /projects/:id/export-als  — streams the patched .als file for download
router.get("/projects/:id/export-als", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const artifacts = await db
      .select()
      .from(artifactFilesTable)
      .where(eq(artifactFilesTable.projectId, id))
      .orderBy(desc(artifactFilesTable.createdAt));

    const patchedAls = artifacts.find((a) => a.type === "patched_als");

    if (!patchedAls) {
      res.status(409).json({
        error: "No patched .als file available. Upload and analyse a project first.",
        code: "NO_PATCHED_ALS",
      });
      return;
    }

    if (!existsSync(patchedAls.filePath)) {
      res.status(404).json({
        error: "Patched .als file was registered but is missing from disk.",
        code: "FILE_MISSING",
      });
      return;
    }

    res.setHeader("Content-Type", "application/x-ableton-live-set");
    res.setHeader("Content-Disposition", `attachment; filename="${patchedAls.fileName}"`);
    res.setHeader("X-Trust-Label", patchedAls.description ?? "");
    res.download(patchedAls.filePath, patchedAls.fileName);
  } catch (err) {
    req.log.error({ err }, "Failed to export ALS");
    res.status(500).json({ error: "Failed to export ALS" });
  }
});

// GET /projects/:id/export-diagnostics
router.get("/projects/:id/export-diagnostics", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const artifacts = await db
      .select()
      .from(artifactFilesTable)
      .where(eq(artifactFilesTable.projectId, id))
      .orderBy(desc(artifactFilesTable.createdAt));

    const diagFile = artifacts.find((a) => a.type === "export_diagnostics");

    if (!diagFile) {
      res.status(404).json({ error: "No export diagnostics available for this project" });
      return;
    }

    if (!existsSync(diagFile.filePath)) {
      res.status(404).json({ error: "Diagnostics file not found on disk" });
      return;
    }

    const raw = await fs.readFile(diagFile.filePath, "utf-8");
    const diagnostics = JSON.parse(raw);
    res.json(diagnostics);
  } catch (err) {
    req.log.error({ err }, "Failed to get export diagnostics");
    res.status(500).json({ error: "Failed to get export diagnostics" });
  }
});

// POST /projects/:id/parse (manual trigger — legacy alias)
router.post("/projects/:id/parse", async (req: Request, res: Response) => {
  const { id } = req.params;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project?.filePath) {
    res.status(400).json({ error: "No file uploaded for this project" });
    return;
  }
  const jobId = randomUUID();
  await db.insert(jobsTable).values({ id: jobId, projectId: id, type: "parse", state: "queued" });
  runPipelineJob(id, jobId, project.filePath, project.originalFileName ?? "").catch((err) => {
    logger.error({ err, projectId: id }, "Manual parse job failed");
  });
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  res.json({ id: job.id, projectId: job.projectId, type: job.type, state: job.state, progress: null, message: null, error: null, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), completedAt: null });
});

// POST /projects/:id/initiate-pipeline — start/restart the full analysis pipeline
// Safe to call when project already has a file. Does NOT require re-uploading.
router.post("/projects/:id/initiate-pipeline", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!project.filePath || !existsSync(project.filePath)) {
      res.status(400).json({
        error: "No uploaded file found for this project. Upload an .als file first.",
        code: "NO_FILE",
      });
      return;
    }

    // Reset project status so UI reflects fresh pipeline start
    await db.update(projectsTable).set({
      status: "uploaded",
      completionScore: null,
      styleTags: [],
      warnings: [],
    }).where(eq(projectsTable.id, id));

    const jobId = randomUUID();
    await db.insert(jobsTable).values({
      id: jobId,
      projectId: id,
      type: "parse",
      state: "queued",
      message: "Pipeline initiated by user",
    });

    runPipelineJob(id, jobId, project.filePath, project.originalFileName ?? "").catch((err) => {
      logger.error({ err, projectId: id }, "Initiate-pipeline job failed");
    });

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    req.log.info({ projectId: id, jobId }, "Pipeline initiated");

    res.json({
      projectId: id,
      jobId,
      state: job.state,
      message: "Pipeline started. Poll GET /projects/:id for status.",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to initiate pipeline");
    res.status(500).json({ error: "Failed to initiate pipeline" });
  }
});

export default router;
