import { pgTable, text, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const completionPlansTable = pgTable("completion_plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  jobId: text("job_id").notNull(),
  planData: jsonb("plan_data"),
  confidence: real("confidence"),
  completionScore: real("completion_score"),
  styleTags: text("style_tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCompletionPlanSchema = createInsertSchema(completionPlansTable).omit({ createdAt: true });
export type InsertCompletionPlan = z.infer<typeof insertCompletionPlanSchema>;
export type CompletionPlan = typeof completionPlansTable.$inferSelect;
