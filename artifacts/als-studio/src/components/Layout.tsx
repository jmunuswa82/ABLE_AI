import { Link, useRoute, useLocation } from "wouter";
import { ReactNode } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { LayoutDashboard, FileArchive, Activity, GitCommitHorizontal, Layers, Orbit } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const projectMatch = location.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch ? projectMatch[1] : null;

  const projectNavItems = projectId
    ? [
        { path: `/projects/${projectId}`, label: "Overview", icon: Activity },
        { path: `/projects/${projectId}/timeline`, label: "Timeline", icon: GitCommitHorizontal },
        { path: `/projects/${projectId}/plan`, label: "Plan", icon: Layers },
        { path: `/projects/${projectId}/export`, label: "Export", icon: FileArchive },
      ]
    : [];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden selection:bg-primary/30">
      {/* Animated Subtle Grid Background */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-40 bg-grid-pattern mix-blend-screen" />
      
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-sidebar/80 backdrop-blur-xl border-r border-sidebar-border flex flex-col z-10 shadow-2xl">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-sidebar-border/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
              <Orbit className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-mono text-primary uppercase tracking-widest leading-none mb-1 font-semibold">
                ALS Studio
              </div>
              <div className="text-sm font-display font-bold text-foreground leading-none">
                AI Track Completer
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <LayoutGroup>
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.path} {...item} currentPath={location} />
            ))}

            <AnimatePresence>
              {projectNavItems.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="pt-6 overflow-hidden"
                >
                  <div className="px-3 pb-2 flex items-center gap-2">
                    <div className="h-px bg-sidebar-border flex-1" />
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest font-semibold">
                      Project
                    </span>
                    <div className="h-px bg-sidebar-border flex-1" />
                  </div>
                  <div className="space-y-1">
                    {projectNavItems.map((item) => (
                      <NavItem key={item.path} {...item} currentPath={location} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </LayoutGroup>
        </nav>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-sidebar-border/50 bg-background/50 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <p className="text-[10px] text-muted-foreground font-mono font-medium">System Online · v2.0</p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto relative z-10 flex flex-col">
        {children}
      </main>
    </div>
  );
}

function NavItem({
  path,
  label,
  icon: Icon,
  currentPath,
}: {
  path: string;
  label: string;
  icon: any;
  currentPath: string;
}) {
  const isActive = path === "/" ? currentPath === "/" : currentPath.startsWith(path);

  return (
    <Link href={path} className="block relative group">
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-300 relative z-10",
          isActive
            ? "text-primary-foreground font-medium"
            : "text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent"
        )}
      >
        <Icon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "opacity-70 group-hover:opacity-100 transition-opacity")} />
        <span>{label}</span>
      </div>
      
      {/* Active State Background & Glow */}
      {isActive && (
        <motion.div
          layoutId="activeNavIndicator"
          className="absolute inset-0 bg-primary/20 border border-primary/30 rounded-lg -z-0"
          initial={false}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-lg shadow-[0_0_10px_var(--color-primary)]" />
        </motion.div>
      )}
    </Link>
  );
}
