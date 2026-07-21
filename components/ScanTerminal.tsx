
import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { FileText, Search, DollarSign, Fingerprint, Languages, Volume2, VolumeX, Image as ImageIcon, Shield, Camera, Zap, Target, X, ChevronRight, Layers, Scan } from 'lucide-react';
import { analyzeItem, analyzeLiveFrame } from '../services/geminiService';
import { AppraisalResult, LiveAnalysisUpdate, LensMode } from '../types';
import { soundManager } from '../services/soundService';
import { toast } from './Toast';

export type ScanResultMeta = {
  phase: "fast" | "full";
  sessionId: string;
};

interface ScannerProps {
  onSave: (
    result: AppraisalResult,
    imageData: string,
    meta?: ScanResultMeta
  ) => void | Promise<void>;
}

export interface ScannerRef {
  capture: () => void;
}

const LENSES: { id: LensMode; label: string; icon: any; }[] = [
  { id: 'IDENTITY', label: 'Identity', icon: Search },
  { id: 'MARKET', label: 'Valuation', icon: DollarSign },
  { id: 'FORENSICS', label: 'Forensics', icon: Fingerprint },
  { id: 'RESTORE', label: 'Restore', icon: Layers },
  { id: 'DECIPHER', label: 'Text', icon: Languages },
];

const PASSPORT_STEPS = [
    { label: "PRIMARY ANGLE", instruction: "Align item within the frame." },
    { label: "MAKER'S MARK", instruction: "Capture signature or base markings." },
    { label: "FINE DETAILS", instruction: "Focus on texture or unique wear." }
];

type ScanMode = 'MANUAL' | 'AUTHENTICATE' | 'LIVE' | 'PASSPORT';

export const Scanner = forwardRef<ScannerRef, ScannerProps>(({ onSave }, ref) => {
  const [scanMode, setScanMode] = useState<ScanMode>('MANUAL');
  const [activeLens, setActiveLens] = useState<LensMode>('IDENTITY');
  const [passportStep, setPassportStep] = useState(0);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [userDescription, setUserDescription] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Deep analysis in progress…");
  const [fastRequested, setFastRequested] = useState(false);
  const [fastRunning, setFastRunning] = useState(false);
  const answerNowResolver = useRef<(() => void) | null>(null);
  const [liveData, setLiveData] = useState<LiveAnalysisUpdate | null>(null);
  
  const [loupePosition, setLoupePosition] = useState({ x: 50, y: 50 }); 
  const [soundEnabled, setSoundEnabled] = useState(!soundManager.getMutedState());
  const [flashTriggered, setFlashTriggered] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isPinching, setIsPinching] = useState(false);
  const lastPinchDistance = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isProcessingLiveFrame = useRef(false);

  const triggerHaptic = useCallback((pattern: 'success' | 'click' | 'transition' | 'alert' | 'hotspot') => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        switch (pattern) {
            case 'success': navigator.vibrate([150, 50, 150]); break;
            case 'click': navigator.vibrate(20); break;
            case 'transition': navigator.vibrate([30, 50, 30]); break;
            case 'alert': navigator.vibrate([200, 50, 200, 50, 200]); break;
            case 'hotspot': navigator.vibrate([50, 30, 50, 30, 50]); break;
        }
    }
  }, []);

  useEffect(() => {
    const unsub = soundManager.subscribe((isMuted) => {
        setSoundEnabled(!isMuted);
    });
    return () => { unsub(); };
  }, []);

  const toggleSound = () => {
    const isNowMuted = soundManager.toggleMute();
    soundManager.playClick();
    triggerHaptic('click');
    toast.info(isNowMuted ? "Audio Systems Offline" : "Audio Systems Active");
  };

  const getDistance = (t1: React.Touch, t2: React.Touch) => {
    return Math.sqrt(Math.pow(t2.clientX - t1.clientX, 2) + Math.pow(t2.clientY - t1.clientY, 2));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      setIsPinching(true);
      lastPinchDistance.current = getDistance(e.touches[0], e.touches[1]);
    }
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!containerRef.current) return;

    // Handle Pinch to Zoom
    if ('touches' in e && e.touches.length === 2) {
      const distance = getDistance(e.touches[0], e.touches[1]);
      if (lastPinchDistance.current !== null) {
        const delta = (distance - lastPinchDistance.current) / 100;
        setZoomLevel(prev => Math.max(1, Math.min(5, prev + delta)));
        lastPinchDistance.current = distance;
      }
      return;
    }

    if (isPinching) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    setLoupePosition({ x: Math.max(10, Math.min(90, x)), y: Math.max(10, Math.min(90, y)) });
  };

  const handleTouchEnd = () => {
    setIsPinching(false);
    lastPinchDistance.current = null;
  };

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    
    const startCamera = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false 
        });
        activeStream = s;
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch (err) { 
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ 
              video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false 
            });
            activeStream = fallbackStream;
            setStream(fallbackStream);
            if (videoRef.current) videoRef.current.srcObject = fallbackStream;
          } catch (fallbackErr) {
            console.error("Camera Error:", fallbackErr);
            toast.error("Camera Access Denied or Unavailable");
          }
      }
    };
    
    startCamera();
    
    return () => {
        if (activeStream) {
            activeStream.getTracks().forEach(t => t.stop());
        }
    };
  }, []);

  useEffect(() => {
    if (!stream || scanMode !== 'LIVE') {
        isProcessingLiveFrame.current = false;
        return;
    }
    
    const interval = setInterval(async () => {
      if (videoRef.current && !isAnalyzing && !isProcessingLiveFrame.current) {
        isProcessingLiveFrame.current = true;
        
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth / 3; 
        canvas.height = videoRef.current.videoHeight / 3;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            isProcessingLiveFrame.current = false;
            return;
        }

        if (activeLens === 'FORENSICS') {
            const w = canvas.width;
            const h = canvas.height;
            const cx = (loupePosition.x / 100) * w;
            const cy = (loupePosition.y / 100) * h;
            const cropSize = w * 0.4; 
            ctx.drawImage(videoRef.current, (cx - cropSize/2) * 3, (cy - cropSize/2) * 3, cropSize * 3, cropSize * 3, 0, 0, w, h);
        } else {
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        }

        const data = canvas.toDataURL('image/jpeg', 0.5);
        try {
          if (!isAnalyzing) soundManager.playScanHum(); 
          const res = await analyzeLiveFrame(data, activeLens, liveData?.shortTitle);
          
          if (scanMode === 'LIVE') {
              if (res.status !== 'SEARCHING' || liveData?.status === 'SEARCHING') {
                  setLiveData(res);
                  
                  // Trigger hotspot haptic if just detected
                  if (res.hotspotDetected && !liveData?.hotspotDetected) {
                      triggerHaptic('hotspot');
                  }

                  if (res.status === 'LOCKED' && (!liveData || liveData.shortTitle !== res.shortTitle)) {
                      soundManager.playLock('standard');
                      triggerHaptic('success');
                  }
              }
          }
        } catch(e) { 
            console.error("Live frame analysis failed", e);
        } finally {
            setTimeout(() => {
                isProcessingLiveFrame.current = false;
            }, 1000);
        }
      }
    }, 500); 
    
    return () => clearInterval(interval);
  }, [stream, activeLens, loupePosition, isAnalyzing, liveData, scanMode]);

  const handleCapture = async () => {
    if (!videoRef.current) return;
    soundManager.playShutter();
    triggerHaptic('transition');
    setFlashTriggered(true);
    setTimeout(() => setFlashTriggered(false), 300);
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    const data = canvas.toDataURL('image/jpeg', 0.95);
    
    if (scanMode === 'PASSPORT') {
        const newImages = [...capturedImages, data];
        setCapturedImages(newImages);
        if (passportStep < PASSPORT_STEPS.length - 1) {
            setPassportStep(prev => prev + 1);
            soundManager.playClick();
            triggerHaptic('click');
        } else {
            setPassportStep(0);
            runAnalysis(newImages);
        }
    } else if (scanMode === 'AUTHENTICATE') {
        setCapturedImages([data]);
        // Do not immediately run analysis. Show form.
        setShowForm(true);
    } else {
        setCapturedImages([data]);
        runAnalysis([data]);
    }
  };

  useImperativeHandle(ref, () => ({
    capture: handleCapture
  }));

  const handleClearBatch = () => {
      if (capturedImages.length > 0) {
          soundManager.playClick();
          triggerHaptic('alert');
          setCapturedImages([]);
          setPassportStep(0);
          toast.info("Scan Batch Cleared");
      }
  };

  const runAnalysis = async (images: string[]) => {
      setIsAnalyzing(true);
      setFastRequested(false);
      setFastRunning(true);
      setLoadingLabel("Identifying your item…");

      const sessionId = crypto.randomUUID();
      const desc = userDescription;
      let shown = false;
      let preferFast = false;

      // Flash starts NOW (not after click) so Answer now is actually faster
      const fastPromise = analyzeItem(images, desc, { mode: "fast" })
        .then((result) => {
          setFastRunning(false);
          return { ok: true as const, result };
        })
        .catch((error) => {
          setFastRunning(false);
          return { ok: false as const, error };
        });

      // Pro deep path also starts now
      const fullPromise = analyzeItem(images, desc, { mode: "full" })
        .then((result) => ({ ok: true as const, result }))
        .catch((error) => ({ ok: false as const, error }));

      let resolveClick: (() => void) | null = null;
      const clickPromise = new Promise<void>((resolve) => {
        resolveClick = resolve;
      });
      answerNowResolver.current = () => {
        preferFast = true;
        setFastRequested(true);
        setLoadingLabel("Pulling quick answer…");
        resolveClick?.();
      };

      const lockIdentity = (refined: AppraisalResult, prior: AppraisalResult) => {
        if (
          refined.itemName &&
          prior.itemName &&
          refined.itemName.toLowerCase() !== prior.itemName.toLowerCase()
        ) {
          refined.alternateIdentifications = [
            { name: refined.itemName, reason: "Deeper-pass alternative" },
            ...(refined.alternateIdentifications || []),
          ].slice(0, 4);
          refined.itemName = prior.itemName;
          refined.classification = prior.classification || refined.classification;
          refined.category = prior.category || refined.category;
        }
        refined.analysisTier = "full";
        return refined;
      };

      try {
        // Wait until either Pro finishes OR user hits Answer now
        type Gate =
          | { kind: "full"; payload: { ok: true; result: AppraisalResult } | { ok: false; error: unknown } }
          | { kind: "click" };

        const gate: Gate = await Promise.race([
          fullPromise.then((payload) => ({ kind: "full" as const, payload })),
          clickPromise.then(() => ({ kind: "click" as const })),
        ]);

        if (gate.kind === "full") {
          // User waited — show Pro only (ignore Flash to avoid name churn)
          if (gate.payload.ok === false) throw gate.payload.error;
          await onSave(gate.payload.result, images[0], { phase: "full", sessionId });
          shown = true;
        } else {
          // Answer now — Flash is already in flight; await it (should be near-done)
          setLoadingLabel("Almost there…");
          const fast = await fastPromise;
          if (fast.ok === false) {
            toast.info("Quick path failed — finishing deep analysis…");
            setLoadingLabel("Identifying your item…");
            const full = await fullPromise;
            if (full.ok === false) throw full.error;
            await onSave(full.result, images[0], { phase: "full", sessionId });
            shown = true;
          } else {
            await onSave(fast.result, images[0], { phase: "fast", sessionId });
            shown = true;
            setIsAnalyzing(false);
            setCapturedImages([]);
            setUserDescription("");
            setShowForm(false);
            toast.info("Quick answer ready — refining details…");

            // Pro refine: use in-flight full if ready, else re-call with name lock
            fullPromise
              .then(async (full) => {
                try {
                  if (full.ok) {
                    const locked = lockIdentity({ ...full.result }, fast.result);
                    await onSave(locked, images[0], { phase: "full", sessionId });
                  } else {
                    const refined = await analyzeItem(images, desc, {
                      mode: "full",
                      priorIdentification: fast.result,
                    });
                    await onSave(lockIdentity(refined, fast.result), images[0], {
                      phase: "full",
                      sessionId,
                    });
                  }
                  toast.success("Details refined");
                  soundManager.playLock("high");
                } catch {
                  toast.info("Keeping quick answer");
                }
              })
              .catch(() => toast.info("Keeping quick answer"));

            return;
          }
        }

        setCapturedImages([]);
        setUserDescription("");
        setShowForm(false);
      } catch (e) {
        triggerHaptic("alert");
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("Analysis Error: " + msg);
        if (!shown) setCapturedImages([]);
      } finally {
        answerNowResolver.current = null;
        setIsAnalyzing(false);
        setFastRequested(false);
        setFastRunning(false);
      }
  };

  const handleAnswerNow = () => {
    if (fastRequested) return;
    soundManager.playClick();
    triggerHaptic("click");
    answerNowResolver.current?.();
  };

  const handleGallerySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        soundManager.playClick();
        triggerHaptic('click');
        const files = Array.from(e.target.files);
        const imagePromises = files.map(file => new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file as Blob);
        }));
        try {
            const images = await Promise.all(imagePromises);
            setCapturedImages(images);
            if (scanMode === 'AUTHENTICATE') {
                setShowForm(true);
            } else {
                runAnalysis(images);
            }
        } catch (err) { setIsAnalyzing(false); } 
        finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
    }
  };

  const switchMode = (mode: ScanMode) => {
    console.log("[ScanTerminal] Mode switch triggered:", mode);
    setScanMode(mode);
    setCapturedImages([]);
    setPassportStep(0);
    setLiveData(null);
    soundManager.playClick();
    triggerHaptic('click');
  };

  return (
    <div 
        ref={containerRef} 
        className="relative h-full bg-black overflow-hidden select-none font-sans touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseMove={handleTouchMove} 
    >
      <div className={`relative w-full h-full overflow-hidden transition-all duration-300 ${zoomLevel > 1 ? 'scale-[1.02]' : ''}`}>
          {capturedImages.length > 0 && scanMode === 'AUTHENTICATE' ? (
              <img src={capturedImages[0]} className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 opacity-80`} style={{ transform: `scale(${zoomLevel})` }} />
          ) : (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${activeLens === 'RESTORE' ? 'sepia hue-rotate-[180deg] brightness-[0.7] contrast-[1.4] saturate-[1.5] opacity-90' : 'opacity-80'}`} 
                style={{ transform: `scale(${zoomLevel})` }}
              />
          )}

          {/* Blueprint Grid Overlay for RESTORE */}
          {activeLens === 'RESTORE' && (
              <div className="absolute inset-0 pointer-events-none mix-blend-screen opacity-50 z-10 transition-opacity duration-500">
                  <div className="w-full h-full bg-[linear-gradient(rgba(59,130,246,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.3)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
                  <div className="absolute inset-0 bg-gradient-to-t from-blue-900/40 via-transparent to-blue-900/40"></div>
              </div>
          )}
      </div>
      
      {/* Cinematic Vignette */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.6)_100%)]"></div>
      
      {flashTriggered && <div className="absolute inset-0 bg-white z-[60] animate-flash pointer-events-none"></div>}

      {/* === AUTHENTICATE MODE RETICLE / UI === */}
      {scanMode === 'AUTHENTICATE' && !isAnalyzing && capturedImages.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 mx-6">
              <Shield className="text-orange-500/50 mb-4" size={48} />
              <div className="w-[80%] max-w-sm aspect-[4/3] border-2 border-dashed border-orange-500/40 rounded-2xl flex items-center justify-center relative">
                    <div className="absolute inset-0 bg-orange-500/5 rounded-2xl"></div>
                    <span className="text-orange-400/80 font-mono text-xs uppercase tracking-widest text-center px-4">
                        Align item clearly <br/> for authentication
                    </span>
              </div>
          </div>
      )}

      {/* === MANUAL MODE RETICLE === */}
      {scanMode === 'MANUAL' && !isAnalyzing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 mix-blend-screen">
              <div className="w-[65%] max-w-sm aspect-square relative flex items-center justify-center">
                  
                  {/* Subtle Tactical Brackets */}
                  <div className="absolute inset-0 border border-white/5 bg-white/[0.01] backdrop-blur-[1px] rounded-2xl"></div>
                  
                  {/* Corner Brackets */}
                  <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-white/20 rounded-tl-2xl"></div>
                  <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-white/20 rounded-tr-2xl"></div>
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-white/20 rounded-bl-2xl"></div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-white/20 rounded-br-2xl"></div>
                  
                  {/* Center Dot */}
                  <div className="w-1 h-1 bg-white rounded-full shadow-[0_0_10px_white]"></div>

                  {/* Minimalist Readouts */}
                  <div className="absolute bottom-4 left-6 flex items-center gap-2">
                      <div className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(16,185,129,0.5)]"></div>
                      <span className="text-[8px] font-mono text-white/40 tracking-[0.3em] uppercase">Optics_Rdy</span>
                  </div>

                  {/* Minimalist Grid Guides */}
                  <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-[0.5px] bg-white/10"></div>
                      <div className="h-12 w-[0.5px] bg-white/10 absolute"></div>
                  </div>

                  {/* Rule of Thirds Grid (Very Subtle) */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20">
                      <div className="border-r-[0.5px] border-b-[0.5px] border-white/30"></div>
                      <div className="border-r-[0.5px] border-b-[0.5px] border-white/30"></div>
                      <div className="border-b-[0.5px] border-white/30"></div>
                      <div className="border-r-[0.5px] border-b-[0.5px] border-white/30"></div>
                      <div className="border-r-[0.5px] border-b-[0.5px] border-white/30"></div>
                      <div className="border-b-[0.5px] border-white/30"></div>
                      <div className="border-r-[0.5px] border-white/30"></div>
                      <div className="border-r-[0.5px] border-white/30"></div>
                      <div></div>
                  </div>
              </div>
          </div>
      )}

      {/* === PASSPORT OVERLAY === */}
      {scanMode === 'PASSPORT' && !isAnalyzing && (
          <>
              <div className="absolute top-[15%] left-0 right-0 z-30 flex justify-center pointer-events-none px-6">
                   <div className="relative bg-black/80 border border-orange-500/20 px-8 py-5 text-center animate-in slide-in-from-top-4 shadow-[0_10px_50px_rgba(0,0,0,0.8)] flex items-center gap-6 rounded-[2.5rem] backdrop-blur-3xl transition-all duration-500 group overflow-hidden">
                       
                       {/* Animated Scanning Border Effect */}
                       <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-orange-500/40 to-transparent animate-scan"></div>
                       <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-orange-500/40 to-transparent animate-scan delay-1000"></div>

                       {/* Enhanced Step Indicator */}
                       <div key={passportStep} className="relative w-14 h-14 shrink-0">
                           <div className="absolute inset-0 bg-orange-500/20 rounded-2xl animate-pulse"></div>
                           <div className="absolute inset-0 border border-orange-500/40 rounded-2xl flex items-center justify-center shadow-[inset_0_0_20px_rgba(249,115,22,0.15)] animate-in zoom-in spin-in-12 duration-700">
                               <span className="text-orange-400 font-display font-bold text-2xl tracking-tighter shadow-orange-500/40 drop-shadow-md">{passportStep + 1}</span>
                           </div>
                           {/* Orbiting Ring */}
                           <div className="absolute -inset-1 border border-orange-500/10 rounded-2xl animate-[spin_4s_linear_infinite]"></div>
                       </div>
                       
                       <div className="text-left py-1">
                           <div className="flex items-center gap-2 mb-1">
                               <h3 className="text-white font-display text-lg italic tracking-tight animate-in slide-in-from-left-4 duration-500" key={`label-${passportStep}`}>
                                   {PASSPORT_STEPS[passportStep].label}
                               </h3>
                               <div className="w-1 h-1 rounded-full bg-orange-500/60 animate-pulse"></div>
                           </div>
                           <p className="text-zinc-400 text-[10px] uppercase font-mono tracking-[0.2em] animate-in slide-in-from-left-4 duration-700" key={`inst-${passportStep}`}>
                               {PASSPORT_STEPS[passportStep].instruction}
                           </p>
                       </div>

                       {/* Enhanced Progress Indicators */}
                       <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
                           {PASSPORT_STEPS.map((_, idx) => (
                               <div 
                                 key={idx} 
                                 className={`h-1.5 rounded-full transition-all duration-1000 ease-[cubic-bezier(0.87,0,0.13,1)] ${idx === passportStep ? 'w-12 bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,1)]' : idx < passportStep ? 'w-4 bg-orange-500/30' : 'w-4 bg-white/5'}`} 
                               />
                           ))}
                       </div>
                   </div>
              </div>

              {/* Dynamic Passport Framing Cues */}
              <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center mix-blend-screen">
                    {passportStep === 0 && (
                        <div className="w-[80%] h-[60%] border-2 border-white/20 rounded-[40px] relative animate-in zoom-in duration-500">
                             <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-orange-500/80 rounded-tl-[40px]"></div>
                             <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-orange-500/80 rounded-tr-[40px]"></div>
                             <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-orange-500/80 rounded-bl-[40px]"></div>
                             <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-orange-500/80 rounded-br-[40px]"></div>
                             <div className="absolute inset-0 flex items-center justify-center opacity-30">
                                  <div className="h-full w-[1px] bg-white/20"></div>
                                  <div className="w-full h-[1px] bg-white/20 absolute"></div>
                             </div>
                        </div>
                    )}
                    
                    {passportStep === 1 && (
                        <div className="w-64 h-64 border-[1px] border-white/30 rounded-full animate-in zoom-in duration-500">
                             <div className="absolute inset-0 border-[1px] border-orange-500/50 border-dashed rounded-full animate-[spin_10s_linear_infinite]"></div>
                             <div className="absolute right-[-40px] top-1/2 -translate-y-1/2 text-[9px] font-mono text-orange-500 uppercase tracking-widest w-24">Macro Focus</div>
                             <div className="absolute inset-0 flex items-center justify-center">
                                 <div className="w-32 h-32 border-[2px] border-orange-500/80 relative text-center flex items-center justify-center shadow-[0_0_30px_rgba(249,115,22,0.2)]">
                                     <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-white"></div>
                                     <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-white"></div>
                                     <div className="w-1 h-1 bg-orange-500 rounded-full animate-pulse"></div>
                                 </div>
                             </div>
                        </div>
                    )}

                    {passportStep === 2 && (
                        <div className="w-[70%] h-[50%] grid grid-cols-4 grid-rows-4 gap-2 animate-in fade-in duration-500">
                             {Array.from({length: 16}).map((_, i) => {
                                 const isCenter = [5, 6, 9, 10].includes(i);
                                 return (
                                     <div key={i} className={`border-[1px] ${isCenter ? 'border-orange-500/50 bg-orange-500/5 shadow-[inset_0_0_15px_rgba(249,115,22,0.2)]' : 'border-white/5'} rounded-xl transition-all duration-1000 flex items-center justify-center`}>
                                         {isCenter && <div className="w-[2px] h-[2px] bg-orange-500/50 rounded-full"></div>}
                                     </div>
                                 );
                             })}
                        </div>
                    )}
              </div>
          </>
      )}

      {/* === LOADING STATE === */}
      {isAnalyzing && (
          <div className="absolute inset-0 z-[100] bg-canvas/95 backdrop-blur-md flex flex-col items-center justify-center p-6 animate-in fade-in duration-300">
              <div className="w-full max-w-sm rounded-3xl border border-line bg-surface shadow-card p-8 text-center">
                  <div className="relative w-28 h-28 mx-auto mb-6">
                      <div className="absolute inset-0 rounded-full border border-brand/20" />
                      <div className="absolute inset-2 rounded-full border border-brandsoft/30 animate-[spin_8s_linear_infinite]" />
                      <div className="absolute inset-5 rounded-full bg-brand/10 animate-pulse" />
                      <div className="absolute inset-0 flex items-center justify-center">
                          <Scan className="text-brandsoft" size={32} />
                      </div>
                      <div className="absolute inset-x-4 top-0 h-0.5 bg-gradient-to-r from-transparent via-brandsoft to-transparent animate-scan opacity-80" />
                  </div>

                  <h3 className="font-display text-2xl text-ink mb-2">
                    {fastRunning ? "Quick answer…" : "Analyzing…"}
                  </h3>
                  <p className="text-sm text-mute mb-6 leading-relaxed">
                    {loadingLabel}
                  </p>

                  <div className="h-1.5 w-full rounded-full bg-elevated overflow-hidden mb-6">
                      <div
                        className={`h-full rounded-full bg-brand transition-all duration-700 ${
                          fastRunning ? "w-2/3 animate-pulse" : "w-1/2 animate-pulse"
                        }`}
                      />
                  </div>

                  {!fastRequested ? (
                    <button
                      type="button"
                      onClick={handleAnswerNow}
                      className="w-full py-3.5 rounded-2xl bg-brand text-white text-sm font-semibold shadow-glow hover:bg-brandsoft transition-colors flex items-center justify-center gap-2"
                    >
                      <Zap size={16} />
                      Answer now
                      <span className="text-white/70 font-normal text-xs">(faster)</span>
                    </button>
                  ) : (
                    <div className="w-full py-3.5 rounded-2xl border border-brand/40 bg-brand/10 text-brandsoft text-sm font-medium flex items-center justify-center gap-2">
                      <Zap size={16} className={fastRunning ? "animate-pulse" : ""} />
                      {fastRunning ? "Preparing quick answer…" : "Quick path selected"}
                    </div>
                  )}

                  <p className="text-[11px] text-faint mt-4 leading-relaxed">
                    {fastRequested
                      ? "Quick path is already running — results should appear in a few seconds."
                      : "Deep analysis is more careful. Need it sooner? Tap Answer now (Flash is already working)."}
                  </p>
              </div>
          </div>
      )}

      {!isAnalyzing && (
        <>
            {/* Live Mode HUD */}
            {scanMode === 'LIVE' && (
                <>
                    {/* Dynamic Reticle based on Lens */}
                    <div 
                        className={`absolute w-64 h-64 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] pointer-events-none z-30 flex items-center justify-center mix-blend-screen
                        ${activeLens === 'FORENSICS' ? 'scale-110' : 'scale-100'}
                        `}
                        style={{ left: `${loupePosition.x}%`, top: `${loupePosition.y}%`, transform: 'translate(-50%, -50%)' }}
                    >
                         {/* Unified Thin Pulsing Ring Reticle */}
                         <div className={`absolute inset-0 rounded-full border-[2px] transition-all duration-700 ease-out flex items-center justify-center
                             ${activeLens === 'IDENTITY' ? 'border-blue-500 text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)]' : 
                               activeLens === 'MARKET' ? 'border-emerald-500 text-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.5)]' : 
                               activeLens === 'FORENSICS' ? 
                                 (liveData?.hotspotDetected || (liveData?.confidence ?? 0) > 80 ? 'border-red-600 text-red-600 shadow-[0_0_40px_rgba(220,38,38,0.7)]' : 'border-amber-500 text-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.6)]') : 
                               activeLens === 'RESTORE' ? 'border-orange-500 text-orange-500 shadow-[0_0_30px_rgba(249,115,22,0.5)] bg-orange-500/10 border-dashed' :
                               'border-purple-500 text-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.5)]'}
                             ${liveData?.status === 'LOCKED' ? 'scale-[2.5] opacity-0 border-[6px]' : 'scale-100 opacity-100 animate-pulse'}
                         `}></div>
                         
                         {/* Subtle Blue Glow Effect for IDENTITY Lens */}
                         <div className={`absolute inset-0 rounded-full transition-all duration-1000 ${activeLens === 'IDENTITY' && liveData?.status !== 'LOCKED' ? 'bg-blue-500/10 shadow-[inset_0_0_40px_rgba(59,130,246,0.4)] scale-110 opacity-100' : 'opacity-0 scale-90'}`}></div>
                         
                         {/* RESTORE Blueprint Crosshairs */}
                         {activeLens === 'RESTORE' && (
                             <div className="absolute inset-[-20%] pointer-events-none">
                                 <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-orange-500/50 -translate-y-1/2 before:content-[''] before:absolute before:left-1/2 before:-translate-x-1/2 before:-top-1 before:w-1 before:h-2 before:bg-orange-500/80"></div>
                                 <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-orange-500/50 -translate-x-1/2 before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-1 before:h-1 before:w-2 before:bg-orange-500/80"></div>
                             </div>
                         )}

                         {/* Inner Tracking Ring */}
                         <div className={`absolute inset-[15%] rounded-full border-[1px] border-dashed transition-all duration-1000 ease-out
                             ${activeLens === 'IDENTITY' ? 'border-blue-400/50' : 
                               activeLens === 'MARKET' ? 'border-emerald-400/50' : 
                               activeLens === 'FORENSICS' ? 'border-amber-400/50' : 
                               activeLens === 'RESTORE' ? 'border-orange-400/80 border-dotted' :
                               'border-purple-400/50'}
                             ${liveData?.status === 'LOCKED' ? 'scale-[1.8] opacity-0 animate-[spin_1s_ease-out_reverse]' : 'scale-100 opacity-80 animate-[spin_8s_linear_infinite]'}
                         `}></div>

                         {/* Center Core */}
                         <div className={`w-1.5 h-1.5 rounded-full transition-all duration-500 bg-current shadow-[0_0_8px_currentcolor]
                             ${activeLens === 'IDENTITY' ? 'text-blue-500' : 
                               activeLens === 'MARKET' ? 'text-emerald-500' : 
                               activeLens === 'FORENSICS' ? 'text-amber-500' : 
                               activeLens === 'RESTORE' ? 'text-orange-500 rounded-none w-2 h-2' :
                               'text-purple-500'}
                             ${liveData?.status === 'LOCKED' ? 'scale-0' : 'scale-100'}
                         `}></div>

                         {/* Lens-specific HUD Additions */}
                         {activeLens === 'FORENSICS' && liveData?.hotspotDetected && (
                             <>
                                 <div className="absolute inset-0 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(245,158,11,0.2)_360deg)] rounded-full animate-[spin_2s_linear_infinite]"></div>
                                 <div className="absolute top-4 right-4 flex items-center gap-2 animate-pulse bg-black/60 px-2 py-1 rounded border border-amber-500/30">
                                     <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                                     <span className="text-[8px] font-mono font-bold text-amber-500 tracking-widest uppercase">Hotspot_Det</span>
                                 </div>
                             </>
                         )}

                         {activeLens === 'MARKET' && (
                             <div className={`absolute bottom-2 right-2 flex gap-1 transition-opacity duration-300 ${liveData?.status === 'LOCKED' ? 'opacity-0' : 'opacity-100'}`}>
                                 <div className="w-1 h-2 bg-emerald-500/60 animate-[pulse_1.5s_infinite]"></div>
                                 <div className="w-1 h-3 bg-emerald-500/80 animate-[pulse_1.5s_infinite_200ms]"></div>
                                 <div className="w-1 h-1.5 bg-emerald-500/40 animate-[pulse_1.5s_infinite_400ms]"></div>
                             </div>
                         )}

                         {activeLens === 'DECIPHER' && (
                             <div className={`absolute inset-x-4 top-1/2 h-[1px] bg-purple-500/50 shadow-[0_0_10px_purple] animate-[scanline_2s_ease-in-out_infinite] transition-opacity duration-300 ${liveData?.status === 'LOCKED' ? 'opacity-0' : 'opacity-100'}`}></div>
                         )}

                         {/* Confidence Badge (Live) */}
                         {liveData && liveData.status !== 'SEARCHING' && (
                             <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center">
                                 <div className={`px-3 py-1 bg-black/90 border-[1px] text-[10px] font-mono font-bold uppercase tracking-widest shadow-lg ${liveData.status === 'LOCKED' ? 'border-orange-500 text-orange-500 shadow-orange-500/20' : 'border-amber-500/50 text-amber-500'}`}>
                                     {liveData.status === 'LOCKED' ? 'TARGET LOCKED' : 'ANALYZING...'}
                                 </div>
                                 {liveData.shortTitle && (
                                     <div className="mt-1.5 text-[11px] font-bold text-white bg-black/80 border-[1px] border-white/10 px-3 py-1 uppercase tracking-wider">
                                         {liveData.shortTitle}
                                     </div>
                                 )}
                             </div>
                         )}
                    </div>
                </>
            )}

            {/* Top Controls: Mode Switcher & Sound */}
            <div className="absolute top-0 left-0 right-0 p-6 pt-[calc(20px+env(safe-area-inset-top))] flex justify-between items-center z-40 bg-gradient-to-b from-black/90 to-transparent pointer-events-none">
                <div className="pointer-events-auto flex gap-4">
                    {([
                        { id: 'MANUAL' as ScanMode, label: 'Quick' },
                        { id: 'PASSPORT' as ScanMode, label: '3 angles' },
                        { id: 'AUTHENTICATE' as ScanMode, label: 'Notes' },
                        { id: 'LIVE' as ScanMode, label: 'Live' },
                    ]).map(m => (
                        <button 
                            key={m.id}
                            onClick={() => switchMode(m.id)}
                            className={`text-[11px] font-semibold transition-colors z-10 px-2 py-1 rounded-full ${scanMode === m.id ? 'text-brandsoft bg-black/50' : 'text-white/50 hover:text-white/80'}`}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
                
                <button onClick={toggleSound} className="pointer-events-auto w-10 h-10 flex items-center justify-center text-white/40 hover:text-white transition-colors">
                    {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
            </div>

            {/* === DOSSIER FORM === */}
            <div className="absolute left-6 bottom-32 z-50 pointer-events-none group">
                <button 
                onClick={() => { soundManager.playClick(); triggerHaptic('transition'); setShowForm(!showForm); }}
                className={`pointer-events-auto h-12 px-5 flex items-center gap-3 rounded-full border transition-all duration-300 ${showForm || userDescription ? 'bg-white text-black border-white shadow-[0_10px_30px_rgba(255,255,255,0.2)]' : 'bg-black/60 backdrop-blur-3xl text-zinc-400 border-white/5 hover:bg-zinc-800'}`}
                >
                <FileText size={18} />
                <span className="text-[10px] font-semibold">{userDescription ? 'Notes added' : 'Add notes'}</span>
                </button>
 
                {showForm && (
                    <div className="absolute bottom-16 left-0 w-72 bg-zinc-950/90 backdrop-blur-3xl border border-white/5 p-6 rounded-3xl pointer-events-auto animate-in slide-in-from-bottom-4 duration-500 shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h3 className="text-[9px] font-bold text-zinc-400 uppercase tracking-[0.3em]">Evidence Log</h3>
                            <button onClick={() => setShowForm(false)} className="text-zinc-600 hover:text-white transition-colors">
                                <X size={14} />
                            </button>
                        </div>
                        <textarea 
                        value={userDescription}
                        onChange={(e) => setUserDescription(e.target.value)}
                        placeholder="Contextual forensic notes..."
                        className="w-full h-32 bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-xs text-white placeholder:text-zinc-700 focus:outline-none focus:border-white/10 transition-colors resize-none font-sans"
                        />
                        <div className="mt-4 flex items-center justify-between text-[8px] font-mono text-zinc-600 uppercase tracking-widest">
                            <span>Status: {userDescription.length > 0 ? 'Linked' : 'Ready'}</span>
                            <span>{userDescription.length} chars</span>
                        </div>
                        {scanMode === 'AUTHENTICATE' && (
                            <button 
                                onClick={() => {
                                    if (capturedImages.length > 0) {
                                        runAnalysis(capturedImages);
                                    } else {
                                        toast.info("Please capture or upload an image first.");
                                    }
                                }}
                                className="w-full mt-4 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(249,115,22,0.5)] active:scale-95 uppercase tracking-widest text-[10px]"
                            >
                                {capturedImages.length > 0 ? 'Submit for Authentication' : 'Capture Image First'}
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-4 z-50 pointer-events-none h-64 group/zoom">
                <span className="text-[8px] font-mono text-orange-500/60 uppercase tracking-widest [writing-mode:vertical-lr] rotate-180">Mag_Level</span>
                <div className="relative flex-1 w-8 flex justify-center py-2 pointer-events-auto">
                    {/* Slider Track */}
                    <input 
                        type="range"
                        min="1"
                        max="5"
                        step="0.1"
                        value={zoomLevel}
                        onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                        className="appearance-none bg-white/10 w-4 h-full rounded-full border border-white/5 cursor-pointer accent-orange-500 hover:bg-white/20 transition-all [writing-mode:bt-lr] -rotate-180"
                        style={{ WebkitAppearance: 'slider-vertical' }}
                    />
                </div>
                <div className="bg-black/80 backdrop-blur-md border border-orange-500/30 px-2 py-1 rounded shadow-lg pointer-events-auto">
                    <span className="text-[10px] font-mono text-orange-500 font-bold">{zoomLevel.toFixed(1)}x</span>
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="absolute bottom-32 left-0 right-0 z-40 flex flex-col items-center gap-8">
                
                {/* Lenses (Live Mode) */}
                {scanMode === 'LIVE' && (
                    <div className="flex gap-8 overflow-x-auto px-12 py-4 scrollbar-hide max-w-full mask-linear-fade items-center">
                        {LENSES.map((lens) => (
                            <button 
                                key={lens.id}
                                onClick={() => { setActiveLens(lens.id); soundManager.playClick(); triggerHaptic('click'); }}
                                className={`flex flex-col items-center gap-3 transition-all duration-500 ${activeLens === lens.id ? 'opacity-100 scale-110' : 'opacity-30 hover:opacity-50'}`}
                            >
                                <div className={`w-14 h-14 flex items-center justify-center border transition-all duration-500 rounded-2xl ${activeLens === lens.id ? 'bg-white text-black border-white shadow-[0_20px_40px_rgba(255,255,255,0.15)] ring-4 ring-white/10' : 'bg-zinc-900/40 text-white border-white/5'}`}>
                                    <lens.icon size={20} className={activeLens === lens.id ? 'scale-110' : ''} />
                                </div>
                                <span className="text-[8px] font-bold tracking-[0.3em] uppercase text-white shadow-black drop-shadow-md">{lens.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </>
      )}
      <input type="file" id="gallery-upload-input" multiple accept="image/*" ref={fileInputRef} className="hidden" onChange={handleGallerySelect} />
    </div>
  );
});

