import { useParams } from "wouter";
import { useListProjectArtifacts } from "@workspace/api-client-react";
import { formatBytes } from "@/lib/utils";

const ARTIFACT_CONFIG: Record<string, { icon: string; label: string; description: string; accent: string }> = {
  original_als: {
    icon: "♫",
    label: "Original ALS",
    description: "Your original uploaded Ableton Live Set file",
    accent: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  },
  patch_package: {
    icon: "⊕",
    label: "ALS Patch Package",
    description: "Complete package: original .als + completion plan + analysis + instructions (ZIP)",
    accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  project_graph: {
    icon: "⊞",
    label: "Project Graph",
    description: "Parsed project structure — all tracks, clips, devices, sections as structured JSON",
    accent: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  completion_plan: {
    icon: "✦",
    label: "Completion Plan",
    description: "AI completion plan with all actions, confidence scores, and rationale",
    accent: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  },
  instructions: {
    icon: "≡",
    label: "Instructions",
    description: "Human-readable Markdown guide for implementing completion steps in Ableton",
    accent: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  },
};

const TYPE_ORDER = ["patch_package", "original_als", "instructions", "completion_plan", "project_graph"];

export default function ExportView() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: artifacts = [], isLoading } = useListProjectArtifacts(id);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading artifacts...</div>;
  }

  const sorted = [...artifacts].sort((a: any, b: any) => {
    const ai = TYPE_ORDER.indexOf(a.type);
    const bi = TYPE_ORDER.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const patchPackage = sorted.find((a: any) => a.type === "patch_package");

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Export Artifacts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Download analysis results, completion plans, and the ALS Patch Package
        </p>
      </div>

      {patchPackage && (
        <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-lg p-5 flex items-center gap-4">
          <div className="text-3xl">⊕</div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-emerald-400">ALS Patch Package</p>
            <p className="text-xs text-muted-foreground mt-1">
              Complete bundle with your original .als file, AI completion plan, project analysis, and step-by-step instructions
            </p>
            <p className="text-[10px] text-muted-foreground font-mono mt-1">
              {formatBytes(patchPackage.fileSize)} · ZIP archive
            </p>
          </div>
          <a
            href={`/api/projects/${id}/artifacts/${patchPackage.id}/download`}
            download={patchPackage.fileName}
            className="shrink-0 px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-500 transition-colors"
          >
            Download Package
          </a>
        </div>
      )}

      {artifacts.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground text-sm">No artifacts available yet.</p>
          <p className="text-xs text-muted-foreground mt-2">
            Complete the analysis pipeline to generate downloadable artifacts.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-xs text-muted-foreground uppercase tracking-wider mt-2">Individual Artifacts</h2>
          {sorted
            .filter((a: any) => a.type !== "patch_package")
            .map((artifact: any) => (
              <ArtifactCard key={artifact.id} artifact={artifact} projectId={id} />
            ))}
        </div>
      )}

      <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-medium text-foreground">How to Use</h2>
        <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
          <li>Download the <strong className="text-foreground">ALS Patch Package</strong> for everything in one ZIP</li>
          <li>Open <strong className="text-foreground">completion-instructions.md</strong> for step-by-step guidance</li>
          <li>Open your .als file in Ableton Live and implement critical actions first</li>
          <li>Use the <strong className="text-foreground">project-graph.json</strong> to reference track IDs and structure</li>
        </ol>
      </div>
    </div>
  );
}

function ArtifactCard({ artifact, projectId }: { artifact: any; projectId: string }) {
  const config = ARTIFACT_CONFIG[artifact.type] ?? {
    icon: "◆",
    label: artifact.type,
    description: "",
    accent: "text-gray-400 bg-gray-500/10 border-gray-500/20",
  };
  const description = artifact.description || config.description;

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 flex items-center gap-4">
      <div className={`text-xl w-9 h-9 flex items-center justify-center rounded border ${config.accent} shrink-0`}>
        {config.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{artifact.fileName}</p>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground uppercase tracking-wider">
            {config.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{description}</p>
        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground font-mono">
          <span>{formatBytes(artifact.fileSize)}</span>
          <span>{artifact.mimeType}</span>
        </div>
      </div>

      <a
        href={`/api/projects/${projectId}/artifacts/${artifact.id}/download`}
        download={artifact.fileName}
        className="shrink-0 px-3 py-1.5 bg-secondary text-secondary-foreground rounded text-xs font-medium hover:bg-muted transition-colors"
      >
        Download
      </a>
    </div>
  );
}
