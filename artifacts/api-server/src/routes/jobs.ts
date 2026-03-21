import { Router, type IRouter, type Request, type Response } from "express";
import { db, jobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/jobs/:jobId", async (req: Request, res: Response) => {
  const { jobId } = req.params;

  try {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.json({
      id: job.id,
      projectId: job.projectId,
      type: job.type,
      state: job.state,
      progress: job.progress,
      message: job.message,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get job");
    res.status(500).json({ error: "Failed to get job" });
  }
});

export default router;
