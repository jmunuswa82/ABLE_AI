import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, UploadCloud, FileAudio, ChevronRight, Activity } from "lucide-react";
import {
  useListProjects,
  useCreateProject,
  useUploadAlsFile,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { getStatusColor, getStatusLabel, formatScore, isJobRunning, cn } from "@/lib/utils";
import { ANIMATION_VARIANTS } from "@/lib/design";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [showUpload, setShowUpload] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: projects = [], isLoading } = useListProjects({
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
      await uploadFile.mutateAsync({
        id: project.id,
        data: { file },
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
    <motion.div 
      className="p-8 max-w-6xl mx-auto w-full"
      variants={ANIMATION_VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12 relative z-10">
        <div>
          <motion.h1 
            className="text-4xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60 mb-2"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            Studio Dashboard
          </motion.h1>
          <motion.p 
            className="text-muted-foreground text-sm max-w-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            Upload an Ableton .als file to unleash AI-driven analysis, intelligent track completion, and cinematic workflow enhancements.
          </motion.p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowUpload(!showUpload)}
          className={cn(
            "px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all shadow-lg",
            showUpload 
              ? "bg-muted text-foreground hover:bg-muted/80"
              : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/25 hover:shadow-primary/40"
          )}
        >
          {showUpload ? "Cancel Upload" : <><Plus className="w-4 h-4" /> New Project</>}
        </motion.button>
      </div>

      <AnimatePresence mode="wait">
        {/* Upload form */}
        {showUpload && (
          <motion.div 
            variants={ANIMATION_VARIANTS.slideUp}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mb-12 glass-panel rounded-2xl p-8 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            
            <h2 className="text-xl font-display font-semibold mb-6 flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-primary" /> Initialize Project
            </h2>
            <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
              <div>
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider block mb-2">
                  Project Designation
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Cyberpunk Bassline v2"
                  className="w-full bg-input/50 backdrop-blur-sm border border-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider block mb-2">
                  Ableton Live Set (.als)
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-300 relative overflow-hidden group",
                    dragOver
                      ? "border-primary bg-primary/10 shadow-[0_0_30px_rgba(139,92,246,0.15)]"
                      : "border-border hover:border-primary/50 bg-background/50"
                  )}
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
                  
                  <div className="relative z-10 flex flex-col items-center">
                    <div className={cn("p-4 rounded-full mb-4 transition-colors", file ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary")}>
                      {file ? <FileAudio className="w-8 h-8" /> : <UploadCloud className="w-8 h-8" />}
                    </div>
                    
                    {file ? (
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">{file.name}</p>
                        <p className="text-xs font-mono text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB · Click to reselect
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">
                          Drag & drop your .als file here
                        </p>
                        <p className="text-xs text-muted-foreground">
                          or click to browse local files (Live 10, 11, 12 supported)
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUpload(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createProject.isPending || uploadFile.isPending}
                  className="px-8 py-2.5 bg-gradient-to-r from-primary to-accent text-white rounded-xl text-sm font-semibold hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {createProject.isPending || uploadFile.isPending ? (
                    <><Activity className="w-4 h-4 animate-spin" /> Initializing...</>
                  ) : file ? (
                    "Upload & Analyze"
                  ) : (
                    "Create Empty Project"
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Projects grid */}
      <div className="relative z-10">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <Activity className="w-8 h-8 text-primary animate-pulse" />
            <div className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Scanning local databanks...</div>
          </div>
        ) : projects.length === 0 ? (
          <motion.div 
            variants={ANIMATION_VARIANTS.slideUp}
            className="flex flex-col items-center justify-center h-80 text-center glass-panel rounded-3xl"
          >
            <div className="w-20 h-20 bg-muted rounded-2xl flex items-center justify-center mb-6 shadow-inner">
              <FileAudio className="w-8 h-8 text-muted-foreground opacity-50" />
            </div>
            <h3 className="text-xl font-display font-semibold text-foreground mb-2">No Projects Detected</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-8">
              Initialize a new project by uploading your Ableton Live Set to begin AI completion analysis.
            </p>
            <button
              onClick={() => setShowUpload(true)}
              className="px-6 py-3 bg-primary/10 text-primary border border-primary/20 rounded-xl text-sm font-semibold hover:bg-primary/20 transition-colors"
            >
              Start First Project
            </button>
          </motion.div>
        ) : (
          <motion.div 
            variants={ANIMATION_VARIANTS.staggerContainer}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
          >
            {projects.map((project: any) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigate(`/projects/${project.id}`)}
              />
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function ProjectCard({ project, onClick }: { project: any; onClick: () => void }) {
  const statusColor = getStatusColor(project.status);
  const statusLabel = getStatusLabel(project.status);
  const running = isJobRunning(project.status);

  // SVG Circular Progress logic
  const score = project.completionScore != null ? project.completionScore : 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - score * circumference;

  return (
    <motion.div
      variants={ANIMATION_VARIANTS.staggerItem}
      onClick={onClick}
      className="glass-panel rounded-2xl p-6 cursor-pointer glow-border-hover group relative overflow-hidden flex flex-col h-full"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none transition-opacity group-hover:bg-primary/10" />
      
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="text-lg font-display font-bold text-foreground group-hover:text-primary transition-colors truncate">
            {project.name}
          </h3>
          {project.originalFileName && (
            <p className="text-[11px] text-muted-foreground mt-1 truncate font-mono bg-muted/50 inline-block px-2 py-0.5 rounded">
              {project.originalFileName}
            </p>
          )}
        </div>
        
        {/* Score Ring */}
        <div className="shrink-0 relative flex items-center justify-center w-12 h-12">
          <svg className="w-12 h-12 transform -rotate-90">
            <circle
              cx="24" cy="24" r={radius}
              stroke="currentColor" strokeWidth="3" fill="transparent"
              className="text-border"
            />
            <circle
              cx="24" cy="24" r={radius}
              stroke="currentColor" strokeWidth="3" fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={cn(
                "transition-all duration-1000 ease-out",
                score > 0.7 ? "text-emerald-400" : score > 0.4 ? "text-amber-400" : "text-primary"
              )}
            />
          </svg>
          <span className="absolute text-[10px] font-mono font-bold text-foreground">
            {project.completionScore != null ? Math.round(score * 100) : "--"}
          </span>
        </div>
      </div>

      <div className="mt-auto space-y-4 relative z-10">
        {project.styleTags?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {project.styleTags.slice(0, 3).map((tag: string) => (
              <span
                key={tag}
                className="px-2 py-1 bg-accent/10 text-accent-foreground border border-accent/20 rounded-md text-[10px] uppercase tracking-wider font-semibold"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            {running && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
            )}
            <span className={cn("text-[11px] font-mono uppercase tracking-wider font-semibold", statusColor)}>
              {statusLabel}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      
      <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-transparent via-primary/0 to-transparent group-hover:via-primary/50 transition-all duration-500" />
    </motion.div>
  );
}
