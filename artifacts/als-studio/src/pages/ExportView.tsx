import { useParams } from "wouter";
import { useListProjectArtifacts } from "@workspace/api-client-react";
import { formatBytes } from "@/lib/utils";

const ARTIFACT_ICONS: Record<string, string> = {
  project_graph: "⊞",
  completion_plan: "✦",
  instructions: "≡",
  patch: "⊕",
};

const ARTIFACT_DESCRIPTIONS: Record<string, string> = {
  project_graph: "Parsed project structure — all tracks, clips, devices, sections as structured JSON",
  completion_plan: "AI completion plan with all actions, confidence scores, and rationale",
  instructions: "Human-readable Markdown guide for implementing completion steps in Ableton",
  patch: "Machine-readable patch file for automated project mutations",
};

export default function ExportView() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: artifacts = [], isLoading } = useListProjectArtifacts(id);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading artifacts...</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Export Artifacts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Download analysis results and completion plans for use in Ableton Live
        </p>
      </div>

      {/* Disclaimer */}
      <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4 text-xs text-yellow-500/80 space-y-1">
        <p className="font-medium text-yellow-400">Important Note</p>
        <p>
          The exported JSON artifacts represent a structured analysis of your project. The completion
          instructions describe changes to make manually in Ableton Live. Direct ALS file mutation
          is architecture-constrained by Ableton's format — implement suggestions manually for best results.
        </p>
      </div>

      {artifacts.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground text-sm">No artifacts available yet.</p>
          <p className="text-xs text-muted-foreground mt-2">
            Complete the analysis pipeline to generate downloadable artifacts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {artifacts.map((artifact: any) => (
            <ArtifactCard key={artifact.id} artifact={artifact} projectId={id} />
          ))}
        </div>
      )}

      {/* Usage guide */}
      <div className="bg-card border border-card-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-medium text-foreground">How to Use These Artifacts</h2>
        <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
          <li>Download the <strong className="text-foreground">completion-instructions.md</strong> — open it in any text editor</li>
          <li>Review the completion score and prioritized actions in order</li>
          <li>Open your .als file in Ableton Live and implement critical actions first</li>
          <li>Use the <strong className="text-foreground">project-graph.json</strong> to reference track IDs and structure</li>
          <li>Use the <strong className="text-foreground">completion-plan.json</strong> for machine-readable integration into tools</li>
        </ol>
      </div>
    </div>
  );
}

function ArtifactCard({ artifact, projectId }: { artifact: any; projectId: string }) {
  const icon = ARTIFACT_ICONS[artifact.type] ?? "◆";
  const description = artifact.description || ARTIFACT_DESCRIPTIONS[artifact.type] || "";

  const downloadUrl = `/api/projects/${projectId}/artifacts/${artifact.id}/download`;

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 flex items-center gap-4">
      <div className="text-2xl opacity-60 shrink-0">{icon}</div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{artifact.fileName}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground font-mono">
          <span>{formatBytes(artifact.fileSize)}</span>
          <span>{artifact.mimeType}</span>
          <span>{new Date(artifact.createdAt).toLocaleString()}</span>
        </div>
      </div>

      <a
        href={downloadUrl}
        download={artifact.fileName}
        className="shrink-0 px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium hover:opacity-90 transition-opacity"
      >
        Download
      </a>
    </div>
  );
}
