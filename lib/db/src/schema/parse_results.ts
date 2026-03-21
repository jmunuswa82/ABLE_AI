import { pgTable, text, timestamp, real, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const parseResultsTable = pgTable("parse_results", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  jobId: text("job_id").notNull(),
  projectGraph: jsonb("project_graph"),
  parseQuality: real("parse_quality"),
  warnings: text("warnings").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertParseResultSchema = createInsertSchema(parseResultsTable).omit({ createdAt: true });
export type InsertParseResult = z.infer<typeof insertParseResultSchema>;
export type ParseResult = typeof parseResultsTable.$inferSelect;
