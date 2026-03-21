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

    res.download(artifact.filePath, artifact.fileName);
  } catch (err) {
    req.log.error({ err }, "Failed to download artifact");
    res.status(500).json({ error: "Failed to download artifact" });
  }
});

// POST /projects/:id/parse (manual trigger)
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

export default router;
