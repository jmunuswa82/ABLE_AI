import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  useCreateProject,
  useUploadAlsFile,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { getStatusColor, getStatusLabel, formatScore, formatBars, isJobRunning } from "@/lib/utils";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [showUpload, setShowUpload] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: projects = [], isLoading, refetch } = useListProjects({
    query: {
      refetchInterval: (query) => {
        const projs = query.state.data ?? [];
        const hasRunning = projs.some((p: any) =>
          ["parsing", "queued", "analyzing", "generating", "exporting", "uploaded"].includes(p.status)
        );
        return hasRunning ? 3000 : false;
      },
    },
  });

  const createProject = useCreateProject();
  const uploadFile = useUploadAlsFile();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;

    const project = await createProject.mutateAsync({
      data: { name: projectName.trim() },
    });

    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      await uploadFile.mutateAsync({
        id: project.id,
        data: formData as any,
      });
    }

    await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    setShowUpload(false);
    setProjectName("");
    setFile(null);
    navigate(`/projects/${project.id}`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith(".als")) {
      setFile(droppedFile);
      if (!projectName) setProjectName(droppedFile.name.replace(".als", ""));
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload an Ableton .als file to analyze and complete your track
          </p>
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + New Project
        </button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <div className="mb-6 bg-card border border-card-border rounded-lg p-5">
          <h2 className="text-base font-medium mb-4 text-foreground">New Project</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Project Name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Techno Track"
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                required
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1.5">
                Ableton Live Set (.als)
              </label>
              <div
                onClick={() => fileRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".als"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFile(f);
                      if (!projectName) setProjectName(f.name.replace(".als", ""));
                    }
                  }}
                />
                {file ? (
                  <div>
                    <p className="text-sm font-medium text-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {(file.size / 1024).toFixed(1)} KB · Click to change
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Drop your .als file here or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ableton Live 10, 11, 12 · Max 64 MB
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createProject.isPending || uploadFile.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {createProject.isPending || uploadFile.isPending
                  ? "Creating..."
                  : file
                  ? "Upload & Analyze"
                  : "Create Project"}
              </button>
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm hover:opacity-90 transition-opacity"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Projects grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="text-muted-foreground text-sm">Loading projects...</div>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="text-4xl mb-4 opacity-20">♫</div>
          <p className="text-muted-foreground text-sm">No projects yet</p>
          <p className="text-muted-foreground text-xs mt-1">
            Create a project and upload an .als file to get started
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project: any) => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => navigate(`/projects/${project.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: any; onClick: () => void }) {
  const statusColor = getStatusColor(project.status);
  const statusLabel = getStatusLabel(project.status);
  const running = isJobRunning(project.status);

  return (
    <div
      onClick={onClick}
      className="bg-card border border-card-border rounded-lg p-4 cursor-pointer hover:border-border transition-all hover:shadow-md group"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate max-w-[180px]">
          {project.name}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {running && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
          <span className={`text-xs font-mono ${statusColor}`}>{statusLabel}</span>
        </div>
      </div>

      {project.originalFileName && (
        <p className="text-xs text-muted-foreground mb-3 truncate font-mono">
          {project.originalFileName}
        </p>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {project.completionScore != null && (
          <span>
            Score: <span className="text-foreground font-medium">{formatScore(project.completionScore)}</span>
          </span>
        )}
        {project.styleTags?.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {project.styleTags.slice(0, 2).map((tag: string) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 bg-accent/50 text-accent-foreground rounded text-[10px]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-border text-[10px] text-muted-foreground font-mono">
        {new Date(project.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}
