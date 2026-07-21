
import React, { useState, useEffect, useRef } from 'react';
import { AppTab, CollectionItem, AppraisalResult } from './types';
import { CollectionItemSchema } from './lib/schemas';
import { Scanner, ScannerRef } from './components/ScanTerminal';
import { CollectionManager } from './components/VaultTerminal';
import { MarketTrends } from './components/DataTerminal';
import { ItemResult } from './components/ItemResult';
import { AuthScreen } from './components/AuthScreen';
import { ProfileTerminal } from './components/ProfileTerminal';
import { ArchiveTerminal } from './components/ArchiveTerminal';
import { ScanLine, Box, BarChart3, Database, Loader2, Cpu, Fingerprint, Globe, User as UserIcon, Image as ImageIcon } from 'lucide-react';
import { soundManager } from './services/soundService';
import { ToastContainer, ToastMessage, toast } from './components/Toast';
import { useAuth } from './contexts/AuthContext';
import { db, handleFirestoreError } from './services/firebase';
import { collection as fsCollection, query, where, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { buildVaultItem, stripUndefined, vaultErrorMessage, normalizeAppraisal } from './lib/vaultUtils';

const App: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [isBooting, setIsBooting] = useState(true);
  const [bootStep, setBootStep] = useState(0);

  const [activeTab, setActiveTab] = useState<AppTab>('SCAN');
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);

  const scannerRef = useRef<ScannerRef>(null);
  const reportedDriftItems = useRef<Set<string>>(new Set());

  // Toast State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    // Toast Listener
    const handleToast = (t: ToastMessage) => setToasts(prev => [...prev, t]);
    toast.listeners.add(handleToast);

    // Sync Collection with Firestore (Real-time)
    let unsubscribe: () => void = () => {};
    if (user) {
        if (!user.emailVerified) {
            toast.info("Restricted Access: Verification required for vault writes");
        }
        const q = query(fsCollection(db, 'items'), where('userId', '==', user.uid));
        unsubscribe = onSnapshot(q, (snapshot) => {
            const items: CollectionItem[] = [];
            let newDriftCount = 0;

            snapshot.docs.forEach(doc => {
                 const data = { ...doc.data(), id: doc.id };
                 const parsed = CollectionItemSchema.safeParse(data);
                 if (parsed.success) {
                     items.push(parsed.data as CollectionItem);
                 } else {
                     console.error(`Schema drift detected for item ${doc.id}:`, parsed.error);
                     if (!reportedDriftItems.current.has(doc.id)) {
                         reportedDriftItems.current.add(doc.id);
                         newDriftCount++;
                     }
                 }
            });
            
            if (newDriftCount > 0) {
                toast.error(`Schema drift detected in ${newDriftCount} vault item(s)`);
            }

            // Sort by dateScanned desc
            items.sort((a, b) => new Date(b.dateScanned).getTime() - new Date(a.dateScanned).getTime());
            setCollection(items);
        }, (error) => {
            console.error("Firestore sync error:", error);
            toast.error("Cloud synchronization failure");
        });
    }

    // Boot Sequence Simulation
    const timer1 = setTimeout(() => setBootStep(1), 500); // Modules
    const timer2 = setTimeout(() => setBootStep(2), 1200); // Network
    const timer3 = setTimeout(() => setBootStep(3), 1800); // Auth
    const timer4 = setTimeout(() => setIsBooting(false), 2400); // Complete

    return () => {
        toast.listeners.delete(handleToast);
        unsubscribe();
        clearTimeout(timer1); clearTimeout(timer2); clearTimeout(timer3); clearTimeout(timer4);
    };
  }, [user]);

  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  const saveToCollection = async (result: AppraisalResult, primaryImage: string) => {
    if (!user) {
      toast.error("Sign in required to vault items");
      return;
    }

    const normalized = normalizeAppraisal(result);
    const existingIndex = collection.findIndex(
        item => item.itemName === normalized.itemName &&
                item.era === normalized.era &&
                item.classification === normalized.classification
    );

    // Always surface appraisal results first — vault write is secondary.
    // Previously a failed Firestore write meant the user never saw the scan.
    try {
        if (existingIndex > -1) {
            const existingItem = collection[existingIndex];
            const prepared = await buildVaultItem(normalized, primaryImage, user.uid, existingItem.id);
            const existingImages = existingItem.images || [existingItem.imageUrl];
            const combinedImages = Array.from(
              new Set([...existingImages, ...(prepared.images || [prepared.imageUrl])].filter(Boolean))
            ).slice(0, 8);

            let newTier = existingItem.provenance?.trustTier || 'Level 1 (Snapshot)';
            if (combinedImages.length >= 3) newTier = 'Level 3 (Verified)';
            else if (combinedImages.length === 2) newTier = 'Level 2 (Visual)';

            const updatePayload = stripUndefined({
                valuation: prepared.valuation,
                forecast: prepared.forecast,
                condition: prepared.condition,
                conditionScore: prepared.conditionScore,
                historicalContext:
                  (prepared.historicalContext?.length || 0) > (existingItem.historicalContext?.length || 0)
                    ? prepared.historicalContext
                    : existingItem.historicalContext,
                images: combinedImages,
                imageUrl: combinedImages[0],
                provenance: {
                    ...existingItem.provenance,
                    ...prepared.provenance,
                    trustTier: newTier as CollectionItem['provenance']['trustTier'],
                },
                dateScanned: new Date().toISOString(),
                rarityScore: prepared.rarityScore,
                rarityDescription: prepared.rarityDescription,
                materials: prepared.materials,
                careInstructions: prepared.careInstructions,
                visualHotspots: prepared.visualHotspots,
                keyFeatures: prepared.keyFeatures,
                authenticationMarks: prepared.authenticationMarks,
                comparableSales: prepared.comparableSales,
                sellingProfile: prepared.sellingProfile,
                restoration: prepared.restoration,
                forensicInsight: prepared.forensicInsight,
                authenticityAssessment: prepared.authenticityAssessment,
                authenticityScore: prepared.authenticityScore,
                insightfulPrompts: prepared.insightfulPrompts,
                confidence: prepared.confidence,
            });

            const mergedView: CollectionItem = {
              ...existingItem,
              ...prepared,
              id: existingItem.id,
              images: combinedImages,
              imageUrl: combinedImages[0],
              provenance: updatePayload.provenance as CollectionItem['provenance'],
            };
            setSelectedItem(mergedView);
            setActiveTab('COLLECTION');

            const itemRef = doc(db, 'items', existingItem.id);
            await updateDoc(itemRef, updatePayload as any).catch(e =>
              handleFirestoreError(e, 'update', `items/${existingItem.id}`)
            );

            soundManager.playLock('high');
            toast.success("Asset Merged & Updated in Cloud");
        } else {
            const newItem = await buildVaultItem(normalized, primaryImage, user.uid);

            // Show results immediately so a vault failure still leaves the appraisal on screen
            setSelectedItem(newItem);
            setActiveTab('COLLECTION');

            if (!user.emailVerified) {
              toast.info("Appraisal ready. Verify email to permanently vault this item.");
              return;
            }

            await setDoc(doc(db, 'items', newItem.id), newItem).catch(e =>
              handleFirestoreError(e, 'create', `items/${newItem.id}`)
            );

            soundManager.playLock('standard');
            toast.success("New Asset Securely Vaulted to Cloud");
        }
    } catch (error) {
        console.error("Save error:", error);
        // Ensure the appraisal is on screen even when vault write fails mid-flight
        try {
          const fallback = await buildVaultItem(normalized, primaryImage, user.uid);
          setSelectedItem(fallback);
          setActiveTab('COLLECTION');
        } catch (displayErr) {
          console.error("Could not display scan result:", displayErr);
        }
        toast.error(vaultErrorMessage(error, user.emailVerified));
    }
  };

  const updateCollectionItem = async (result: AppraisalResult) => {
      if (!selectedItem || !user) {
          console.error("Missing selectedItem or user context for update");
          return;
      }

      try {
          const itemRef = doc(db, 'items', selectedItem.id);
          const prepared = await buildVaultItem(
            result,
            selectedItem.imageUrl,
            user.uid,
            selectedItem.id
          );

          const updatePayload = stripUndefined({
              ...prepared,
              id: selectedItem.id,
              userId: user.uid,
              updatedAt: new Date().toISOString(),
          });

          // Only send fields the security rules allow on update
          const { id: _id, userId: _uid, ...writable } = updatePayload as CollectionItem & { updatedAt?: string };
          void _id; void _uid;

          await updateDoc(itemRef, {
            ...writable,
            id: selectedItem.id,
            userId: user.uid,
          } as any).catch(e => handleFirestoreError(e, 'update', `items/${selectedItem.id}`));
          
          toast.success("Vault Sync Complete");
          setSelectedItem(prev => prev ? { ...prev, ...prepared } : null);
      } catch (error: any) {
          console.error("Update error detail:", error);
          toast.error(vaultErrorMessage(error, user.emailVerified));
      }
  };

  const deleteItem = async (id: string) => {
    try {
        await deleteDoc(doc(db, 'items', id)).catch(e => handleFirestoreError(e, 'delete', `items/${id}`));
        if (selectedItem?.id === id) setSelectedItem(null);
        toast.info("Asset Purged from Cloud Vault");
    } catch (error) {
        toast.error("Purge sequence failed");
    }
  };

  const renderContent = () => {
    if (activeTab === 'COLLECTION' && selectedItem) {
        return (
            <ItemResult 
                result={selectedItem} 
                imageData={selectedItem.imageUrl} 
                onBack={() => { setSelectedItem(null); setActiveTab('COLLECTION'); }}
                onSave={updateCollectionItem} 
            />
        );
    }

    switch (activeTab) {
      case 'SCAN': return <Scanner ref={scannerRef} onSave={saveToCollection} />;
      case 'COLLECTION': return (
        <CollectionManager 
            items={collection} 
            onDelete={deleteItem} 
            onSelect={setSelectedItem} 
            onAddItem={() => { setActiveTab('SCAN'); soundManager.playClick(); }}
        />
      );
      case 'FINANCIAL': return <MarketTrends items={collection} />;
      case 'ARCHIVE': return <ArchiveTerminal />;
      case 'ACCOUNT': return <ProfileTerminal />;
      default: return <Scanner ref={scannerRef} onSave={saveToCollection} />;
    }
  };

  if (authLoading || isBooting) {
      return (
          <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-[999] text-emerald-500 font-mono">
              <div className="w-64 relative">
                  <div className="flex justify-between items-end mb-2">
                      <h1 className="text-xl font-display text-white tracking-widest">CURATOR<span className="text-emerald-500">_OS</span></h1>
                      <span className="text-xs">v4.1.0</span>
                  </div>
                  <div className="h-1 bg-zinc-800 w-full mb-4 overflow-hidden">
                      <div className="h-full bg-emerald-500 animate-[loading_2.4s_ease-in-out_forwards]"></div>
                  </div>
                  <div className="space-y-1">
                      <div className={`flex items-center gap-2 text-xs transition-opacity duration-300 ${bootStep >= 0 || authLoading ? 'opacity-100' : 'opacity-0'}`}>
                          <Cpu size={12} /> <span>INITIALIZING CORE...</span> <span className="text-white ml-auto">OK</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs transition-opacity duration-300 ${bootStep >= 1 || authLoading ? 'opacity-100' : 'opacity-0'}`}>
                          <Globe size={12} /> <span>GEMINI VISION LINK...</span> <span className="text-white ml-auto">SECURE</span>
                      </div>
                      <div className={`flex items-center gap-2 text-xs transition-opacity duration-300 ${bootStep >= 2 || (authLoading && !isBooting) ? 'opacity-100' : 'opacity-0'}`}>
                          <Fingerprint size={12} /> <span>{authLoading ? 'AUTH_HANDSHAKE...' : 'BIOMETRIC KEYS...'}</span> <span className="text-white ml-auto">{authLoading ? '...' : 'VERIFIED'}</span>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  if (!user) {
      return (
          <>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
            <AuthScreen />
          </>
      );
  }

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-black text-zinc-100 font-sans selection:bg-white/20">
      
      {/* Toast Overlay */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Global Ambient Glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-500/5 blur-[160px] rounded-full mix-blend-screen animate-pulse"></div>
          <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-emerald-500/5 blur-[160px] rounded-full mix-blend-screen animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <main className="flex-1 relative overflow-hidden flex flex-col z-10 animate-in fade-in duration-1000">
        {renderContent()}
      </main>

      {/* Floating Island Navigation */}
      {!(activeTab === 'COLLECTION' && selectedItem) && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-8 duration-700">
             <div className="bg-zinc-900/40 backdrop-blur-3xl border border-white/5 rounded-full p-2 flex items-center gap-2 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                
                <button 
                  onClick={() => { setActiveTab('COLLECTION'); soundManager.playClick(); }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 relative group ${activeTab === 'COLLECTION' ? 'bg-white/10 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <Box size={18} strokeWidth={activeTab === 'COLLECTION' ? 2 : 1} />
                </button>
 
                <button 
                  onClick={() => { 
                      if (activeTab === 'SCAN' && scannerRef.current) {
                          // Try to trigger internal file input using a standard query selector to avoid passing refs down heavily if we can simply find it
                          const fileInput = document.getElementById('gallery-upload-input');
                          if (fileInput) fileInput.click();
                      }
                  }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 relative group text-zinc-500 hover:text-zinc-300 ${activeTab !== 'SCAN' ? 'hidden md:flex opacity-50' : 'flex'}`}
                  title="Upload from Device"
                >
                  <ImageIcon size={18} strokeWidth={1.5} className="group-hover:-translate-y-0.5 transition-transform" />
                </button>

                <button 
                  onClick={() => { 
                      if (activeTab === 'SCAN') {
                          scannerRef.current?.capture();
                      } else {
                          setActiveTab('SCAN'); 
                          soundManager.playClick(); 
                      }
                  }}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl relative group ${activeTab === 'SCAN' ? 'bg-white text-black scale-110 shadow-[0_0_30px_rgba(255,255,255,0.3)]' : 'bg-zinc-800/80 text-zinc-400 border border-white/5 hover:bg-zinc-700'}`}
                >
                  <ScanLine size={20} className={activeTab === 'SCAN' ? 'animate-pulse' : 'group-hover:scale-110 transition-transform'} />
                </button>
 
                <button 
                  onClick={() => { setActiveTab('FINANCIAL'); soundManager.playClick(); }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 relative group ${activeTab === 'FINANCIAL' ? 'bg-white/10 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <BarChart3 size={18} strokeWidth={activeTab === 'FINANCIAL' ? 2 : 1} />
                </button>

                <button 
                  onClick={() => { setActiveTab('ARCHIVE'); soundManager.playClick(); }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 relative group ${activeTab === 'ARCHIVE' ? 'bg-white/10 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <Database size={18} strokeWidth={activeTab === 'ARCHIVE' ? 2 : 1} />
                </button>

                <button 
                  onClick={() => { setActiveTab('ACCOUNT'); soundManager.playClick(); }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 relative group ${activeTab === 'ACCOUNT' ? 'bg-white/10 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  <UserIcon size={18} strokeWidth={activeTab === 'ACCOUNT' ? 2 : 1} />
                </button>
 
             </div>
          </div>
      )}
    </div>
  );
};

export default App;
