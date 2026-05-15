import React from 'react';
import { AppraisalResult, VisualHotspot } from '../../types';
import { ChevronRight, X } from 'lucide-react';

import { HotspotTooltip } from './HotspotTooltip';

interface HotspotCanvasProps {
  currentResult: AppraisalResult;
  displayImage: string;
  activeEvidenceImage: string;
  viewMode: string;
  scrollY: number;
  activeHotspot: VisualHotspot | null;
  discoveredHotspots: Set<number>;
  activeRepairVector: number | null;
  setActiveEvidenceImage: (img: string) => void;
  setActiveHotspot: (spot: VisualHotspot | null) => void;
  toggleHotspot: (idx: number, spot: VisualHotspot) => void;
  setActiveRepairVector: (idx: number | null) => void;
  handleChat: (text: string) => void;
  soundManager: any;
}

export const HotspotCanvas: React.FC<HotspotCanvasProps> = ({
  currentResult,
  displayImage,
  activeEvidenceImage,
  viewMode,
  scrollY,
  activeHotspot,
  discoveredHotspots,
  activeRepairVector,
  setActiveEvidenceImage,
  setActiveHotspot,
  toggleHotspot,
  setActiveRepairVector,
  handleChat,
  soundManager
}) => {
  return (
    <div className={`relative w-full transition-all duration-700 ease-[cubic-bezier(0.87,0,0.13,1)] overflow-hidden ${viewMode === 'DETAILS' || viewMode === 'TOOLS' || viewMode === 'PROVENANCE' || viewMode === 'RESTORE' || viewMode === 'FINANCIAL' ? 'h-[35vh] opacity-40 grayscale' : 'h-full opacity-100'}`}>
        <img 
        src={viewMode === 'EXPLORE' || viewMode === 'RESTORE' ? activeEvidenceImage : displayImage} 
        className={`w-full h-[120%] -top-[10%] absolute object-cover transition-all duration-700 pointer-events-auto ${viewMode === 'RESTORE' ? 'contrast-125 brightness-75 grayscale sepia-[.3]' : ''}`} 
        style={{ transform: `translateY(${scrollY * 0.4}px)` }}
        onClick={() => { if (activeHotspot) { soundManager.playClick(); setActiveHotspot(null); } }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent pointer-events-none"></div>
        
        {/* Restoration AR Overlay */}
        {viewMode === 'RESTORE' && (
            <div className="absolute inset-0 z-20 mix-blend-screen">
                <svg className="w-full h-full pointer-events-none" style={{ filter: 'drop-shadow(0 0 8px rgba(249,115,22,0.6))' }}>
                    {currentResult.visualHotspots?.map((spot, idx) => (
                        <g key={`ar-${idx}`}>
                            {/* Clean Bounding Box */}
                            <rect 
                                x={`${spot.x - 6}%`} 
                                y={`${spot.y - 6}%`} 
                                width="12%" 
                                height="12%" 
                                fill={activeRepairVector === idx ? "rgba(239,68,68,0.1)" : "transparent"} 
                                stroke={activeRepairVector === idx ? "#ef4444" : "#f97316"} 
                                strokeWidth={activeRepairVector === idx ? "1.5" : "0.5"} 
                                strokeDasharray={activeRepairVector === idx ? "none" : "2 2"}
                                rx="4"
                            />
                            {/* Target Center */}
                            <circle cx={`${spot.x}%`} cy={`${spot.y}%`} r="3" fill={activeRepairVector === idx ? "#ef4444" : "#f97316"} className="animate-pulse" />
                            {/* Repair Vector Line */}
                            <line 
                                x1={`${spot.x}%`} 
                                y1={`${spot.y}%`} 
                                x2={`${spot.x + 8}%`} 
                                y2={`${spot.y - 8}%`} 
                                stroke={activeRepairVector === idx ? "#ef4444" : "#f97316"} 
                                strokeWidth="1" 
                            />
                            {/* Data Label */}
                            <text 
                                x={`${spot.x + 9}%`} 
                                y={`${spot.y - 9}%`} 
                                fill={activeRepairVector === idx ? "#ef4444" : "#f97316"} 
                                fontSize="10" 
                                fontFamily="monospace" 
                                fontWeight="bold"
                                className="uppercase"
                                style={{ textShadow: '0px 1px 2px rgba(0,0,0,0.8)' }}
                            >
                                {idx + 1}
                            </text>
                        </g>
                    ))}
                </svg>
                
                {/* Interactive Buttons */}
                {currentResult.visualHotspots?.map((spot, idx) => (
                    <button 
                        key={`btn-${idx}`}
                        className="absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2 z-30"
                        style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                        onClick={(e) => { e.stopPropagation(); setActiveRepairVector(idx === activeRepairVector ? null : idx); soundManager.playClick(); }}
                    >
                        <div className={`w-full h-full rounded-full border-2 transition-all ${activeRepairVector === idx ? 'border-red-500 scale-110 bg-red-500/20' : 'border-transparent hover:border-orange-500/50'}`}></div>
                    </button>
                ))}

                {/* AR Scanning Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(249,115,22,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(249,115,22,0.05)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_70%)] pointer-events-none"></div>
            </div>
        )}

        {/* Evidence Thumbnails */}
        {viewMode === 'EXPLORE' && currentResult.images && currentResult.images.length > 1 && (
            <div className="absolute top-20 left-0 right-0 flex justify-center gap-3 z-40 pointer-events-auto px-6 overflow-x-auto pt-4">
                {currentResult.images.map((img, idx) => (
                    <button key={idx} onClick={(e) => { e.stopPropagation(); setActiveEvidenceImage(img); }} className={`w-12 h-12 rounded-lg overflow-hidden transition-all border-2 shrink-0 ${activeEvidenceImage === img ? 'border-white scale-110 shadow-lg' : 'border-white/20 opacity-60'}`}>
                        <img src={img} className="w-full h-full object-cover" />
                    </button>
                ))}
            </div>
        )}

        {/* Hotspots */}
        {viewMode === 'EXPLORE' && currentResult.visualHotspots?.map((spot, idx) => (
            <button 
            key={idx} 
            className="absolute w-14 h-14 flex items-center justify-center z-30 group" 
            style={{ top: `${spot.y}%`, left: `${spot.x}%`, transform: 'translate(-50%, -50%)' }} 
            onClick={(e) => { 
                e.stopPropagation(); 
                toggleHotspot(idx, spot);
            }}
            >
                {/* ID Label (Tactical) */}
                <div className={`absolute -top-6 left-1/2 -translate-x-1/2 text-[7px] font-mono tracking-tighter transition-all duration-500 ${activeHotspot === spot ? 'text-white opacity-100' : 'text-zinc-500 opacity-0 group-hover:opacity-100'}`}>
                    VEC_0{idx + 1}
                </div>

                {/* Outer Pulsing Radar Rings */}
                {!discoveredHotspots.has(idx) && (
                <div className="absolute inset-0 rounded-full border border-blue-500 animate-pulse opacity-40"></div>
                )}
                <div className={`absolute inset-0 rounded-full border border-white/20 animate-ping opacity-10 duration-[2000ms] ${activeHotspot === spot ? 'hidden' : ''}`}></div>
                <div className={`absolute inset-2 rounded-full border border-white/30 animate-ping opacity-10 duration-[3000ms] ${activeHotspot === spot ? 'hidden' : ''}`}></div>
                
                {/* Target Indicator */}
                <div className={`relative flex items-center justify-center transition-all duration-500 ${activeHotspot === spot ? 'scale-125 shadow-[0_0_20px_white]' : 'hover:scale-110'}`}>
                    {/* Crosshair Brackets - corners */}
                    <div className={`absolute -inset-2 border-t border-l border-white/40 w-2 h-2 rounded-tl-sm transition-all duration-300 ${activeHotspot === spot ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>
                    <div className={`absolute -bottom-2 -right-2 border-b border-r border-white/40 w-2 h-2 rounded-br-sm transition-all duration-300 ${activeHotspot === spot ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}></div>
                    
                    {/* Core Point */}
                    <div className={`w-3 h-3 rounded-full border-2 transition-all duration-500 ${activeHotspot === spot ? 'bg-white border-white scale-125 shadow-[0_0_15px_white]' : discoveredHotspots.has(idx) ? 'bg-zinc-800 border-white/40' : 'bg-blue-500/40 border-white/80 animate-pulse group-hover:bg-white/20'}`}></div>
                </div>

                {/* Connector Line (Vertical drop) */}
                {activeHotspot === spot && (
                <div className="absolute top-1/2 left-1/2 w-[1.5px] h-12 bg-gradient-to-b from-white via-white/40 to-transparent origin-top animate-in grow-y duration-500"></div>
                )}
            </button>
        ))}

        {/* Feature Card (Holographic Pop-up) */}
        <HotspotTooltip 
            activeHotspot={activeHotspot}
            viewMode={viewMode}
            onClose={() => { soundManager.playClick(); setActiveHotspot(null); }}
            onDeepDive={(label) => { 
                soundManager.playClick();
                handleChat(`Tell me more about the ${label} of this item.`); 
                setActiveHotspot(null); 
            }}
        />
    </div>
  );
};
