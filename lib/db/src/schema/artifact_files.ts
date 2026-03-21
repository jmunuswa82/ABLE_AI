import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const artifactFilesTable = pgTable("artifact_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  jobId: text("job_id"),
  type: text("type").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertArtifactFileSchema = createInsertSchema(artifactFilesTable).omit({ createdAt: true });
export type InsertArtifactFile = z.infer<typeof insertArtifactFileSchema>;
export type ArtifactFile = typeof artifactFilesTable.$inferSelect;
