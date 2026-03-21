import { Link, useLocation } from "wouter";
import { ReactNode } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { LayoutDashboard, FileArchive, Activity, GitCommitHorizontal, Layers, Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/", label: "Hub", icon: LayoutDashboard },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  const projectMatch = location.match(/^\/projects\/([^/]+)/);
  const projectId = projectMatch ? projectMatch[1] : null;

  const projectNavItems = projectId
    ? [
        { path: `/projects/${projectId}`, label: "Overview", icon: Activity },
        { path: `/projects/${projectId}/timeline`, label: "Matrix", icon: GitCommitHorizontal },
        { path: `/projects/${projectId}/plan`, label: "Strategy", icon: Layers },
        { path: `/projects/${projectId}/export`, label: "Deploy", icon: FileArchive },
      ]
    : [];

  return (
    <div className="flex h-screen bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden selection:bg-primary/30">
      
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-[var(--bg-card)] border-r border-[var(--amber-border-strong)] flex flex-col z-20 shadow-2xl">
        {/* Logo */}
        <div className="px-6 py-8 border-b border-[var(--amber-border)] relative overflow-hidden">
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-8 h-8 rounded border border-primary/50 bg-primary/10 flex items-center justify-center shadow-[0_0_15px_rgba(255,183,3,0.15)]">
              <Hexagon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-[9px] font-label text-[var(--text-footer)] uppercase tracking-widest leading-none mb-1.5 font-semibold">
                ALS STUDIO
              </div>
              <div className="text-sm font-display font-bold text-[var(--text-primary)] leading-none">
                Neural Intelligence
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-3">
            <span className="text-[9px] font-label text-[var(--text-footer)] uppercase tracking-widest">Core</span>
          </div>
          
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
                  <div className="px-3 pb-3">
                    <span className="text-[9px] font-label text-[var(--text-footer)] uppercase tracking-widest">Active Project</span>
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

        {/* Bottom Engine Status */}
        <div className="px-6 py-6 border-t border-[var(--amber-border)] bg-[var(--bg-card)]">
           <div className="text-[9px] font-label text-[var(--text-footer)] uppercase tracking-widest mb-3">
             Engine Status
           </div>
           <div className="flex items-center gap-3">
             <div className="flex flex-col font-display font-medium text-[var(--amber-light)] text-sm leading-tight">
               <span>SYNAPSE</span>
               <span>ONLINE</span>
             </div>
             <div className="w-1.5 h-3 bg-primary rounded-full shadow-[0_0_8px_var(--amber)] ml-auto" />
           </div>
        </div>
      </aside>

      {/* Main Content + Footer */}
      <div className="flex-1 flex flex-col relative min-w-0">
        <main className="flex-1 overflow-auto pb-8 bg-[var(--bg-base)] relative z-10">
          <div className="fixed inset-0 pointer-events-none z-0 opacity-40 bg-grid-pattern mix-blend-screen" />
          {children}
        </main>

        {/* Footer Status Bar */}
        <footer className="absolute bottom-0 left-0 right-0 h-[32px] bg-[var(--bg-card)] border-t border-[rgba(81,69,50,0.05)] flex items-center justify-between px-6 z-30">
          <div className="flex items-center gap-6 text-[9px] font-label uppercase tracking-[1.8px] text-[var(--text-footer)]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#22c55e]"></span>
              </span>
              <span>Server: Amsterdam-01</span>
            </div>
            <span>Latency: 24ms</span>
          </div>
          <div className="flex items-center gap-6 text-[9px] font-label uppercase tracking-[1.8px] text-[var(--text-footer)]">
            <span>ALS STUDIO © 2024</span>
            <span className="text-[rgba(255,183,3,0.6)]">Neural Network Active</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function NavItem({ path, label, icon: Icon, currentPath }: any) {
  const isActive = path === "/" ? currentPath === "/" : currentPath.startsWith(path);

  return (
    <Link href={path} className="block relative group">
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-300 relative z-10",
          isActive
            ? "text-primary font-medium"
            : "text-[var(--text-muted)] hover:text-primary hover:bg-[var(--bg-elevated)]"
        )}
      >
        <Icon className={cn("w-4 h-4", isActive ? "text-primary" : "opacity-70 group-hover:opacity-100 transition-opacity")} />
        <span className="font-sans">{label}</span>
      </div>
      
      {isActive && (
        <motion.div
          layoutId="activeNavIndicator"
          className="absolute inset-0 bg-[var(--bg-panel)] rounded-lg -z-0 border border-[var(--amber-border)]"
          initial={false}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          <div className="absolute inset-y-0 left-0 w-[3px] bg-primary rounded-l-lg shadow-[0_0_10px_var(--amber)]" />
        </motion.div>
      )}
    </Link>
  );
}
