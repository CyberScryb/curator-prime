
import React, { useState, useEffect, useRef } from 'react';
import { AppTab, CollectionItem, AppraisalResult } from './types';
import { CollectionItemSchema } from './lib/schemas';
import { Scanner, ScannerRef, ScanResultMeta } from './components/ScanTerminal';
import { CollectionManager } from './components/VaultTerminal';
import { MarketTrends } from './components/DataTerminal';
import { ItemResult } from './components/ItemResult';
import { AuthScreen } from './components/AuthScreen';
import { ProfileTerminal } from './components/ProfileTerminal';
import { ArchiveTerminal } from './components/ArchiveTerminal';
import { ScanLine, Box, BarChart3, Database, User as UserIcon, Image as ImageIcon } from 'lucide-react';
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
  /** Tracks in-progress scan so Pro can upgrade a Flash quick answer */
  const refineSessionRef = useRef<{ sessionId: string; itemId: string } | null>(null);

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

  const saveToCollection = async (
    result: AppraisalResult,
    primaryImage: string,
    meta?: ScanResultMeta
  ) => {
    if (!user) {
      toast.error("Sign in required to vault items");
      return;
    }

    const normalized = normalizeAppraisal(result);
    (normalized as any).analysisTier = (result as any).analysisTier || meta?.phase || "full";

    // Pro refining a Flash result for this scan session → update same item id
    const refine = refineSessionRef.current;
    const isRefinement =
      meta?.phase === "full" &&
      refine &&
      meta.sessionId === refine.sessionId;

    const existingIndex = isRefinement
      ? collection.findIndex((i) => i.id === refine!.itemId)
      : collection.findIndex(
          (item) =>
            item.itemName === normalized.itemName &&
            item.era === normalized.era &&
            item.classification === normalized.classification
        );

    // Always surface appraisal results first — vault write is secondary.
    try {
        if (isRefinement || existingIndex > -1) {
            const existingItem =
              isRefinement
                ? collection.find((i) => i.id === refine!.itemId) ||
                  (selectedItem?.id === refine!.itemId ? selectedItem : null)
                : collection[existingIndex];
            const itemId = existingItem?.id || refine!.itemId;
            const prepared = await buildVaultItem(
              normalized,
              primaryImage,
              user.uid,
              itemId
            );
            const existingImages = existingItem?.images || (existingItem?.imageUrl ? [existingItem.imageUrl] : []);
            const combinedImages = Array.from(
              new Set([...existingImages, ...(prepared.images || [prepared.imageUrl])].filter(Boolean))
            ).slice(0, 8);

            let newTier = existingItem?.provenance?.trustTier || 'Level 1 (Snapshot)';
            if (combinedImages.length >= 3) newTier = 'Level 3 (Verified)';
            else if (combinedImages.length === 2) newTier = 'Level 2 (Visual)';

            const updatePayload = stripUndefined({
                ...prepared,
                id: itemId,
                userId: user.uid,
                images: combinedImages,
                imageUrl: combinedImages[0] || prepared.imageUrl,
                provenance: {
                    ...(existingItem?.provenance || prepared.provenance),
                    ...prepared.provenance,
                    trustTier: newTier as CollectionItem['provenance']['trustTier'],
                },
                dateScanned: new Date().toISOString(),
                analysisTier: 'full',
            });

            const mergedView: CollectionItem = {
              ...(existingItem || prepared),
              ...prepared,
              id: itemId,
              userId: user.uid,
              images: combinedImages,
              imageUrl: combinedImages[0] || prepared.imageUrl,
              provenance: updatePayload.provenance as CollectionItem['provenance'],
              analysisTier: 'full',
            };
            setSelectedItem(mergedView);
            setActiveTab('COLLECTION');
            if (isRefinement) refineSessionRef.current = null;

            if (user.emailVerified) {
              const itemRef = doc(db, 'items', itemId);
              // Prefer setDoc merge so refine works even if fast path never wrote
              await setDoc(itemRef, updatePayload as any, { merge: true }).catch(e =>
                handleFirestoreError(e, 'update', `items/${itemId}`)
              );
            }

            soundManager.playLock('high');
            if (!isRefinement) toast.success("Updated in your collection");
        } else {
            const newItem = await buildVaultItem(normalized, primaryImage, user.uid);
            (newItem as any).analysisTier = meta?.phase || 'full';

            setSelectedItem(newItem);
            setActiveTab('COLLECTION');

            if (meta?.phase === 'fast' && meta.sessionId) {
              refineSessionRef.current = { sessionId: meta.sessionId, itemId: newItem.id };
            }

            if (!user.emailVerified) {
              toast.info(
                meta?.phase === 'fast'
                  ? 'Quick answer ready. Verify email to save permanently.'
                  : 'Results ready. Verify your email to save permanently.'
              );
              return;
            }

            await setDoc(doc(db, 'items', newItem.id), newItem).catch(e =>
              handleFirestoreError(e, 'create', `items/${newItem.id}`)
            );

            soundManager.playLock('standard');
            if (meta?.phase !== 'fast') toast.success("Saved to your collection");
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
        toast.info("Removed from collection");
    } catch (error) {
        toast.error("Could not delete item");
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
          <div className="fixed inset-0 bg-canvas flex flex-col items-center justify-center z-[999] text-ink">
              <div className="w-72 relative text-center">
                  <div className="font-display text-2xl text-ink mb-1">Curator Prime</div>
                  <p className="text-xs text-mute mb-6">Identify · Value · Collect</p>
                  <div className="h-1 bg-elevated w-full mb-4 overflow-hidden rounded-full">
                      <div className="h-full bg-brand rounded-full" style={{ animation: 'bootbar 1.6s ease-out forwards' }} />
                  </div>
                  <p className="text-[11px] text-faint">
                    {authLoading ? 'Signing you in…' : bootStep < 2 ? 'Starting camera tools…' : 'Almost ready…'}
                  </p>
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
    <div className="flex flex-col h-[100dvh] w-full bg-canvas text-ink font-sans selection:bg-brand/30">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-15%] left-[-10%] w-[55%] h-[45%] bg-brand/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-8%] w-[45%] h-[40%] bg-trust/15 blur-[100px] rounded-full" />
      </div>

      <main className="flex-1 relative overflow-hidden flex flex-col z-10">
        {renderContent()}
      </main>

      {/* Bottom nav — plain labels under icons */}
      {!(activeTab === 'COLLECTION' && selectedItem) && (
          <nav className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 w-[min(100%-1.5rem,28rem)]">
             <div className="bg-surface/90 backdrop-blur-2xl border border-line rounded-[1.75rem] px-2 py-2 flex items-end justify-between shadow-card">
                <button
                  onClick={() => { setActiveTab('COLLECTION'); soundManager.playClick(); }}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-2xl transition-colors ${activeTab === 'COLLECTION' ? 'text-ink' : 'text-faint hover:text-mute'}`}
                >
                  <Box size={18} strokeWidth={activeTab === 'COLLECTION' ? 2.25 : 1.5} />
                  <span className="text-[9px] font-semibold">Vault</span>
                </button>

                <button
                  onClick={() => {
                      if (activeTab === 'SCAN') {
                          document.getElementById('gallery-upload-input')?.click();
                      } else {
                          setActiveTab('SCAN');
                          soundManager.playClick();
                      }
                  }}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-2xl transition-colors ${activeTab === 'SCAN' ? 'text-ink' : 'text-faint hover:text-mute'}`}
                  title="Upload photo"
                >
                  <ImageIcon size={18} strokeWidth={1.5} />
                  <span className="text-[9px] font-semibold">Upload</span>
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
                  className={`mx-1 w-14 h-14 -mt-5 rounded-full flex items-center justify-center transition-all shadow-glow ${
                    activeTab === 'SCAN'
                      ? 'bg-brand text-white scale-105'
                      : 'bg-elevated text-mute border border-line hover:text-ink'
                  }`}
                  title={activeTab === 'SCAN' ? 'Capture' : 'Scan'}
                >
                  <ScanLine size={22} />
                </button>

                <button
                  onClick={() => { setActiveTab('FINANCIAL'); soundManager.playClick(); }}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-2xl transition-colors ${activeTab === 'FINANCIAL' ? 'text-ink' : 'text-faint hover:text-mute'}`}
                >
                  <BarChart3 size={18} strokeWidth={activeTab === 'FINANCIAL' ? 2.25 : 1.5} />
                  <span className="text-[9px] font-semibold">Market</span>
                </button>

                <button
                  onClick={() => { setActiveTab('ARCHIVE'); soundManager.playClick(); }}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-2xl transition-colors ${activeTab === 'ARCHIVE' ? 'text-ink' : 'text-faint hover:text-mute'}`}
                >
                  <Database size={18} strokeWidth={activeTab === 'ARCHIVE' ? 2.25 : 1.5} />
                  <span className="text-[9px] font-semibold">Library</span>
                </button>

                <button
                  onClick={() => { setActiveTab('ACCOUNT'); soundManager.playClick(); }}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-2xl transition-colors ${activeTab === 'ACCOUNT' ? 'text-ink' : 'text-faint hover:text-mute'}`}
                >
                  <UserIcon size={18} strokeWidth={activeTab === 'ACCOUNT' ? 2.25 : 1.5} />
                  <span className="text-[9px] font-semibold">Account</span>
                </button>
             </div>
          </nav>
      )}
    </div>
  );
};

export default App;
