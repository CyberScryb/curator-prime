import React from 'react';
import { AppraisalResult } from '../../types';
import { Wrench, ImageIcon, Loader2, ArrowLeft, Crosshair, X } from 'lucide-react';

interface RestorationPreviewProps {
  currentResult: AppraisalResult;
  isGeneratingPreview: boolean;
  restorationPreviewImg: string | null;
  activeRepairVector: number | null;
  handleGeneratePreview: () => void;
  setActiveRepairVector: (idx: number | null) => void;
}

export const RestorationPreview: React.FC<RestorationPreviewProps> = ({
  currentResult,
  isGeneratingPreview,
  restorationPreviewImg,
  activeRepairVector,
  handleGeneratePreview,
  setActiveRepairVector
}) => {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col gap-6">
            <div className="flex justify-between items-start border-b border-orange-500/20 pb-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Wrench size={12} className="text-orange-500 animate-pulse" />
                        <span className="text-[10px] font-mono text-orange-500 tracking-[0.3em] uppercase">Tactical_Restoration</span>
                    </div>
                    <h2 className="text-3xl font-display text-white italic">Preservation Lab</h2>
                </div>
                <div className="text-right">
                    <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest mb-1">Est_Cost (USD)</div>
                    <div className="text-xl font-mono text-orange-400 opacity-80">${currentResult.restoration.estimatedCost.toLocaleString()}</div>
                </div>
            </div>

            {/* Restoration Preview Generator */}
            <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-6 relative overflow-hidden group">
                {isGeneratingPreview && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-md z-10 flex flex-col items-center justify-center">
                        <Loader2 size={32} className="text-orange-500 animate-spin mb-3" />
                        <span className="text-[10px] font-mono text-white tracking-[0.2em] uppercase animate-pulse">Running Visual Synthesis...</span>
                    </div>
                )}
                
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <ImageIcon size={16} className="text-orange-500" />
                        <h3 className="text-xs font-bold text-white uppercase tracking-widest">Optimal State Projection</h3>
                    </div>
                    {restorationPreviewImg && (
                        <div className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-mono uppercase tracking-widest rounded">
                            Synthesis_Complete
                        </div>
                    )}
                </div>

                {restorationPreviewImg ? (
                    <div className="rounded-xl overflow-hidden border border-white/10 relative group-hover:border-orange-500/50 transition-colors">
                        <img src={restorationPreviewImg} alt="Restored AI Preview" className="w-full h-auto aspect-square object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 pb-2">
                            <div className="text-[9px] font-mono text-orange-400 capitalize bg-black/50 inline-block px-2 py-1 rounded backdrop-blur">AI Generated "Perfect State" Simulation</div>
                        </div>
                    </div>
                ) : (
                    <div className="border-2 border-dashed border-white/5 rounded-xl p-8 flex flex-col items-center justify-center text-center">
                        <p className="text-[11px] font-mono text-zinc-400 leading-relaxed mb-4">
                            Leverage the Imagen diffusion engine to simulate the artifact in its original, structurally perfect state based on its era and material composition.
                        </p>
                        <button 
                            onClick={handleGeneratePreview}
                            disabled={isGeneratingPreview}
                            className="px-6 py-2.5 bg-orange-500 hover:bg-orange-400 text-black text-[10px] font-bold uppercase tracking-widest rounded-lg flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(249,115,22,0.3)] disabled:opacity-50"
                        >
                            <Wrench size={14} /> Simulate Perfect State
                        </button>
                    </div>
                )}
            </div>

            {/* Main Analysis Card */}
            <div className="bg-zinc-900/40 border-l-4 border-orange-500 p-5 rounded-r-2xl">
                <h3 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-2">Restoration Potential</h3>
                <p className="font-serif text-sm text-zinc-300 leading-relaxed italic">
                    "{currentResult.restoration.restorationPotential}"
                </p>
            </div>

            {/* Interactive AI Recommendations */}
            <div className="grid gap-3">
                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] px-1">AI Recommendation Stream</h3>
                {currentResult.restoration.recommendedActions.map((action, i) => (
                    <div key={i} className="bg-zinc-900/20 border border-white/5 p-4 rounded-xl flex gap-4 items-start group hover:bg-white/5 transition-all">
                        <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0 border border-orange-500/20 text-orange-400 font-mono text-xs">
                            0{i + 1}
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-zinc-200 leading-snug">{action}</p>
                            <div className="mt-2 flex items-center gap-3">
                                <button className="text-[9px] font-bold text-orange-500 hover:text-orange-400 uppercase tracking-widest flex items-center gap-1 transition-all">
                                    Run Synthesis <ArrowLeft size={10} className="rotate-180" />
                                </button>
                                <div className="w-1 h-1 rounded-full bg-zinc-800"></div>
                                <span className="text-[8px] text-zinc-600 font-mono uppercase tracking-tighter">Prob: 0.94</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Active Vector Detail (if selected) */}
            <div className="mt-4">
                <h3 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] px-1 mb-3">Optical Evidence Sync</h3>
                {activeRepairVector !== null && currentResult.visualHotspots ? (
                    <div className="bg-zinc-950 border border-orange-500/40 p-4 rounded-2xl animate-in zoom-in-95 duration-300">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded-sm bg-orange-500 flex items-center justify-center text-[10px] font-bold text-black">
                                    {activeRepairVector + 1}
                                </div>
                                <span className="text-xs font-bold text-white uppercase tracking-wider">{currentResult.visualHotspots[activeRepairVector].label}</span>
                            </div>
                            <button onClick={() => setActiveRepairVector(null)} className="text-zinc-600 hover:text-white transition-colors">
                                <X size={14} />
                            </button>
                        </div>
                        <p className="text-xs text-orange-400/80 font-mono italic leading-relaxed mb-4">
                            {currentResult.visualHotspots[activeRepairVector].description}
                        </p>
                        <div className="flex items-center justify-between pt-3 border-t border-white/5">
                            <span className="text-[9px] font-mono text-zinc-600 uppercase">Status: Analysis_Complete</span>
                            <button className="px-3 py-1 bg-orange-500 text-black text-[9px] font-bold uppercase rounded-md shadow-[0_0_10px_rgba(249,115,22,0.3)] hover:scale-105 active:scale-95 transition-all">
                                Apply_Filter
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="border-2 border-dashed border-white/5 rounded-2xl p-8 flex flex-col items-center justify-center text-zinc-600 gap-3">
                        <Crosshair size={24} className="opacity-40 animate-pulse" />
                        <p className="text-[10px] font-mono uppercase tracking-widest">Awaiting interaction with optical vectors...</p>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};
