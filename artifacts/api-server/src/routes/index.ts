import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import jobsRouter from "./jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(jobsRouter);

export default router;
