import { useParams } from "wouter";
import { motion } from "framer-motion";
import { DownloadCloud, ShieldCheck, FileJson, FileCode, Music } from "lucide-react";
import { useListProjectArtifacts } from "@workspace/api-client-react";
import { formatBytes } from "@/lib/utils";
import { ANIMATION_VARIANTS } from "@/lib/design";

export default function ExportView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data: artifacts = [], isLoading } = useListProjectArtifacts(id);

  if (isLoading) return <div className="p-8 font-mono text-[var(--text-muted)] uppercase">Compiling Artifacts...</div>;

  const patchPackage = artifacts.find((a: any) => a.type === "patch_package");
  const others = artifacts.filter((a: any) => a.type !== "patch_package");

  return (
    <motion.div 
      className="p-8 max-w-4xl mx-auto w-full space-y-8 mb-12"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      <div className="text-center mb-12 mt-8">
        <h1 className="text-[36px] font-display font-bold mb-4 tracking-[-1.5px] text-white">Deployment Ready</h1>
        <p className="text-[var(--text-secondary)] text-[16px]">Download your completed Ableton Live project and structural manifests.</p>
      </div>

      {patchPackage && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp} className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/5 rounded-3xl blur-2xl transition-opacity opacity-50 group-hover:opacity-100 pointer-events-none" />
          <div className="relative glass-panel rounded-3xl p-8 border-primary/30 flex flex-col md:flex-row items-center gap-8 text-center md:text-left bg-[var(--bg-panel)] shadow-[0_0_30px_rgba(255,183,3,0.1)]">
            <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/30 shrink-0">
              <DownloadCloud className="w-10 h-10 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 justify-center md:justify-start mb-3">
                <ShieldCheck className="w-4 h-4 text-[#22c55e]" />
                <span className="text-[10px] font-label text-[#22c55e] uppercase tracking-widest font-bold">Verified Build</span>
              </div>
              <h2 className="text-2xl font-display font-bold text-white mb-2">Master Patch Package</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">The complete deployable bundle containing your augmented .als file, automation scripts, and structural manifests.</p>
              <div className="text-[11px] font-mono text-[var(--amber-light)] bg-[var(--bg-overlay)] inline-block px-3 py-1.5 rounded border border-[var(--amber-border)]">
                {patchPackage.fileName} • {formatBytes(patchPackage.fileSize)}
              </div>
            </div>
            <a
              href={`/api/projects/${id}/artifacts/${patchPackage.id}/download`}
              download={patchPackage.fileName}
              className="btn-primary shrink-0 px-8 py-4 rounded-xl text-sm"
            >
              Download
            </a>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        {others.map((art: any) => (
          <motion.a
            key={art.id}
            variants={ANIMATION_VARIANTS.staggerItem}
            href={`/api/projects/${id}/artifacts/${art.id}/download`}
            download={art.fileName}
            className="glass-panel p-6 rounded-2xl flex items-start gap-5 hover:border-primary/50 transition-all hover:translate-y-[-2px] group"
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-overlay)] flex items-center justify-center shrink-0 border border-[var(--amber-border)] group-hover:bg-primary/10 group-hover:border-primary/30 transition-colors">
              {art.type.includes('json') ? <FileJson className="w-5 h-5 text-[var(--text-secondary)] group-hover:text-primary" /> : 
               art.type.includes('als') ? <Music className="w-5 h-5 text-[var(--text-secondary)] group-hover:text-primary" /> : <FileCode className="w-5 h-5 text-[var(--text-secondary)] group-hover:text-primary" />}
            </div>
            <div>
              <h3 className="text-[13px] font-label font-bold text-white mb-1.5 uppercase tracking-wide group-hover:text-primary transition-colors">{art.type.replace('_', ' ')}</h3>
              <p className="text-[12px] font-sans text-[var(--text-muted)] mb-3 line-clamp-1">{art.fileName}</p>
              <span className="text-[10px] font-mono bg-[var(--bg-card)] px-2.5 py-1 rounded text-[var(--text-code)] border border-[var(--amber-border)]">{formatBytes(art.fileSize)}</span>
            </div>
          </motion.a>
        ))}
      </div>
    </motion.div>
  );
}
