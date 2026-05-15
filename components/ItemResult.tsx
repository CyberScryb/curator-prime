
import React, { useState, useEffect, useRef } from 'react';
import { AppraisalResult, VisualHotspot } from '../types';
import { askCurator, generateDynamicPrompts, executeItemTool, generateRestorationPreview } from '../services/geminiService';
import { ArrowLeft, X, Send, Sparkles, Box, Zap, Info, Layers, Crosshair, FileText, Wrench, ShieldCheck, ShieldAlert, Shield, Users, TrendingUp, RefreshCw, MessageSquare, Terminal, Tag, Scroll, Globe, Triangle, Rocket, Share2, Printer, Copy, CheckCircle, Loader2, FlaskConical, History, PenTool, UserSearch, Database, ChevronRight, Lock as LucideLock, Fingerprint, Cpu, Activity, Image as ImageIcon } from 'lucide-react';
import { Button } from './Button';
import { soundManager } from '../services/soundService';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from './Toast';
import { CuratorsInsight } from './CuratorsInsight';
import { HotspotCanvas } from './ItemResult/HotspotCanvas';
import { ValuationPanel } from './ItemResult/ValuationPanel';
import { RestorationPreview } from './ItemResult/RestorationPreview';
import { AskCuratorChat } from './ItemResult/AskCuratorChat';
import { MarketComparables } from './ItemResult/MarketComparables';

interface ItemResultProps {
  result: AppraisalResult;
  imageData: string;
  onBack: () => void;
  onSave: (result: AppraisalResult) => void;
}

const TypewriterText: React.FC<{ text: string; delay?: number }> = ({ text, delay = 0 }) => {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    let i = 0;
    const startTimeout = setTimeout(() => {
        const interval = setInterval(() => {
            setDisplayed(text.substring(0, i));
            i++;
            if (i > text.length) clearInterval(interval);
        }, 10); 
        return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(startTimeout);
  }, [text, delay]);
  return <span>{displayed}<span className="cursor-blink text-blue-500">_</span></span>;
};

type ViewMode = 'EXPLORE' | 'DETAILS' | 'RESTORE' | 'TOOLS' | 'PROVENANCE' | 'FINANCIAL';
type ExportMode = 'NONE' | 'DOSSIER' | 'MARKETPLACE';

export const ItemResult: React.FC<ItemResultProps> = ({ result, imageData, onBack, onSave }) => {
  const [currentResult, setCurrentResult] = useState(result);
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{role:string, text:string}[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  const [activeHotspot, setActiveHotspot] = useState<VisualHotspot | null>(null);
  const [discoveredHotspots, setDiscoveredHotspots] = useState<Set<number>>(new Set());
  const [activeRepairVector, setActiveRepairVector] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('EXPLORE');
  const [exportMode, setExportMode] = useState<ExportMode>('NONE');
  
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [toolOutput, setToolOutput] = useState<string | null>(null);
  const [isToolLoading, setIsToolLoading] = useState(false);

  const [scrollY, setScrollY] = useState(0);

  // Listing Generation State
  const [generatedListing, setGeneratedListing] = useState<{title: string, body: string} | null>(null);

  // Restoration Preview State
  const [restorationPreviewImg, setRestorationPreviewImg] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  const displayImage = currentResult.images && currentResult.images.length > 0 ? currentResult.images[0] : imageData;
  const [activeEvidenceImage, setActiveEvidenceImage] = useState(displayImage);
  const [prompts, setPrompts] = useState<string[]>(result.insightfulPrompts || []);
  const [isCyclingPrompts, setIsCyclingPrompts] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCurrentResult(result); }, [result]);
  useEffect(() => { soundManager.playLock(currentResult.rarityScore > 7 ? 'high' : 'standard'); }, []);

  const handleGeneratePreview = async () => {
      soundManager.playClick();
      triggerHaptic('transition');
      setIsGeneratingPreview(true);
      try {
          const preview = await generateRestorationPreview(currentResult);
          if (preview) {
              setRestorationPreviewImg(preview);
              setCurrentResult(prev => ({
                  ...prev,
                  restoration: {
                      ...prev.restoration,
                      simulationImage: preview
                  }
              }));
              soundManager.playLock('high');
              toast.success("Optimal State Synthesized");
          } else {
              toast.error("Generation Failed");
          }
      } catch (e: any) {
          toast.error(e.message || "Generation Error");
      }
      setIsGeneratingPreview(false);
  };

  const triggerHaptic = (pattern: 'click'|'transition') => {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(pattern === 'click' ? 20 : [30, 50, 30]);
      }
  };

  const toggleHotspot = (idx: number, spot: VisualHotspot) => {
    soundManager.playClick();
    triggerHaptic('click');
    if (activeHotspot === spot) {
        setActiveHotspot(null);
    } else {
        setActiveHotspot(spot);
        if (!discoveredHotspots.has(idx)) {
            const newDiscovered = new Set(discoveredHotspots);
            newDiscovered.add(idx);
            setDiscoveredHotspots(newDiscovered);
            soundManager.playLock('standard');
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([100, 50, 100]);
            toast.info(`Optical Link Established: VEC_0${idx + 1}`);
        }
    }
  };

  const handleChat = async (text?: string) => {
    const q = text || chatInput;
    if (!q) return;
    setChatInput("");
    if (!showChat) setShowChat(true);
    soundManager.playClick();
    triggerHaptic('transition');
    setChatHistory(prev => [...prev, { role: 'user', text: q }]);
    setIsChatLoading(true);
    try {
        const ans = await askCurator(currentResult, q);
        setChatHistory(prev => [...prev, { role: 'model', text: ans }]);
    } catch {
        setChatHistory(prev => [...prev, { role: 'model', text: "Signal Lost." }]);
    }
    setIsChatLoading(false);
    soundManager.playLock();
  };

  const executeTool = async (toolId: string, customPrompt?: string) => {
      setActiveTool(toolId);
      setToolOutput(null);
      setIsToolLoading(true);
      soundManager.playClick();
      triggerHaptic('click');
      try {
          const output = await executeItemTool(currentResult, customPrompt || toolId);
          setToolOutput(output);
          soundManager.playLock();
      } catch (e) {
          setToolOutput("Module Offline.");
      } finally { setIsToolLoading(false); }
  };

  const cyclePrompts = async () => {
      soundManager.playClick();
      triggerHaptic('click');
      setIsCyclingPrompts(true);
      try {
          const newPrompts = await generateDynamicPrompts(currentResult);
          setPrompts(newPrompts);
      } catch (e) { setPrompts(["Market Analysis", "Authentication Protocol", "Maintenance"]); }
      setIsCyclingPrompts(false);
  };

  const generateListing = async () => {
      if (generatedListing) return;
      setIsToolLoading(true);
      try {
          const title = await executeItemTool(currentResult, 'LISTING_TITLE_ONLY');
          const body = await executeItemTool(currentResult, 'LISTING_DESCRIPTION_ONLY');
          setGeneratedListing({ title, body });
      } catch(e) { toast.error("Generation Failed"); }
      setIsToolLoading(false);
  };

  const handlePrint = () => {
      soundManager.playClick();
      const content = printRef.current;
      if (content) {
          const printWindow = window.open('', '', 'height=900,width=800');
          if (printWindow) {
              printWindow.document.write('<html><head><title>Asset Dossier</title>');
              printWindow.document.write('<script src="https://cdn.tailwindcss.com"></script>'); 
              printWindow.document.write('</head><body class="bg-white text-black p-8 font-serif">');
              printWindow.document.write(content.innerHTML);
              printWindow.document.write('</body></html>');
              printWindow.document.close();
              printWindow.print();
          }
      }
  };

  const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text);
      soundManager.playLock();
      toast.success("Copied to Clipboard");
  };

  const getTrustBadge = (tier: string) => {
      if (tier.includes('Level 3')) return { icon: ShieldCheck, color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
      if (tier.includes('Level 2')) return { icon: Shield, color: 'text-blue-500', bg: 'bg-blue-500/10' };
      return { icon: ShieldAlert, color: 'text-amber-500', bg: 'bg-amber-500/10' };
  };

  const TrustBadge = getTrustBadge(currentResult.provenance.trustTier);

  // Valuation Visuals
  const confidencePercent = Math.round(currentResult.confidence * 100);
  const confColor = confidencePercent >= 90 ? 'text-emerald-400' : confidencePercent >= 75 ? 'text-blue-400' : 'text-amber-400';
  const confBg = confidencePercent >= 90 ? 'bg-emerald-400' : confidencePercent >= 75 ? 'bg-blue-400' : 'bg-amber-400';
  
  const valRange = currentResult.valuation.high - currentResult.valuation.low;
  const midPercent = valRange > 0 
    ? Math.max(10, Math.min(90, ((currentResult.valuation.mid - currentResult.valuation.low) / valRange) * 100))
    : 50;

  return (
    <div className="h-full bg-black text-white font-sans overflow-hidden relative flex flex-col">
      
      {/* 1. TOP NAV */}
      <div className="absolute top-0 left-0 right-0 z-50 flex justify-between items-start p-4 pt-[calc(20px+env(safe-area-inset-top))] pointer-events-none">
        <button onClick={() => { soundManager.playClick(); onBack(); }} className="pointer-events-auto p-3 rounded-full bg-black/20 backdrop-blur-md border border-white/10 hover:bg-white hover:text-black transition-colors">
            <ArrowLeft size={18} />
        </button>
        
         <div className="flex gap-4 pointer-events-auto bg-black/40 backdrop-blur-3xl p-1.5 border border-white/5 rounded-full shadow-2xl relative">
             <button onClick={() => { soundManager.playClick(); setViewMode('EXPLORE'); triggerHaptic('click'); }} className={`relative z-10 px-4 py-1.5 text-[9px] font-bold tracking-[0.2em] uppercase rounded-full transition-all duration-300 ${viewMode === 'EXPLORE' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                 Optic
             </button>
             <button onClick={() => { soundManager.playClick(); setViewMode('RESTORE'); triggerHaptic('click'); }} className={`relative z-10 px-4 py-1.5 text-[9px] font-bold tracking-[0.2em] uppercase rounded-full transition-all duration-300 ${viewMode === 'RESTORE' ? 'bg-orange-500 text-black shadow-[0_0_15px_rgba(249,115,22,0.5)]' : 'text-zinc-500 hover:text-zinc-300'}`}>
                 Restore
             </button>
             <button onClick={() => { soundManager.playClick(); setViewMode('PROVENANCE'); triggerHaptic('click'); }} className={`relative z-10 px-4 py-1.5 text-[9px] font-bold tracking-[0.2em] uppercase rounded-full transition-all duration-300 ${viewMode === 'PROVENANCE' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                 Origin
             </button>
             <button onClick={() => { soundManager.playClick(); setViewMode('DETAILS'); triggerHaptic('click'); }} className={`relative z-10 px-4 py-1.5 text-[9px] font-bold tracking-[0.2em] uppercase rounded-full transition-all duration-300 ${viewMode === 'DETAILS' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                 Data
             </button>
             <button onClick={() => { soundManager.playClick(); setViewMode('FINANCIAL'); triggerHaptic('click'); }} className={`relative z-10 px-4 py-1.5 text-[9px] font-bold tracking-[0.2em] uppercase rounded-full transition-all duration-300 ${viewMode === 'FINANCIAL' ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-300'}`}>
                 Fiscal
             </button>
             <button onClick={() => { soundManager.playClick(); setViewMode('TOOLS'); triggerHaptic('click'); }} className={`relative z-10 px-4 py-1.5 text-[9px] font-bold tracking-[0.2em] uppercase rounded-full transition-all duration-300 ${viewMode === 'TOOLS' ? 'bg-blue-500 text-black shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'text-zinc-500 hover:text-zinc-300'}`}>
                 Tools
             </button>
        </div>

        <button onClick={() => { soundManager.playClick(); setShowChat(true); }} className="pointer-events-auto p-3 rounded-full bg-blue-500/10 border border-blue-500/50 text-blue-400 hover:bg-blue-500 hover:text-white transition-all backdrop-blur-md">
             <Zap size={18} />
        </button>
      </div>

      <HotspotCanvas 
          currentResult={currentResult}
          displayImage={displayImage}
          activeEvidenceImage={activeEvidenceImage}
          viewMode={viewMode}
          scrollY={scrollY}
          activeHotspot={activeHotspot}
          discoveredHotspots={discoveredHotspots}
          activeRepairVector={activeRepairVector}
          setActiveEvidenceImage={setActiveEvidenceImage}
          setActiveHotspot={setActiveHotspot}
          toggleHotspot={toggleHotspot}
          setActiveRepairVector={setActiveRepairVector}
          handleChat={handleChat}
          soundManager={soundManager}
      />
          {/* Hero Title or Restoration Details */}
          <div className={`absolute bottom-0 left-0 right-0 p-6 transition-all duration-500 ${viewMode === 'DETAILS' || viewMode === 'TOOLS' || viewMode === 'PROVENANCE' || viewMode === 'RESTORE' || viewMode === 'FINANCIAL' ? 'translate-y-4 opacity-0' : 'translate-y-0 opacity-100'} z-30 pointer-events-none bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-32`}>
              
              {/* Inspection Progress (Explore Only) */}
              {viewMode === 'EXPLORE' && (
                  <div className="mb-4 flex items-center gap-4 animate-in slide-in-from-left duration-700">
                      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <div 
                            className="h-full bg-blue-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                            style={{ width: `${(discoveredHotspots.size / (currentResult.visualHotspots?.length || 1)) * 100}%` }}
                          />
                      </div>
                      <div className="flex flex-col items-end">
                          <span className="text-[8px] font-mono text-zinc-500 tracking-[0.2em] uppercase">Tactical_Scan</span>
                          <span className="text-[10px] font-mono text-white font-bold">{discoveredHotspots.size}/{currentResult.visualHotspots?.length} FOUND</span>
                      </div>
                  </div>
              )}

              {viewMode === 'RESTORE' ? (
                  <div className="bg-black/90 backdrop-blur-md border border-orange-500/30 p-5 rounded-xl pointer-events-auto shadow-2xl">
                      <div className="flex items-center gap-2 text-orange-500 mb-2">
                          <Wrench size={16} />
                          <span className="text-[10px] font-bold uppercase tracking-widest">Restoration Protocol</span>
                      </div>
                      {activeRepairVector !== null && currentResult.visualHotspots ? (
                          <div className="animate-in fade-in slide-in-from-bottom-2">
                              <h4 className="text-red-400 font-bold text-sm uppercase tracking-widest mb-1">REP_VEC_{activeRepairVector + 1}: {currentResult.visualHotspots[activeRepairVector].label}</h4>
                              <p className="font-mono text-xs text-orange-400/80 leading-relaxed">
                                  {currentResult.visualHotspots[activeRepairVector].description}
                              </p>
                          </div>
                      ) : (
                          <p className="font-mono text-xs text-orange-400/80 leading-relaxed">
                              {currentResult.restoration.restorationPotential}
                              <br/><br/>
                              <span className="text-orange-500/50 animate-pulse">Select a repair vector to view specific protocols...</span>
                          </p>
                      )}
                  </div>
              ) : (
                  <div className="pointer-events-auto">
                      <div className="flex justify-between items-end mb-3">
                           <div className="inline-block px-2 py-1 bg-white/10 backdrop-blur border border-white/20 rounded-md text-[9px] font-bold uppercase tracking-widest">
                              {currentResult.classification}
                           </div>
                           {/* Trust Tier Badge (Visual Mode) */}
                           <div className={`flex items-center gap-2 backdrop-blur px-3 py-1.5 rounded-full border ${TrustBadge.bg} border-current ${TrustBadge.color}`}>
                               <TrustBadge.icon size={14} />
                               <span className="text-[9px] font-bold uppercase tracking-widest">{currentResult.provenance.trustTier.split('(')[1].replace(')','')}</span>
                           </div>
                      </div>
                      
                      <h1 className="font-display text-4xl md:text-5xl text-white leading-none mb-2">{currentResult.itemName}</h1>
                      <div className="flex gap-3 text-xs font-mono text-zinc-400">
                          <span>{currentResult.era}</span>
                          <span className="text-zinc-600">|</span>
                          <span>{currentResult.origin}</span>
                      </div>
                  </div>
              )}
          </div>

      {/* 3. DATA LAYER (BENTO GRID & TOOLS) */}
      <div className={`flex-1 min-h-0 bg-black relative transition-all duration-700 border-t border-white/10 ${(viewMode === 'DETAILS' || viewMode === 'TOOLS' || viewMode === 'PROVENANCE' || viewMode === 'RESTORE' || viewMode === 'FINANCIAL') ? 'translate-y-0' : 'translate-y-full'}`}>
          <div 
            className="h-full overflow-y-auto p-6 pb-32"
            onScroll={(e) => setScrollY(e.currentTarget.scrollTop)}
          >
              
              {viewMode === 'FINANCIAL' && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex flex-col gap-6">
                           <div className="flex justify-between items-start border-b border-blue-500/20 pb-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <TrendingUp size={12} className="text-emerald-500" />
                                        <span className="text-[10px] font-mono text-emerald-500 tracking-[0.3em] uppercase">Market_Forecast</span>
                                    </div>
                                    <h2 className="text-3xl font-display text-white">Financial Outlook</h2>
                                </div>
                                <div className="text-right">
                                    <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest mb-1">Liquidity_Score</div>
                                    <div className={`text-xl font-mono ${currentResult.forecast.liquidityScore > 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {currentResult.forecast.liquidityScore}/100
                                    </div>
                                </div>
                           </div>

                           {/* Market Metrics Grid */}
                           <div className="grid grid-cols-2 gap-3">
                                <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                                    <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest mb-2">Market_Sentiment</div>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${currentResult.forecast.marketSentiment === 'Bullish' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 'bg-amber-500'}`}></div>
                                        <div className="text-sm font-bold uppercase tracking-widest">{currentResult.forecast.marketSentiment}</div>
                                    </div>
                                </div>
                                <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                                    <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest mb-2">Invertment_Grade</div>
                                    <div className="text-sm font-bold text-white uppercase tracking-[0.2em]">{currentResult.forecast.investmentGrade}</div>
                                </div>
                           </div>

                           <ValuationPanel currentResult={currentResult} onUpdate={setCurrentResult} />
                           
                           <MarketComparables currentResult={currentResult} />

                           {/* Action Modules */}
                           <div className="space-y-3">
                                <div className="p-4 bg-gradient-to-r from-blue-500/10 to-transparent border border-blue-500/20 rounded-2xl flex items-center justify-between">
                                    <div className="flex gap-3 items-center">
                                        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                                            <Rocket size={20} />
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-white">Investment Advisory</div>
                                            <div className="text-[9px] text-blue-400/70 font-mono uppercase">Optimized Exit Strategy Ready</div>
                                        </div>
                                    </div>
                                    <button className="px-4 py-2 bg-blue-500 text-black text-[9px] font-bold uppercase rounded-lg hover:bg-blue-400 transition-colors">
                                        Consult AI
                                    </button>
                                </div>
                           </div>
                      </div>
                  </div>
              )}

              {viewMode === 'RESTORE' && (
                  <RestorationPreview
                      currentResult={currentResult}
                      isGeneratingPreview={isGeneratingPreview}
                      restorationPreviewImg={restorationPreviewImg}
                      activeRepairVector={activeRepairVector}
                      handleGeneratePreview={handleGeneratePreview}
                      setActiveRepairVector={setActiveRepairVector}
                  />
              )}

              {viewMode === 'PROVENANCE' && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex flex-col gap-6">
                          {/* Registry Header */}
                          <div className="flex justify-between items-start">
                              <div>
                                  <div className="text-[10px] font-mono text-zinc-500 tracking-[0.3em] uppercase mb-1">Decentralized_Ledger</div>
                                  <h2 className="text-3xl font-display text-white">Digital Provenance</h2>
                              </div>
                              <div className={`px-3 py-1.5 rounded-full border ${currentResult.provenance.chainStatus === 'Minted' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'} flex items-center gap-2`}>
                                  <div className={`w-1.5 h-1.5 rounded-full ${currentResult.provenance.chainStatus === 'Minted' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></div>
                                  <span className="text-[10px] font-bold uppercase tracking-widest">{currentResult.provenance.chainStatus}</span>
                              </div>
                          </div>

                          {/* Authenticity Assessment Block */}
                          <div className="bg-zinc-900/40 border border-white/10 rounded-2xl p-6 relative group overflow-hidden">
                              <div className="flex justify-between items-start mb-4">
                                  <div className="flex items-center gap-2">
                                      <ShieldCheck size={16} className="text-emerald-500" />
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Authenticity_Assessment</span>
                                  </div>
                                  <div className="text-right">
                                      <div className={`text-2xl font-display ${currentResult.authenticityScore >= 80 ? 'text-emerald-400' : currentResult.authenticityScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                          {currentResult.authenticityScore ?? currentResult.confidence ?? 0}%
                                      </div>
                                      <div className="text-[8px] font-mono uppercase text-zinc-500">Confidence_Score</div>
                                  </div>
                              </div>
                              <div className="font-serif text-sm leading-relaxed text-zinc-300">
                                  {currentResult.authenticityAssessment || "Analysis complete. Authenticity validated against visual vectors and known historical markers."}
                              </div>
                          </div>

                          {/* Genesis Hash Module */}
                          <div className="bg-zinc-900/40 border border-white/10 rounded-2xl p-6 relative group overflow-hidden">
                              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                                  <Cpu size={48} />
                              </div>
                              <div className="flex items-center gap-2 mb-4">
                                  <Fingerprint size={16} className="text-blue-500" />
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Genesis_Hash</span>
                              </div>
                              <div className="bg-black/60 border border-white/5 p-4 rounded-xl font-mono text-sm break-all text-blue-100 shadow-inner">
                                  {currentResult.provenance.digitalHash}
                              </div>
                              <div className="mt-4 flex justify-between items-center text-[10px] font-mono text-zinc-500">
                                  <span>BLOCK_HEIGHT: 18,294,012</span>
                                  <span>TS: {new Date().toLocaleDateString()}</span>
                              </div>
                          </div>

                          {/* Integrity Grid */}
                          <div className="grid grid-cols-2 gap-3">
                              <div className="bg-zinc-900/20 border border-white/5 p-5 rounded-2xl">
                                  <div className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-3">Trust_Tier</div>
                                  <div className="flex items-center gap-3">
                                      <div className={`p-2 rounded-lg ${TrustBadge.bg}`}>
                                          <TrustBadge.icon size={18} className={TrustBadge.color} />
                                      </div>
                                      <div className="text-sm font-bold text-white">{currentResult.provenance.trustTier.split(' ')[2]}</div>
                                  </div>
                              </div>
                              <div className="bg-zinc-900/20 border border-white/5 p-5 rounded-2xl">
                                  <div className="text-[9px] font-bold uppercase text-zinc-500 tracking-widest mb-3">Immutability</div>
                                  <div className="flex items-center gap-3">
                                      <div className="p-2 rounded-lg bg-blue-500/10">
                                          <LucideLock size={18} className="text-blue-400" />
                                      </div>
                                      <div className="text-sm font-bold text-white">LOCKED</div>
                                  </div>
                              </div>
                          </div>

                          {/* Historical Chain */}
                          <div className="border border-white/10 rounded-2xl p-6">
                              <h3 className="text-[10px] font-bold uppercase text-zinc-600 tracking-widest mb-6 flex items-center gap-2">
                                  <Activity size={12} /> Registry_History
                              </h3>
                              <div className="space-y-6 relative">
                                  {/* Line */}
                                  <div className="absolute left-1.5 top-2 bottom-2 w-px bg-white/10"></div>
                                  
                                  <div className="relative pl-7 group">
                                      <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                                      <div className="text-[10px] font-mono text-zinc-500 mb-1">2026-04-17T15:05:47Z</div>
                                      <div className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">Forensic Scan & Hash Generation</div>
                                      <div className="text-[10px] text-zinc-600 mt-1 uppercase">Node: US-WEST_SCRYB_09</div>
                                  </div>

                                  <div className="relative pl-7 group opacity-50">
                                      <div className="absolute left-0 top-1.5 w-3 h-3 rounded-full bg-zinc-800"></div>
                                      <div className="text-[10px] font-mono text-zinc-500 mb-1">PENDING_CONFIRMATION</div>
                                      <div className="text-xs font-bold text-zinc-400 group-hover:text-white transition-colors">Distributed Validation Network</div>
                                      <div className="text-[10px] text-zinc-700 mt-1 uppercase">Awaiting Consensus...</div>
                                  </div>
                              </div>
                          </div>

                          {/* Action Link */}
                          <div className="bg-blue-600/10 border border-blue-500/30 p-4 rounded-xl flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className="p-2 rounded bg-blue-500/20">
                                      <Globe size={18} className="text-blue-400" />
                                  </div>
                                  <div>
                                      <div className="text-xs font-bold text-white">Public Explorer</div>
                                      <div className="text-[9px] text-zinc-500 uppercase tracking-tighter">View_On_Mainnet</div>
                                  </div>
                              </div>
                              <ChevronRight size={16} className="text-zinc-500" />
                          </div>
                      </div>
                  </div>
              )}

              {viewMode === 'DETAILS' && (
                  <>
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6">
                        <div>
                            <h2 className="text-2xl font-display text-white">Asset Dossier</h2>
                            <div className="flex items-center gap-2 mt-1">
                                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${TrustBadge.bg} border-current ${TrustBadge.color}`}>
                                    <TrustBadge.icon size={10} />
                                    <span className="text-[8px] font-bold uppercase tracking-widest leading-none">{currentResult.provenance.trustTier}</span>
                                </div>
                                <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900/80 border border-white/5 ${confColor}`}>
                                    <div className={`w-1 h-1 rounded-full ${confBg} shadow-[0_0_5px_currentColor]`}></div>
                                    <span className="text-[8px] font-bold tracking-wider">{confidencePercent}% CONFIDENCE</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <ValuationPanel currentResult={currentResult} onUpdate={setCurrentResult} />

                    {/* === FORENSIC INSIGHT (LOGIC GATE) === */}
                    <CuratorsInsight result={currentResult} />

                    <div className="grid grid-cols-2 gap-3 mb-3">
                        {/* Rarity Card */}
                        <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                            <div className="flex items-center gap-2 text-amber-500 mb-2">
                                <Sparkles size={14} />
                                <span className="text-[9px] font-bold uppercase tracking-widest">Rarity</span>
                            </div>
                            <div className="text-3xl font-display text-white">{currentResult.rarityScore}<span className="text-sm text-zinc-600">/10</span></div>
                        </div>
                        
                        {/* Condition Card */}
                        <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                            <div className="flex items-center gap-2 text-blue-400 mb-2">
                                <Layers size={14} />
                                <span className="text-[9px] font-bold uppercase tracking-widest">Grade</span>
                            </div>
                            <div className="text-3xl font-display text-white">{currentResult.conditionScore}<span className="text-sm text-zinc-600">/10</span></div>
                        </div>
                    </div>

                    <div className="bg-zinc-900/10 border border-white/5 p-6 rounded-3xl mb-4 backdrop-blur-sm">
                        <h3 className="text-[9px] font-bold uppercase text-zinc-600 tracking-[0.3em] mb-3">Forensic_Analysis</h3>
                        <p className="font-sans text-zinc-400 leading-relaxed text-sm antialiased">{currentResult.historicalContext}</p>
                    </div>

                    {/* Conditional Authentication/Features */}
                    {['Antique', 'Vintage'].includes(currentResult.classification) && currentResult.authenticationMarks && currentResult.authenticationMarks.length > 0 && (
                        <div className="bg-zinc-900/10 border border-white/5 p-6 rounded-3xl mb-4 backdrop-blur-sm">
                            <h3 className="text-[9px] font-bold uppercase text-zinc-600 tracking-[0.3em] mb-3">Authentication_Marks</h3>
                            <ul className="list-none space-y-2">
                                {currentResult.authenticationMarks.map((mark, i) => (
                                    <li key={i} className="flex gap-3 text-sm text-zinc-400">
                                        <ShieldCheck size={16} className="text-blue-500 shrink-0 mt-0.5" />
                                        <span>{mark}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {currentResult.classification === 'Modern' && currentResult.keyFeatures && currentResult.keyFeatures.length > 0 && (
                        <div className="bg-zinc-900/10 border border-white/5 p-6 rounded-3xl mb-4 backdrop-blur-sm">
                            <h3 className="text-[9px] font-bold uppercase text-zinc-600 tracking-[0.3em] mb-3">Key_Features</h3>
                            <ul className="list-none space-y-2">
                                {currentResult.keyFeatures.map((feature, i) => (
                                    <li key={i} className="flex gap-3 text-sm text-zinc-400">
                                        <Sparkles size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Market Intelligence / Selling Points */}
                    <div className="bg-zinc-900/20 border border-white/5 p-5 rounded-2xl mb-3">
                        <div className="flex items-center gap-2 text-pink-400 mb-4">
                            <Rocket size={14} />
                            <span className="text-[9px] font-bold uppercase tracking-widest">Market Intelligence</span>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <h4 className="text-[10px] text-zinc-500 uppercase font-mono mb-2 tracking-widest">Listing_Strategy</h4>
                                <p className="text-xs text-white font-bold tracking-tight">{currentResult.sellingProfile.listingTitle}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                                    <div className="text-[8px] text-zinc-500 uppercase font-mono mb-1">Target_Venue</div>
                                    <div className="text-[10px] text-zinc-200 font-bold">{currentResult.sellingProfile.recommendedVenue}</div>
                                </div>
                                <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                                    <div className="text-[8px] text-zinc-500 uppercase font-mono mb-1">Strategy</div>
                                    <div className="text-[10px] text-zinc-200 font-bold">{currentResult.sellingProfile.pricingStrategy}</div>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-2">
                                {currentResult.sellingProfile.keywords.slice(0, 4).map((kw, i) => (
                                    <div key={i} className="px-2 py-1 bg-zinc-800 rounded text-[9px] font-mono text-zinc-400">#{kw.replace(/\s+/g, '_').toUpperCase()}</div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Professional Syndicate Tools */}
                    <div className="mt-6 mb-6">
                        <div className="flex items-center justify-between mb-3">
                           <h3 className="text-[10px] font-bold uppercase text-zinc-600 tracking-widest">Syndicate Engine</h3>
                           <span className="text-[9px] bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded border border-blue-500/30 font-bold uppercase">Pro</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button 
                              onClick={() => { setExportMode('DOSSIER'); soundManager.playClick(); }}
                              className="p-4 bg-zinc-900/80 border border-white/10 hover:bg-zinc-800 rounded-xl flex flex-col items-center gap-2 group transition-all"
                            >
                                <div className="p-2 rounded-full bg-zinc-800 group-hover:bg-white group-hover:text-black transition-colors">
                                  <FileText size={20} />
                                </div>
                                <span className="text-[10px] font-bold uppercase text-zinc-400 group-hover:text-white">Dealer Dossier</span>
                            </button>

                            <button 
                              onClick={() => { setExportMode('MARKETPLACE'); generateListing(); soundManager.playClick(); }}
                              className="p-4 bg-zinc-900/80 border border-white/10 hover:bg-zinc-800 rounded-xl flex flex-col items-center gap-2 group transition-all"
                            >
                                <div className="p-2 rounded-full bg-zinc-800 group-hover:bg-white group-hover:text-black transition-colors">
                                  <Share2 size={20} />
                                </div>
                                <span className="text-[10px] font-bold uppercase text-zinc-400 group-hover:text-white">Listing Gen</span>
                            </button>
                        </div>
                    </div>
                  </>
              )}

              {viewMode === 'TOOLS' && (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
                          <div>
                              <div className="flex items-center gap-2 mb-1">
                                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                                  <span className="text-[10px] font-mono text-blue-500 tracking-[0.3em] uppercase">System_Active</span>
                              </div>
                              <h2 className="text-2xl font-display text-white italic">AI Synthesis Lab</h2>
                              <p className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase mt-1">Select logic module to initialize sequence</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                              <span className="text-[9px] font-mono text-zinc-600">MT_PROTOCOL_2.8</span>
                              <div className="flex gap-1">
                                  {[1,2,3].map(i => <div key={i} className="w-4 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="w-full h-full bg-blue-500/40 animate-pulse" style={{ animationDelay: `${i*150}ms` }}></div></div>)}
                              </div>
                          </div>
                      </div>

                      {/* Persistent Output Terminal */}
                      <AnimatePresence>
                        {(toolOutput || isToolLoading) && (
                          <motion.div 
                              initial={{ opacity: 0, y: 20, height: 0 }}
                              animate={{ opacity: 1, y: 0, height: "auto" }}
                              exit={{ opacity: 0, y: -20, height: 0 }}
                              className="bg-[#0a0a0c] border border-white/10 rounded-2xl p-6 font-mono text-xs text-zinc-300 mb-8 shadow-2xl relative overflow-hidden group"
                          >
                              {/* Corner Accents */}
                              <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-white/20"></div>
                              <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-white/20"></div>
                              <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-white/20"></div>
                              <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-white/20"></div>

                              <div className="flex items-center justify-between mb-4 text-zinc-500 border-b border-white/5 pb-4">
                                  <div className="flex items-center gap-2">
                                      <Terminal size={14} className="text-emerald-500" />
                                      <span className="text-[9px] uppercase font-bold tracking-[0.2em] text-emerald-400">Console</span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                      {toolOutput && !isToolLoading && (
                                          <button 
                                              onClick={() => copyToClipboard(toolOutput)} 
                                              className="flex items-center gap-1.5 text-[9px] uppercase font-bold text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-all active:scale-95"
                                          >
                                              <Copy size={12} /> Copy_Result
                                          </button>
                                      )}
                                      <div className="text-[8px] bg-zinc-900 border border-white/5 px-2 py-1 rounded text-zinc-600">ID: {currentResult.provenance.digitalHash.substring(0,8)}</div>
                                      <button 
                                          onClick={() => { setToolOutput(null); }}
                                          className="flex items-center justify-center p-1.5 rounded-md hover:bg-white/10 transition-colors text-zinc-500 hover:text-white"
                                      >
                                          <X size={14} />
                                      </button>
                                  </div>
                              </div>

                              <div className="relative min-h-[200px]">
                                  {isToolLoading ? (
                                      <div className="flex flex-col items-center justify-center gap-4 py-8 h-full">
                                          <div className="relative w-12 h-12">
                                              <div className="absolute inset-0 border-2 border-blue-500/20 rounded-full"></div>
                                              <div className="absolute inset-0 border-t-2 border-blue-500 rounded-full animate-spin"></div>
                                              <Zap size={16} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-500 animate-pulse" />
                                          </div>
                                          <div className="flex flex-col items-center">
                                              <span className="text-[10px] text-blue-400 animate-pulse tracking-[0.3em] font-bold uppercase">Synthesizing...</span>
                                              <span className="text-[8px] text-zinc-600 mt-1 uppercase font-mono">Quantum_Calculations_Active</span>
                                          </div>
                                      </div>
                                  ) : (
                                      <div className="markdown-body prose prose-invert prose-sm max-w-none prose-p:text-emerald-300/80 prose-headings:text-emerald-400 prose-headings:font-mono prose-strong:text-emerald-400 prose-ul:list-disc prose-li:text-emerald-300/70 p-2">
                                          <Markdown>{toolOutput}</Markdown>
                                          <span className="inline-block w-2 h-4 bg-emerald-500/50 ml-1 animate-pulse align-middle"></span>
                                      </div>
                                  )}
                                  
                                  {/* Scanline Effect */}
                                  <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(transparent_50%,#fff_50%)] bg-[size:100%_4px]"></div>
                              </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Tool Grid - Hardware Aesthetics */}
                      <div className="grid grid-cols-2 gap-3 mb-8">
                          {[
                              { id: 'LISTING_BOOST', prompt: 'Listing Boost: Generate optimized eBay titles, keywords, and platform recommendations', label: 'Listing Boost', icon: PenTool, color: 'text-pink-400', desc: 'Marketplace Optimization' },
                              { id: 'CONSERVATION_LAB', prompt: 'Conservation Lab: Provide detailed care instructions and preservation protocols', label: 'Conservation Lab', icon: FlaskConical, color: 'text-emerald-400', desc: 'Preservation Protocols' },
                              { id: 'ERA_DECODER', prompt: 'Era Decoder: Provide deep historical context and decode era-specific features', label: 'Era Decoder', icon: History, color: 'text-amber-400', desc: 'Contextual Forensics' }
                          ].map(tool => (
                              <button 
                                key={tool.id} 
                                onClick={() => executeTool(tool.id, tool.prompt)} 
                                disabled={isToolLoading}
                                className={`p-5 bg-zinc-900/30 border-2 transition-all duration-300 rounded-2xl text-left hover:bg-zinc-800/50 group relative overflow-hidden ${activeTool === tool.id ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/5'} ${isToolLoading && activeTool !== tool.id ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                              >
                                  {/* Hardware Pattern background */}
                                  <div className="absolute top-0 right-0 w-16 h-16 opacity-5 pointer-events-none">
                                      <div className="absolute inset-0 border-t border-r border-white"></div>
                                      <div className="absolute top-2 right-2 w-1 h-1 bg-white rounded-full"></div>
                                  </div>

                                  <div className="flex justify-between items-start mb-4">
                                      <div className={`p-2.5 rounded-xl bg-black/40 ${tool.color} ${!isToolLoading && 'group-hover:scale-110'} transition-transform shadow-lg shadow-black/50`}>
                                          <tool.icon size={22} className={isToolLoading && activeTool === tool.id ? "animate-pulse" : ""} />
                                      </div>
                                      {isToolLoading && activeTool === tool.id ? (
                                          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 rounded-full border border-blue-500/20">
                                              <Loader2 size={10} className="text-blue-500 animate-spin" />
                                              <span className="text-[8px] font-mono text-blue-400 uppercase tracking-widest">Active</span>
                                          </div>
                                      ) : (
                                          <ChevronRight size={14} className={`transition-all ${activeTool === tool.id ? 'text-blue-500 translate-x-1' : 'text-zinc-700 group-hover:text-white group-hover:translate-x-1'}`} />
                                      )}
                                  </div>
                                  <div className="text-[12px] font-bold text-white uppercase tracking-tight mb-1">{tool.label}</div>
                                  <div className={`text-[9px] font-mono leading-tight tracking-wider uppercase opacity-60 ${isToolLoading && activeTool === tool.id ? 'text-blue-400' : 'text-zinc-500'}`}>
                                      {isToolLoading && activeTool === tool.id ? 'Processing...' : tool.desc}
                                  </div>
                                  
                                  {activeTool === tool.id && (
                                      <div className="absolute bottom-0 left-0 h-1 bg-blue-500 animate-in slide-in-from-left duration-500" style={{ width: '100%' }}></div>
                                  )}
                              </button>
                          ))}
                      </div>

                      {/* Secondary Action Prompts */}
                      <div className="bg-zinc-900/10 border-2 border-dashed border-white/5 rounded-2xl p-6">
                           <div className="flex items-center justify-between mb-5">
                               <div className="flex items-center gap-2">
                                   <MessageSquare size={14} className="text-blue-500" />
                                   <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Query Synthesis</span>
                               </div>
                               <button onClick={cyclePrompts} disabled={isCyclingPrompts} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                                   <RefreshCw size={12} className={`text-zinc-600 ${isCyclingPrompts ? 'animate-spin' : ''}`} />
                               </button>
                           </div>
                           <div className="grid gap-2">
                               {prompts.slice(0, 3).map((p, i) => (
                                   <button key={i} onClick={() => handleChat(p)} className="w-full text-left p-4 rounded-xl bg-white/5 hover:bg-blue-500/10 hover:translate-x-1 text-xs text-zinc-300 transition-all border border-transparent hover:border-blue-500/20 flex items-center gap-3 group">
                                       <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40 group-hover:bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]"></div>
                                       <span className="truncate flex-1 tracking-tight">{p}</span>
                                       <ChevronRight size={10} className="text-zinc-800 group-hover:text-blue-500 mt-0.5" />
                                   </button>
                               ))}
                           </div>
                      </div>
                  </div>
              )}
          </div>

          {/* Action Bar */}
          <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black via-black/90 to-transparent pt-10 z-20">
              <button 
                  onClick={() => { soundManager.playLock(); onSave(currentResult); }} 
                  className="w-full relative group h-14 overflow-hidden rounded-2xl transition-all duration-300 active:scale-95"
              >
                  {/* Background Layers */}
                  <div className="absolute inset-0 bg-blue-600 group-hover:bg-blue-500 transition-colors"></div>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                  
                  {/* Glowing Edge */}
                  <div className="absolute inset-0 border border-white/20 rounded-2xl group-hover:border-white/40 transition-colors"></div>
                  <div className="absolute -inset-[1px] bg-gradient-to-r from-blue-400 to-emerald-400 opacity-0 group-hover:opacity-40 blur-sm rounded-2xl transition-opacity"></div>

                  <span className="relative z-10 flex items-center justify-center gap-3 text-white font-bold uppercase tracking-[0.2em] text-[11px]">
                      <div className="relative">
                          <Database size={16} className="group-hover:rotate-12 transition-transform" />
                          <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_5px_rgba(52,211,153,0.8)]"></div>
                      </div>
                      Archive_to_Vault
                  </span>

                  {/* Tactical readout at corners */}
                  <div className="absolute top-1 left-3 text-[7px] font-mono text-blue-200/50 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">secure_link:auth</div>
                  <div className="absolute bottom-1 right-3 text-[7px] font-mono text-blue-200/50 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">v.2.8.scryb</div>
              </button>
          </div>
      </div>

      {/* === EXPORT MODALS === */}
      
      {/* 1. DEALER DOSSIER (PDF PREVIEW) */}
      {exportMode === 'DOSSIER' && (
          <div className="absolute inset-0 z-[150] bg-black/95 backdrop-blur-xl flex flex-col animate-in slide-in-from-bottom duration-300">
              <div className="flex items-center justify-between p-4 border-b border-white/10 pt-[calc(20px+env(safe-area-inset-top))]">
                  <div className="flex items-center gap-2">
                      <FileText size={18} className="text-white" />
                      <span className="font-display text-lg text-white">Dealer Dossier</span>
                  </div>
                  <div className="flex gap-2">
                      <button onClick={handlePrint} className="flex items-center gap-1 bg-white text-black px-3 py-1.5 rounded text-xs font-bold hover:bg-zinc-200">
                          <Printer size={14} /> Print / PDF
                      </button>
                      <button onClick={() => setExportMode('NONE')} className="p-2 text-zinc-500 hover:text-white"><X size={20}/></button>
                  </div>
              </div>
              
              {/* HIDDEN PRINT REF - This is what actually prints */}
              <div className="flex-1 overflow-y-auto p-8 bg-zinc-900/50 flex justify-center">
                  <div ref={printRef} className="bg-white text-black w-full max-w-2xl p-8 shadow-2xl min-h-[800px]">
                      {/* HEADER */}
                      <div className="border-b-2 border-black pb-4 mb-6 flex justify-between items-start">
                          <div>
                              <h1 className="font-serif text-3xl font-bold tracking-tight mb-1">CONDITION REPORT</h1>
                              <p className="text-xs font-mono uppercase tracking-widest text-gray-500">Curator Prime Authenticated</p>
                          </div>
                          <div className="text-right">
                              <div className="text-4xl font-serif font-bold text-gray-900">${(currentResult.valuation.mid).toLocaleString()}</div>
                              <p className="text-[10px] uppercase font-bold text-gray-500">Est. Market Value</p>
                          </div>
                      </div>

                      {/* MAIN INFO */}
                      <div className="grid grid-cols-2 gap-8 mb-8">
                          <div>
                              <img src={displayImage} className="w-full h-64 object-cover grayscale contrast-125 border border-gray-200 mb-2" />
                              <div className="flex justify-between text-[9px] uppercase font-bold text-gray-400">
                                  <span>ID: {currentResult.provenance.digitalHash.substring(0,8)}</span>
                                  <span>{new Date().toLocaleDateString()}</span>
                              </div>
                          </div>
                          <div className="space-y-4">
                              <div>
                                  <label className="block text-[10px] font-bold uppercase text-gray-500">Asset Name</label>
                                  <div className="font-serif text-xl leading-tight">{currentResult.itemName}</div>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="block text-[10px] font-bold uppercase text-gray-500">Era / Origin</label>
                                      <div className="font-mono text-sm">{currentResult.era}, {currentResult.origin}</div>
                                  </div>
                                  <div>
                                      <label className="block text-[10px] font-bold uppercase text-gray-500">Grade</label>
                                      <div className="font-mono text-sm">{currentResult.conditionScore}/10 ({currentResult.condition})</div>
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-[10px] font-bold uppercase text-gray-500">Provenance Status</label>
                                  <div className="flex items-center gap-2 mt-1">
                                      <TrustBadge.icon size={14} className={TrustBadge.color} />
                                      <span className={`font-bold text-sm ${TrustBadge.color}`}>{currentResult.provenance.trustTier}</span>
                                  </div>
                              </div>
                          </div>
                      </div>

                      {/* ANALYSIS */}
                      <div className="mb-6">
                          <h3 className="text-sm font-bold uppercase border-b border-gray-200 pb-1 mb-2">Historical Context</h3>
                          <p className="font-serif text-sm leading-relaxed text-gray-700 text-justify">
                              {currentResult.historicalContext}
                          </p>
                      </div>

                      <div className="grid grid-cols-2 gap-8">
                          <div>
                              <h3 className="text-sm font-bold uppercase border-b border-gray-200 pb-1 mb-2">Restoration Notes</h3>
                              <p className="font-mono text-xs leading-relaxed text-gray-600">
                                  {currentResult.restoration.restorationPotential}
                              </p>
                          </div>
                          <div>
                              <h3 className="text-sm font-bold uppercase border-b border-gray-200 pb-1 mb-2">Market Forecast</h3>
                              <p className="font-mono text-xs leading-relaxed text-gray-600">
                                  Sentiment: {currentResult.forecast.marketSentiment}<br/>
                                  Liquidity Score: {currentResult.forecast.liquidityScore}/100<br/>
                                  Investment Grade: {currentResult.forecast.investmentGrade}
                              </p>
                          </div>
                      </div>

                      {/* FOOTER */}
                      <div className="mt-12 pt-4 border-t border-gray-200 flex justify-between items-center">
                          <div className="text-[10px] text-gray-400 font-mono">
                              Generated by Curator Prime OS<br/>
                              Verify: secure.curator.ai/verify
                          </div>
                          <div className="w-16 h-16 border border-gray-300 flex items-center justify-center">
                              <div className="w-12 h-12 bg-black"></div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* 2. MARKETPLACE LISTING (COPY PASTE) */}
      {exportMode === 'MARKETPLACE' && (
          <div className="absolute inset-0 z-[150] bg-black/95 backdrop-blur-xl flex flex-col animate-in slide-in-from-bottom duration-300">
              <div className="flex items-center justify-between p-4 border-b border-white/10 pt-[calc(20px+env(safe-area-inset-top))]">
                  <div className="flex items-center gap-2">
                      <Share2 size={18} className="text-white" />
                      <span className="font-display text-lg text-white">Marketplace Gen</span>
                  </div>
                  <button onClick={() => setExportMode('NONE')} className="p-2 text-zinc-500 hover:text-white"><X size={20}/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
                  {isToolLoading ? (
                      <div className="flex flex-col items-center justify-center h-64 text-zinc-500 gap-4">
                          <RefreshCw size={32} className="animate-spin text-blue-500" />
                          <p className="font-mono text-xs uppercase tracking-widest">Optimizing Search Vectors...</p>
                      </div>
                  ) : generatedListing ? (
                      <div className="space-y-6">
                          {/* TITLE BLOCK */}
                          <div className="bg-zinc-900 border border-white/10 p-4 rounded-xl">
                              <div className="flex justify-between items-center mb-2">
                                  <label className="text-[10px] font-bold uppercase text-zinc-500">Optimized Title (80 chars)</label>
                                  <button onClick={() => copyToClipboard(generatedListing.title)} className="text-blue-400 hover:text-white"><Copy size={14}/></button>
                              </div>
                              <div className="font-mono text-sm text-white break-words">{generatedListing.title.replace(/"/g, '')}</div>
                          </div>

                          {/* DESCRIPTION BLOCK */}
                          <div className="bg-zinc-900 border border-white/10 p-4 rounded-xl">
                              <div className="flex justify-between items-center mb-2">
                                  <label className="text-[10px] font-bold uppercase text-zinc-500">HTML Description</label>
                                  <button onClick={() => copyToClipboard(generatedListing.body)} className="text-blue-400 hover:text-white"><Copy size={14}/></button>
                              </div>
                              <div className="font-mono text-xs text-zinc-400 h-64 overflow-y-auto whitespace-pre-wrap border border-zinc-800 p-2 rounded bg-black">
                                  {generatedListing.body}
                              </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                             <div className="bg-zinc-900/50 p-3 rounded-lg border border-white/5">
                                 <span className="text-[9px] uppercase text-zinc-500 block mb-1">Recommended Price</span>
                                 <span className="text-lg font-mono text-emerald-400">${Math.round(currentResult.valuation.mid * 1.15).toLocaleString()}</span>
                                 <span className="text-[9px] text-zinc-600 block">Buy It Now (15% Markup)</span>
                             </div>
                             <div className="bg-zinc-900/50 p-3 rounded-lg border border-white/5">
                                 <span className="text-[9px] uppercase text-zinc-500 block mb-1">Reserve Floor</span>
                                 <span className="text-lg font-mono text-amber-400">${Math.round(currentResult.valuation.low).toLocaleString()}</span>
                                 <span className="text-[9px] text-zinc-600 block">Minimum Bid</span>
                             </div>
                          </div>
                      </div>
                  ) : null}
              </div>
          </div>
      )}

      {/* Chat Modal (Simplified) */}
      <AskCuratorChat
          showChat={showChat}
          setShowChat={setShowChat}
          chatHistory={chatHistory}
          isChatLoading={isChatLoading}
          chatInput={chatInput}
          setChatInput={setChatInput}
          handleChat={handleChat}
      />
    </div>
  );
};
