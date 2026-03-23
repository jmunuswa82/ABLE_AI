import { Link, useLocation } from "wouter";
import { ReactNode, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { LayoutDashboard, FileArchive, Activity, GitCommitHorizontal, Layers, Hexagon, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile, useIsTablet } from "@/hooks/use-mobile";

const NAV_ITEMS = [
  { path: "/", label: "Hub", icon: LayoutDashboard },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const collapseSidebar = isMobile || isTablet;

  const sidebarContent = (
    <>
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
          {collapseSidebar && (
            <button
              onClick={() => setDrawerOpen(false)}
              className="ml-auto w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-3">
          <span className="text-[9px] font-label text-[var(--text-footer)] uppercase tracking-widest">Core</span>
        </div>
        
        <LayoutGroup>
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.path} {...item} currentPath={location} onClick={() => collapseSidebar && setDrawerOpen(false)} />
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
                    <NavItem key={item.path} {...item} currentPath={location} onClick={() => collapseSidebar && setDrawerOpen(false)} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </nav>

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
    </>
  );

  return (
    <div className="flex h-screen bg-[var(--bg-base)] text-[var(--text-primary)] overflow-hidden selection:bg-primary/30">
      
      {collapseSidebar ? (
        <>
          <AnimatePresence>
            {drawerOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/60 z-40"
                  onClick={() => setDrawerOpen(false)}
                />
                <motion.aside
                  initial={{ x: -264 }}
                  animate={{ x: 0 }}
                  exit={{ x: -264 }}
                  transition={{ type: "spring", damping: 30, stiffness: 300 }}
                  className="fixed left-0 top-0 bottom-0 w-64 bg-[var(--bg-card)] border-r border-[var(--amber-border-strong)] flex flex-col z-50 shadow-2xl"
                >
                  {sidebarContent}
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </>
      ) : (
        <aside className="w-64 shrink-0 bg-[var(--bg-card)] border-r border-[var(--amber-border-strong)] flex flex-col z-20 shadow-2xl">
          {sidebarContent}
        </aside>
      )}

      <div className="flex-1 flex flex-col relative min-w-0">
        {collapseSidebar && (
          <header className="h-12 shrink-0 bg-[var(--bg-card)] border-b border-[var(--amber-border-strong)] flex items-center px-4 gap-3 z-30">
            <button
              onClick={() => setDrawerOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-white transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Hexagon className="w-4 h-4 text-primary" />
              <span className="text-[9px] font-label text-[var(--text-footer)] uppercase tracking-widest font-semibold">ALS STUDIO</span>
            </div>
          </header>
        )}

        <main className="flex-1 overflow-auto pb-8 bg-[var(--bg-base)] relative z-10">
          <div className="fixed inset-0 pointer-events-none z-0 opacity-40 bg-grid-pattern mix-blend-screen" />
          {children}
        </main>

        <footer className={cn(
          "absolute bottom-0 left-0 right-0 h-[32px] bg-[var(--bg-card)] border-t border-[rgba(81,69,50,0.05)] flex items-center justify-between px-6 z-30",
          isMobile && "hidden"
        )}>
          <div className="flex items-center gap-6 text-[9px] font-label uppercase tracking-[1.8px] text-[var(--text-footer)]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22c55e]"></span>
              </span>
              Server: Amsterdam-01
            </div>
            <div>Latency: 24ms</div>
          </div>
          <div className="text-[9px] font-label uppercase tracking-[1.8px] text-[var(--text-footer)] flex items-center gap-6">
            <span>ALS Studio © 2024</span>
            <span className="text-primary font-bold">Neural Network Active</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function NavItem({
  path,
  label,
  icon: Icon,
  currentPath,
  onClick,
}: {
  path: string;
  label: string;
  icon: React.ElementType;
  currentPath: string;
  onClick?: () => void;
}) {
  const isActive = currentPath === path;
  return (
    <Link href={path} onClick={onClick}>
      <motion.div
        layout
        className={cn(
          "group relative flex items-center gap-3 px-3 min-h-[44px] rounded-lg cursor-pointer transition-colors",
          isActive
            ? "text-primary"
            : "text-[var(--text-muted)] hover:text-white"
        )}
      >
        {isActive && (
          <motion.div
            layoutId="nav-active"
            className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/20"
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          />
        )}
        <Icon className="w-4 h-4 relative z-10 shrink-0" />
        <span className="text-[13px] font-medium tracking-wide relative z-10">{label}</span>
      </motion.div>
    </Link>
  );
}
