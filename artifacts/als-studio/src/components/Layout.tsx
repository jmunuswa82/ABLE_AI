import { Link, useRoute, useLocation } from "wouter";
import { ReactNode } from "react";
import { useParams } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: "⊞" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  // Extract project id from location if present
  const projectMatch = location.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch ? projectMatch[1] : null;

  const projectNavItems = projectId
    ? [
        { path: `/projects/${projectId}`, label: "Detail", icon: "◈" },
        { path: `/projects/${projectId}/timeline`, label: "Timeline", icon: "▦" },
        { path: `/projects/${projectId}/plan`, label: "Plan", icon: "✦" },
        { path: `/projects/${projectId}/export`, label: "Export", icon: "↓" },
      ]
    : [];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-sidebar-border">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
            ALS Studio
          </div>
          <div className="text-sm font-semibold text-foreground leading-tight">
            AI Track
            <br />
            Completion
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.path} {...item} currentPath={location} />
          ))}

          {projectNavItems.length > 0 && (
            <>
              <div className="px-2 pt-4 pb-1">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  Project
                </span>
              </div>
              {projectNavItems.map((item) => (
                <NavItem key={item.path} {...item} currentPath={location} />
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-[10px] text-muted-foreground font-mono">v1.0.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function NavItem({
  path,
  label,
  icon,
  currentPath,
}: {
  path: string;
  label: string;
  icon: string;
  currentPath: string;
}) {
  const isActive =
    path === "/"
      ? currentPath === "/"
      : currentPath.startsWith(path);

  return (
    <Link href={path}>
      <div
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded text-sm cursor-pointer transition-colors ${
          isActive
            ? "bg-sidebar-accent text-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
        }`}
      >
        <span className="text-xs opacity-70">{icon}</span>
        <span>{label}</span>
      </div>
    </Link>
  );
}
