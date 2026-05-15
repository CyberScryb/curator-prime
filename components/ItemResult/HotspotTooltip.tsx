import React from 'react';
import { VisualHotspot } from '../../types';
import { X, ChevronRight } from 'lucide-react';

interface HotspotTooltipProps {
  activeHotspot: VisualHotspot | null;
  viewMode: string;
  onClose: () => void;
  onDeepDive: (label: string) => void;
}

export const HotspotTooltip: React.FC<HotspotTooltipProps> = ({
  activeHotspot,
  viewMode,
  onClose,
  onDeepDive
}) => {
  // Return null when there is no active hotspot, or if coordinates are missing.
  if (
    !activeHotspot ||
    activeHotspot === null ||
    typeof activeHotspot.x !== 'number' ||
    typeof activeHotspot.y !== 'number' ||
    viewMode !== 'EXPLORE'
  ) {
    return null;
  }

  // Compute tooltip position
  let top = activeHotspot.y + 5;
  let left = activeHotspot.x;

  if (top > 60) top = activeHotspot.y - 35; 
  if (left < 20) left = 20;
  if (left > 80) left = 80;

  return (
    <div 
      className="absolute z-50 pointer-events-none"
      style={{
        top: `${top}%`,
        left: `${left}%`,
        transform: 'translate(-50%, 0)',
        width: '85%',
        maxWidth: '24rem'
      }}
    >
        <div className="bg-zinc-900/90 backdrop-blur-3xl border border-white/10 p-6 rounded-3xl shadow-2xl relative overflow-hidden group pointer-events-auto animate-in zoom-in-95 fade-in duration-300">
            <button 
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-500 hover:text-white transition-all z-20 active:scale-90"
            >
                <X size={16} />
            </button>

            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/10 via-transparent to-transparent opacity-30 pointer-events-none"></div>
            <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent animate-scan"></div>
            
            <div className="absolute top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-blue-500/50 rounded-tl-lg"></div>
            <div className="absolute bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-blue-500/50 rounded-br-lg"></div>

            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-3">
                    <div className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-[9px] font-mono font-bold text-blue-400 tracking-[0.2em] uppercase">
                        {activeHotspot.type || 'ANALYSIS'}
                    </div>
                    <div className="w-1 h-1 rounded-full bg-zinc-700"></div>
                    <div className="text-[9px] font-mono text-zinc-500">LOC: {activeHotspot.x.toFixed(1)}/{activeHotspot.y.toFixed(1)}</div>
                </div>
                
                <h3 className="font-display text-2xl text-white mb-3 tracking-tight italic">{activeHotspot.label}</h3>
                <p className="text-sm text-zinc-300 leading-relaxed font-serif italic mb-6">"{activeHotspot.description}"</p>
                
                <div className="pt-4 border-t border-white/10 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                            {[1,2,3].map(i => <div key={i} className="w-1 h-3 bg-blue-500/40 rounded-sm"></div>)}
                        </div>
                        <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">Metadata</span>
                    </div>
                    <button 
                    onClick={(e) => { e.stopPropagation(); onDeepDive(activeHotspot.label); }}
                    className="text-[10px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1.5 transition-colors"
                    >
                        Deep Dive <ChevronRight size={12} />
                    </button>
                </div>
            </div>
        </div>
    </div>
  );
};
