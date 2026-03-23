import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  UploadCloud, FileAudio, Activity, ChevronRight, Lock,
  Database, Code2, X, Play,
} from "lucide-react";
import {
  useListProjects,
  useCreateProject,
  useUploadAlsFile,
  getListProjectsQueryKey,
  getGetProjectQueryKey,
  getGetProjectGraphQueryKey,
  getGetCompletionPlanQueryKey,
} from "@workspace/api-client-react";
import { getStatusColor, getStatusLabel, formatScore, isJobRunning, cn } from "@/lib/utils";
import { ANIMATION_VARIANTS } from "@/lib/design";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

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

  const isPending = createProject.isPending || uploadFile.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !projectName.trim() || isPending) return;

    try {
      const project = await createProject.mutateAsync({
        data: { name: projectName.trim() },
      });

      await uploadFile.mutateAsync({
        id: project.id,
        data: { file },
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: getGetProjectGraphQueryKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: getGetCompletionPlanQueryKey(project.id) }),
      ]);

      setProjectName("");
      setFile(null);
      navigate(`/projects/${project.id}`);
    } catch {
    }
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

  const openPicker = () => fileRef.current?.click();
  const clearFile = () => { setFile(null); };

  const activeProjectCount = projects.filter(
    (p: any) => !["failed", "exported"].includes(p.status)
  ).length;

  return (
    <motion.div
      className="p-4 md:p-8 max-w-7xl mx-auto w-full mb-12"
      variants={ANIMATION_VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 mb-8 md:mb-12 relative z-10">
        <div className="max-w-xl">
          <motion.h1
            className="text-[28px] md:text-[36px] font-display font-bold text-[var(--text-primary)] mb-3 md:mb-4 tracking-[-1.8px]"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            Neural <span className="text-primary">Ingestion</span> Hub
          </motion.h1>
          <motion.p
            className="text-[var(--text-secondary)] text-[14px] md:text-[16px] leading-[24px] md:leading-[26px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            Deploy your Ableton Live Sets into our intelligence engine. We decompose your
            session into multidimensional data points for advanced structural modeling.
          </motion.p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 relative z-10">

        <div className="lg:col-span-8 bg-[var(--bg-panel)] border-2 border-dashed border-[var(--amber-border)] rounded-xl relative flex flex-col">
          <div className="absolute inset-0 flex items-end justify-center gap-1 opacity-[0.15] pointer-events-none pb-[96px] overflow-hidden">
            {Array.from({ length: 42 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-1 bg-[var(--amber-light)] rounded-t-[2px]"
                animate={{ height: `${20 + Math.random() * 60}%` }}
                transition={{
                  duration: 2 + Math.random() * 2,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col relative z-10">
            <div
              className={cn(
                "flex-1 flex flex-col items-center justify-center p-6 md:p-8 rounded-xl transition-all duration-300 min-h-[200px]",
                !file ? "cursor-pointer" : "cursor-default",
                dragOver && "scale-[1.02]"
              )}
              onClick={!file ? openPicker : undefined}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
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
                  e.target.value = "";
                }}
              />

              <div
                className={cn(
                  "p-5 md:p-6 rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] mb-6 md:mb-8 transition-transform",
                  !file && "active:scale-95 md:hover:scale-110"
                )}
                style={{ background: "var(--bg-overlay)" }}
              >
                {file ? (
                  <FileAudio className="w-8 h-8 text-[var(--amber-light)]" />
                ) : (
                  <UploadCloud className="w-8 h-8 text-[var(--amber-light)]" />
                )}
              </div>

              {file ? (
                <div className="text-center w-full max-w-sm">
                  <h3 className="text-xl md:text-2xl font-display font-bold text-white mb-1 truncate">
                    {file.name}
                  </h3>
                  <p className="text-sm font-label tracking-[0.35px] text-[var(--text-muted)] uppercase mb-2">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · Ready for ingestion
                  </p>
                  <div className="flex items-center justify-center gap-4 mb-6">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openPicker(); }}
                      className="text-[11px] font-label uppercase tracking-wider text-[var(--amber)] underline underline-offset-2 active:text-[var(--amber-light)] md:hover:text-[var(--amber-light)] transition-colors min-h-[44px] flex items-center"
                    >
                      Replace File
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); clearFile(); }}
                      className="text-[11px] font-label uppercase tracking-wider text-[var(--text-muted)] active:text-white md:hover:text-white flex items-center gap-1 transition-colors min-h-[44px]"
                    >
                      <X className="w-3 h-3" /> Clear
                    </button>
                  </div>

                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Project Designation"
                    required
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--amber-border)] rounded-md px-4 py-3 text-sm text-center text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono"
                  />
                </div>
              ) : (
                <div className="text-center">
                  <h3 className="text-xl md:text-2xl font-display font-bold text-white mb-2">
                    Drop Ableton Live Set
                  </h3>
                  <p className="text-sm font-label tracking-[0.35px] text-[var(--text-muted)] uppercase mb-6">
                    Maximum 500 MB · .als only
                  </p>
                  <div className="inline-flex items-center gap-2 px-5 py-3 md:py-2.5 rounded-md border border-[var(--amber-border)] text-[var(--amber)] text-[12px] font-label uppercase tracking-wider min-h-[44px]">
                    <UploadCloud className="w-3.5 h-3.5" /> Select from Browser
                  </div>
                </div>
              )}
            </div>

            {file && (
              <div className="px-4 pb-4 md:px-8 md:pb-8">
                <button
                  type="submit"
                  disabled={isPending || !projectName.trim()}
                  className="btn-primary w-full py-4 rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 font-display font-bold uppercase tracking-wider text-[14px] min-h-[48px]"
                >
                  {isPending ? (
                    <><Activity className="w-4 h-4 animate-spin" /> Ingesting…</>
                  ) : (
                    <><Play className="w-4 h-4" /> Initiate Pipeline</>
                  )}
                </button>
                {createProject.isError && (
                  <p className="text-red-400 text-[11px] text-center mt-2">
                    Upload failed — please try again.
                  </p>
                )}
              </div>
            )}
          </form>

          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#33343a] rounded-b-xl overflow-hidden pointer-events-none">
            <motion.div
              className="absolute top-0 bottom-0 left-0 bg-primary shadow-[0_0_10px_0_var(--amber)]"
              initial={{ width: "25%" }}
              animate={{ width: dragOver || file ? "100%" : "25%" }}
              transition={{ duration: 0.8 }}
            />
          </div>
        </div>

        <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-3 md:gap-4">
          <StageCard step="01" name="Upload" desc="Bit-perfect data ingestion with integrity verification for .als binary headers." active={true} />
          <StageCard step="02" name="Parsing" desc="Decompressing XML project structure and mapping track routing topology." active={activeProjectCount > 0} />
          <StageCard step="03" name="Structure" desc="Identifying intro, verse, chorus, and bridge markers via structural pattern detection." active={false} />
          <StageCard step="04" name="Automation" desc="Extracting filter envelopes, gain riding, and VST parameter curves." active={false} />
        </div>

        <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mt-2">
          <InfoCard
            icon={<Lock className="w-6 h-6 text-primary" />}
            title="Secure Vault"
            subtitle="End-to-end Encrypted"
            metaLeft="Security Protocol"
            valLeft="AES-256-GCM"
            metaRight="Cloud Sync"
            valRight="LOCAL STORAGE"
          />
          <div className="bg-[var(--bg-card)] border border-[var(--amber-border)] rounded-lg p-5 md:p-6 flex flex-col justify-between">
            <div className="flex gap-4 items-center mb-6">
              <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-lg border border-primary/20">
                <Database className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h4 className="font-display font-bold text-base text-white">Neural Engine</h4>
                <span className="font-label text-[10px] text-[var(--text-muted)] uppercase">V4.2 Core Intelligence</span>
              </div>
            </div>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-1.5 bg-[#1e1f25] rounded-full overflow-hidden">
                  <div className="h-full bg-primary w-[88%] shadow-[0_0_8px_var(--amber)]" />
                </div>
                <span className="font-mono text-[10px] text-[var(--amber-light)]">88% CAP</span>
              </div>
              <p className="font-label text-[10px] text-[var(--text-muted)] leading-relaxed">
                Allocating processing capacity for structure detection.
              </p>
            </div>
          </div>
          <InfoCard
            icon={<Code2 className="w-6 h-6 text-primary" />}
            title="Version Support"
            subtitle="Compatibility Layer"
            tags={["ABLETON 10.x", "ABLETON 11.x"]}
            activeTag="ABLETON 12.x Beta"
          />
        </div>
      </div>

      <div className="mt-8 md:mt-12 relative z-10">
        <h2 className="font-display font-bold text-xl md:text-2xl text-white mb-4 md:mb-6">Active Databanks</h2>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-4 glass-panel">
            <Activity className="w-8 h-8 text-primary animate-pulse" />
            <div className="text-[var(--text-muted)] font-label text-xs uppercase tracking-widest">
              Scanning local databanks...
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center glass-panel">
            <p className="text-[var(--text-secondary)] text-sm max-w-md mx-auto mb-4 font-sans">
              No structural analyses found. Upload an Ableton Live Set above.
            </p>
          </div>
        ) : (
          <motion.div
            variants={ANIMATION_VARIANTS.staggerContainer}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6"
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

function StageCard({ step, name, desc, active }: any) {
  return (
    <div className={cn(
      "bg-[var(--bg-panel)] rounded-lg p-4 md:p-5 flex flex-col gap-2 md:gap-3 transition-all relative overflow-hidden",
      active
        ? "border-l-[3px] border-primary opacity-100"
        : "border-l-[3px] border-[var(--amber-border-strong)] opacity-60"
    )}>
      <div className="flex items-start justify-between">
        <div className="flex gap-3 items-center">
          <div className="font-display font-bold text-sm tracking-[1.4px] uppercase text-[var(--text-primary)]">
            <span className="text-[var(--text-muted)]">Stage {step}:</span><br />{name}
          </div>
        </div>
        {active ? (
          <span className="bg-primary/10 text-primary font-sans text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold">
            Active
          </span>
        ) : (
          <span className="bg-[#1e293b] text-[#94a3b8] font-sans text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold">
            Pending
          </span>
        )}
      </div>
      <p className="text-[12px] font-sans text-[var(--text-muted)] leading-[19.5px] max-w-[200px]">
        {desc}
      </p>
    </div>
  );
}

function InfoCard({ icon, title, subtitle, metaLeft, valLeft, metaRight, valRight, tags, activeTag }: any) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--amber-border)] rounded-lg p-5 md:p-6 flex flex-col justify-between gap-6">
      <div className="flex gap-4 items-center">
        <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-lg border border-primary/20">
          {icon}
        </div>
        <div>
          <h4 className="font-display font-bold text-base text-white">{title}</h4>
          <span className="font-label text-[10px] text-[var(--text-muted)] uppercase">{subtitle}</span>
        </div>
      </div>
      {tags ? (
        <div className="flex flex-col gap-2">
          {tags.map((t: string) => (
            <div key={t} className="bg-[#1e1f25] px-2 py-1 rounded-sm w-fit text-[10px] font-mono text-[var(--text-code)]">
              {t}
            </div>
          ))}
          {activeTag && (
            <div className="bg-primary/20 px-2 py-1 rounded-sm w-fit text-[10px] font-mono text-primary font-bold">
              {activeTag}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-end">
            <span className="font-sans text-[11px] text-[var(--text-secondary)]">{metaLeft}</span>
            <span className="font-mono text-[11px] text-[var(--amber-light)]">{valLeft}</span>
          </div>
          <div className="flex justify-between items-end">
            <span className="font-sans text-[11px] text-[var(--text-secondary)]">{metaRight}</span>
            <span className="font-mono text-[11px] text-[var(--amber-light)]">{valRight}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: any; onClick: () => void }) {
  const statusColor = getStatusColor(project.status);
  const statusLabel = getStatusLabel(project.status);
  const running = isJobRunning(project.status);
  const isActive = project.status === "exported" || running;

  const score = project.completionScore ?? 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - score * circumference;

  return (
    <motion.div
      variants={ANIMATION_VARIANTS.staggerItem}
      onClick={onClick}
      className={cn(
        "bg-[var(--bg-panel)] rounded-lg p-5 md:p-6 cursor-pointer group relative overflow-hidden flex flex-col h-full border-y border-r transition-all min-h-[100px]",
        isActive
          ? "border-l-[3px] border-l-primary border-y-[var(--amber-border)] border-r-[var(--amber-border)] active:border-r-primary/50 active:border-y-primary/50 md:hover:border-r-primary/50 md:hover:border-y-primary/50"
          : "border-l-[3px] border-[var(--amber-border)] active:border-[var(--amber-border-strong)] md:hover:border-[var(--amber-border-strong)]"
      )}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 pointer-events-none transition-opacity group-hover:bg-primary/10" />

      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className="flex-1 min-w-0 pr-4">
          <h3 className="text-lg font-display font-bold text-white group-hover:text-primary transition-colors truncate">
            {project.name}
          </h3>
          {project.originalFileName && (
            <p className="text-[11px] text-[var(--text-muted)] mt-1 truncate font-mono bg-[var(--bg-card)] inline-block px-2 py-0.5 rounded border border-[var(--amber-border)]">
              {project.originalFileName}
            </p>
          )}
        </div>
        <div className="shrink-0 relative flex items-center justify-center w-12 h-12">
          <svg className="w-12 h-12 transform -rotate-90">
            <circle cx="24" cy="24" r={radius} stroke="currentColor" strokeWidth="2" fill="transparent" className="text-[var(--bg-elevated)]" />
            <circle cx="24" cy="24" r={radius} stroke="currentColor" strokeWidth="2.5" fill="transparent"
              strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
              className={cn("transition-all duration-1000 ease-out", score > 0.7 ? "text-emerald-500" : "text-primary")}
            />
          </svg>
          <span className="absolute text-[10px] font-mono font-bold text-white">
            {project.completionScore != null ? Math.round(score * 100) : "--"}
          </span>
        </div>
      </div>

      <div className="mt-auto space-y-4 relative z-10">
        {project.styleTags?.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {project.styleTags.slice(0, 3).map((tag: string) => (
              <span key={tag} className="px-2 py-1 bg-primary/10 text-primary border border-primary/20 rounded text-[9px] uppercase tracking-wider font-label font-semibold">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-4 border-t border-[var(--amber-border)]">
          <div className="flex items-center gap-2">
            {running && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
            )}
            <span className={cn("text-[9px] font-label uppercase tracking-widest font-semibold", statusColor)}>
              {statusLabel}
            </span>
          </div>
          <span className="text-[10px] text-[var(--text-code)] font-mono flex items-center gap-1">
            <ChevronRight className="w-3 h-3" />
            {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
