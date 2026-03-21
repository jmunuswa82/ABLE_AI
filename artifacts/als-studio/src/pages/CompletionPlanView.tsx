import { useState } from "react";
import { useParams } from "wouter";
import { useGetCompletionPlan } from "@workspace/api-client-react";
import { formatScore } from "@/lib/utils";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  high: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  low: "text-green-400 bg-green-500/10 border-green-500/20",
};

const CATEGORY_ICONS: Record<string, string> = {
  structure: "⊞",
  drums: "◉",
  bass: "⊔",
  automation: "≋",
  transitions: "→",
  ending: "◁",
  texture: "∿",
};

export default function CompletionPlanView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: plan, isLoading } = useGetCompletionPlan(id);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading completion plan...</div>;
  }

  if (!plan) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground text-sm">No completion plan available yet.</p>
        <p className="text-xs text-muted-foreground mt-2">Analysis must complete first.</p>
      </div>
    );
  }

  const actions = plan.actions ?? [];
  const categories = [...new Set(actions.map((a: any) => a.category))];
  const filtered = selectedCategory
    ? actions.filter((a: any) => a.category === selectedCategory)
    : actions;

  const criticalCount = actions.filter((a: any) => a.priority === "critical").length;
  const highCount = actions.filter((a: any) => a.priority === "high").length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Completion Plan</h1>
        <p className="text-sm text-muted-foreground mt-1">{plan.summary}</p>
      </div>

      {/* Score + confidence */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Completion Score"
          value={formatScore(plan.completionScore)}
          valueClass={plan.completionScore > 0.7 ? "text-green-400" : plan.completionScore > 0.4 ? "text-yellow-400" : "text-red-400"}
        />
        <MetricCard label="Confidence" value={formatScore(plan.confidence)} />
        <MetricCard label="Actions" value={String(actions.length)} />
        <MetricCard
          label="Critical / High"
          value={`${criticalCount} / ${highCount}`}
          valueClass="text-orange-400"
        />
      </div>

      {/* Style tags */}
      {plan.styleTags?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plan.styleTags.map((tag: string) => (
            <span
              key={tag}
              className="px-3 py-1 bg-primary/15 text-primary border border-primary/20 rounded-full text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Weaknesses */}
      {plan.weaknesses?.length > 0 && (
        <div className="bg-card border border-card-border rounded-lg p-4">
          <h2 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Detected Weaknesses ({plan.weaknesses.length})
          </h2>
          <div className="space-y-1.5">
            {plan.weaknesses.map((w: string, i: number) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-yellow-500 shrink-0 mt-0.5">▲</span>
                <span className="text-foreground/80">{w}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <FilterButton
          label="All"
          active={selectedCategory === null}
          onClick={() => setSelectedCategory(null)}
          count={actions.length}
        />
        {categories.map((cat: string) => (
          <FilterButton
            key={cat}
            label={`${CATEGORY_ICONS[cat] ?? "◆"} ${cat}`}
            active={selectedCategory === cat}
            onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
            count={actions.filter((a: any) => a.category === cat).length}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {filtered.map((action: any) => (
          <ActionCard
            key={action.id}
            action={action}
            expanded={expandedId === action.id}
            onToggle={() => setExpandedId(expandedId === action.id ? null : action.id)}
          />
        ))}
      </div>

      {/* Rationale */}
      <div className="bg-card border border-card-border rounded-lg p-4">
        <h2 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Analysis Rationale</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">{plan.rationale}</p>
      </div>
    </div>
  );
}

function ActionCard({
  action,
  expanded,
  onToggle,
}: {
  action: any;
  expanded: boolean;
  onToggle: () => void;
}) {
  const priorityClass = PRIORITY_COLORS[action.priority] ?? PRIORITY_COLORS.medium;

  return (
    <div
      className={`bg-card border rounded-lg overflow-hidden transition-all ${
        expanded ? "border-border" : "border-card-border"
      }`}
    >
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/5"
        onClick={onToggle}
      >
        <div className="shrink-0 mt-0.5">
          <span className="text-base">
            {CATEGORY_ICONS[action.category] ?? "◆"}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-medium text-foreground">{action.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityClass}`}>
              {action.priority}
            </span>
            <span className="text-xs text-muted-foreground">{action.category}</span>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2">
            {action.description}
          </p>

          {/* Confidence bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="w-24 h-1 bg-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${action.confidence * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {Math.round(action.confidence * 100)}% confidence
            </span>
          </div>
        </div>

        <div className="shrink-0 text-muted-foreground text-sm">
          {expanded ? "▲" : "▼"}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-border/50">
          <p className="text-sm text-foreground/90 leading-relaxed">{action.description}</p>

          {action.affectedBars && (
            <div className="flex gap-2 text-xs">
              <span className="text-muted-foreground">Bars:</span>
              <span className="text-foreground font-mono">{action.affectedBars}</span>
            </div>
          )}

          {action.affectedTracks?.length > 0 && (
            <div className="flex gap-2 text-xs flex-wrap">
              <span className="text-muted-foreground shrink-0">Tracks:</span>
              {action.affectedTracks.map((t: string) => (
                <span key={t} className="px-1.5 py-0.5 bg-muted/40 text-foreground rounded text-[10px]">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-4 text-xs">
            <span className="text-muted-foreground">
              Impact: <span className="text-foreground">{action.expectedImpact}</span>
            </span>
          </div>

          <div className="p-3 bg-muted/20 rounded border border-border/50">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="text-foreground/70 font-medium">Rationale: </span>
              {action.rationale}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterButton({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {label}
      <span className={`text-[10px] ${active ? "opacity-70" : "opacity-50"}`}>({count})</span>
    </button>
  );
}

function MetricCard({
  label,
  value,
  valueClass = "text-foreground",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-base font-semibold font-mono ${valueClass}`}>{value}</p>
    </div>
  );
}
