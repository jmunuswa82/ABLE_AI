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

  if (isLoading) return <div className="p-8 font-mono text-muted-foreground uppercase">Compiling Artifacts...</div>;

  const patchPackage = artifacts.find((a: any) => a.type === "patch_package");
  const others = artifacts.filter((a: any) => a.type !== "patch_package");

  return (
    <motion.div 
      className="p-8 max-w-4xl mx-auto w-full space-y-8"
      variants={ANIMATION_VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      <div className="text-center mb-12">
        <h1 className="text-4xl font-display font-bold mb-4">Deployment Ready</h1>
        <p className="text-muted-foreground">Download your completed Ableton Live project and structural manifests.</p>
      </div>

      {patchPackage && (
        <motion.div variants={ANIMATION_VARIANTS.slideUp} className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-primary/20 rounded-3xl blur-xl transition-opacity opacity-50 group-hover:opacity-100" />
          <div className="relative glass-panel rounded-3xl p-8 border-emerald-500/30 flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
            <div className="w-24 h-24 rounded-2xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/40 shrink-0">
              <DownloadCloud className="w-10 h-10 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 justify-center md:justify-start mb-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest font-bold">Verified Build</span>
              </div>
              <h2 className="text-2xl font-display font-bold text-white mb-2">Master Patch Package</h2>
              <p className="text-sm text-muted-foreground mb-4">The complete deployable bundle containing your augmented .als file, automation scripts, and structural manifests.</p>
              <div className="text-[10px] font-mono text-muted-foreground bg-black/40 inline-block px-3 py-1.5 rounded-md">
                {patchPackage.fileName} • {formatBytes(patchPackage.fileSize)}
              </div>
            </div>
            <a
              href={`/api/projects/${id}/artifacts/${patchPackage.id}/download`}
              download={patchPackage.fileName}
              className="shrink-0 px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-bold uppercase tracking-widest text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:-translate-y-1"
            >
              Download
            </a>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        {others.map((art: any) => (
          <motion.a
            key={art.id}
            variants={ANIMATION_VARIANTS.staggerItem}
            href={`/api/projects/${id}/artifacts/${art.id}/download`}
            download={art.fileName}
            className="glass-panel p-6 rounded-2xl flex items-start gap-4 hover:border-primary/50 transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/20 group-hover:text-primary transition-colors">
              {art.type.includes('json') ? <FileJson className="w-5 h-5" /> : 
               art.type.includes('als') ? <Music className="w-5 h-5" /> : <FileCode className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground mb-1 group-hover:text-primary transition-colors">{art.type.replace('_', ' ').toUpperCase()}</h3>
              <p className="text-[11px] text-muted-foreground mb-2 line-clamp-1">{art.fileName}</p>
              <span className="text-[9px] font-mono bg-background/50 px-2 py-1 rounded text-muted-foreground">{formatBytes(art.fileSize)}</span>
            </div>
          </motion.a>
        ))}
      </div>
    </motion.div>
  );
}
