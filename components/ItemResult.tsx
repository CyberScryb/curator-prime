import React, { useEffect, useMemo, useState } from 'react';
import {
  AppraisalResult,
  VisualHotspot,
} from '../types';
import {
  askCurator,
  executeItemTool,
  generateDynamicPrompts,
  generateRestorationPreview,
} from '../services/geminiService';
import {
  ArrowLeft,
  MessageCircle,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  DollarSign,
  Sparkles,
  Wrench,
  Send,
  Share2,
  Printer,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from './Toast';
import { soundManager } from '../services/soundService';
import { AskCuratorChat } from './ItemResult/AskCuratorChat';

interface ItemResultProps {
  result: AppraisalResult;
  imageData: string;
  onBack: () => void;
  onSave: (result: AppraisalResult) => void;
}

type TabId = 'overview' | 'value' | 'authenticity' | 'care' | 'sell';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'value', label: 'Value' },
  { id: 'authenticity', label: 'Authenticity' },
  { id: 'care', label: 'Care' },
  { id: 'sell', label: 'Sell' },
];

function money(n: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n || 0);
  } catch {
    return `$${Math.round(n || 0).toLocaleString()}`;
  }
}

function confPct(c: number) {
  if (!Number.isFinite(c)) return 0;
  return c > 0 && c <= 1 ? Math.round(c * 100) : Math.round(Math.min(100, Math.max(0, c)));
}

export const ItemResult: React.FC<ItemResultProps> = ({ result, imageData, onBack, onSave }) => {
  const [item, setItem] = useState(result);
  const [tab, setTab] = useState<TabId>('overview');
  const [activeSpot, setActiveSpot] = useState<VisualHotspot | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: string; text: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [prompts, setPrompts] = useState<string[]>(result.insightfulPrompts?.slice(0, 3) || []);
  const [copied, setCopied] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [toolOut, setToolOut] = useState<string | null>(null);
  const [restoreImg, setRestoreImg] = useState<string | null>(
    result.restoration?.simulationImage || null
  );
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [listing, setListing] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    setItem(result);
    setPrompts(result.insightfulPrompts?.slice(0, 3) || []);
  }, [result]);

  const photo = item.images?.[0] || imageData;
  const confidence = confPct(item.confidence);
  const authScore = confPct(item.authenticityScore ?? item.confidence);

  const mid = item.valuation?.mid ?? 0;
  const low = item.valuation?.low ?? 0;
  const high = item.valuation?.high ?? 0;
  const currency = item.valuation?.currency || 'USD';

  const trustLabel = useMemo(() => {
    const t = item.provenance?.trustTier || 'Level 1 (Snapshot)';
    if (t.includes('3')) return 'Strong evidence';
    if (t.includes('2')) return 'Good evidence';
    return 'Single photo';
  }, [item.provenance?.trustTier]);

  const copyText = async (text: string, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(label);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };

  const handleChat = async (text?: string) => {
    const q = (text || chatInput).trim();
    if (!q) return;
    setChatInput('');
    setShowChat(true);
    setChatHistory((h) => [...h, { role: 'user', text: q }]);
    setChatLoading(true);
    try {
      const ans = await askCurator(item, q);
      setChatHistory((h) => [...h, { role: 'model', text: ans }]);
    } catch (e: any) {
      setChatHistory((h) => [
        ...h,
        { role: 'model', text: e?.message || 'Sorry — chat is unavailable right now.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const runTool = async (id: string) => {
    setToolBusy(id);
    setToolOut(null);
    try {
      const out = await executeItemTool(item, id);
      setToolOut(out);
    } catch (e: any) {
      setToolOut(e?.message || 'That tool failed. Try again.');
    } finally {
      setToolBusy(null);
    }
  };

  const buildListing = async () => {
    // Prefer data we already have
    const existingTitle = item.sellingProfile?.listingTitle;
    const existingBody = item.sellingProfile?.listingDescription;
    if (existingTitle && existingBody && existingTitle !== 'Item for Sale') {
      setListing({ title: existingTitle, body: existingBody });
      return;
    }
    setToolBusy('listing');
    try {
      const [title, body] = await Promise.all([
        executeItemTool(item, 'LISTING_TITLE_ONLY'),
        executeItemTool(item, 'LISTING_DESCRIPTION_ONLY'),
      ]);
      setListing({ title: title.trim(), body: body.trim() });
      const next = {
        ...item,
        sellingProfile: {
          ...item.sellingProfile,
          listingTitle: title.trim(),
          listingDescription: body.trim(),
        },
      };
      setItem(next);
      onSave(next);
    } catch {
      toast.error('Could not generate listing');
    } finally {
      setToolBusy(null);
    }
  };

  const genRestore = async () => {
    setRestoreBusy(true);
    try {
      const img = await generateRestorationPreview(item);
      if (img) {
        setRestoreImg(img);
        const next = {
          ...item,
          restoration: { ...item.restoration, simulationImage: img },
        };
        setItem(next);
        onSave(next);
        toast.success('Restored preview ready');
      } else {
        toast.info('Image preview unavailable — see care steps below instead');
        await runTool('CARE_GUIDE');
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  const refreshPrompts = async () => {
    try {
      const p = await generateDynamicPrompts(item);
      setPrompts(p);
    } catch {
      /* keep existing */
    }
  };

  const shareSummary = async () => {
    const text = `${item.itemName}\n${item.era} · ${item.origin}\nEst. value: ${money(mid, currency)} (${money(low, currency)}–${money(high, currency)})\nCondition: ${item.condition}\nAuthenticity: ${authScore}%\n\nScanned with Curator Prime`;
    if (navigator.share) {
      try {
        await navigator.share({ title: item.itemName, text });
        return;
      } catch {
        /* fall through */
      }
    }
    copyText(text, 'Summary copied');
  };

  const printDossier = () => {
    const w = window.open('', '', 'width=800,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${item.itemName}</title>
      <style>body{font-family:system-ui;padding:32px;color:#111;max-width:720px;margin:0 auto}
      h1{font-size:28px;margin:0 0 8px} .meta{color:#666;margin-bottom:24px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}
      .card{border:1px solid #ddd;border-radius:12px;padding:12px}
      img{max-width:100%;border-radius:12px;margin:16px 0}</style></head><body>
      <h1>${item.itemName}</h1>
      <div class="meta">${item.classification} · ${item.era} · ${item.origin}</div>
      <img src="${photo}" alt=""/>
      <div class="grid">
        <div class="card"><b>Value</b><br/>${money(mid, currency)}<br/><small>${money(low)} – ${money(high)}</small></div>
        <div class="card"><b>Condition</b><br/>${item.condition} (${item.conditionScore}/10)</div>
        <div class="card"><b>Authenticity</b><br/>${authScore}% confident</div>
        <div class="card"><b>Materials</b><br/>${item.materials}</div>
      </div>
      <p>${item.historicalContext || ''}</p>
      <p><b>Care:</b> ${item.careInstructions || ''}</p>
      <p><small>Curator Prime dossier · ${new Date().toLocaleDateString()}</small></p>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="h-full bg-canvas text-ink flex flex-col relative overflow-hidden">
      {/* Header */}
      <header className="shrink-0 z-40 border-b border-line bg-surface/90 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => {
              soundManager.playClick();
              onBack();
            }}
            className="flex items-center gap-2 text-sm text-mute hover:text-ink transition-colors"
          >
            <ArrowLeft size={18} /> Back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={shareSummary}
              className="p-2.5 rounded-full border border-line bg-elevated text-mute hover:text-ink"
              title="Share"
            >
              <Share2 size={16} />
            </button>
            <button
              onClick={printDossier}
              className="p-2.5 rounded-full border border-line bg-elevated text-mute hover:text-ink"
              title="Print"
            >
              <Printer size={16} />
            </button>
            <button
              onClick={() => setShowChat(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-brand text-white text-sm font-semibold shadow-glow"
            >
              <MessageCircle size={16} /> Ask
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 pb-3 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
                tab === t.id
                  ? 'bg-ink text-canvas'
                  : 'bg-elevated text-mute hover:text-ink border border-line'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-28">
        {/* Hero */}
        <div className="relative">
          <div className="aspect-[4/3] bg-elevated overflow-hidden">
            <img src={photo} alt={item.itemName} className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-canvas via-canvas/80 to-transparent p-5 pt-20">
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-brand/20 text-brandsoft border border-brand/30">
                {item.classification}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-elevated text-mute border border-line">
                {trustLabel}
              </span>
            </div>
            <h1 className="font-display text-2xl md:text-3xl text-ink leading-tight mb-1">
              {item.itemName}
            </h1>
            <p className="text-sm text-mute">
              {item.era}
              {item.origin ? ` · ${item.origin}` : ''}
            </p>
          </div>
        </div>

        <div className="px-4 space-y-4 mt-2">
          {/* Snapshot strip */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-line bg-elevated p-3">
              <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Est. value</div>
              <div className="font-display text-lg text-ink">{money(mid, currency)}</div>
            </div>
            <div className="rounded-2xl border border-line bg-elevated p-3">
              <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Condition</div>
              <div className="font-display text-lg text-ink">{item.conditionScore}/10</div>
            </div>
            <div className="rounded-2xl border border-line bg-elevated p-3">
              <div className="text-[10px] uppercase tracking-wider text-faint mb-1">Authentic</div>
              <div className="font-display text-lg text-ink">{authScore}%</div>
            </div>
          </div>

          {tab === 'overview' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <section className="rounded-2xl border border-line bg-surface p-4">
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Sparkles size={14} className="text-brandsoft" /> What it is
                </h2>
                <p className="text-sm text-mute leading-relaxed">
                  {item.historicalContext || 'No historical notes available.'}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-elevated border border-line p-3">
                    <div className="text-faint mb-0.5">Materials</div>
                    <div className="text-ink">{item.materials || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-elevated border border-line p-3">
                    <div className="text-faint mb-0.5">Category</div>
                    <div className="text-ink">{item.category || '—'}</div>
                  </div>
                </div>
              </section>

              {item.keyFeatures && item.keyFeatures.length > 0 && (
                <section className="rounded-2xl border border-line bg-surface p-4">
                  <h2 className="text-sm font-semibold mb-3">Key features</h2>
                  <ul className="space-y-2">
                    {item.keyFeatures.map((f, i) => (
                      <li key={i} className="flex gap-2 text-sm text-mute">
                        <ChevronRight size={14} className="text-brandsoft shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {item.visualHotspots && item.visualHotspots.length > 0 && (
                <section className="rounded-2xl border border-line bg-surface p-4">
                  <h2 className="text-sm font-semibold mb-3">Points of interest</h2>
                  <div className="relative rounded-xl overflow-hidden border border-line mb-3 aspect-square max-h-64">
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                    {item.visualHotspots.map((spot, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveSpot(activeSpot === spot ? null : spot)}
                        className={`absolute w-7 h-7 -ml-3.5 -mt-3.5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-transform ${
                          activeSpot === spot
                            ? 'bg-brand border-white text-white scale-110'
                            : 'bg-black/60 border-white/80 text-white'
                        }`}
                        style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  {activeSpot ? (
                    <div className="rounded-xl bg-elevated border border-line p-3">
                      <div className="text-xs font-semibold text-brandsoft mb-1">{activeSpot.label}</div>
                      <p className="text-sm text-mute">{activeSpot.description}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-faint">Tap a marker to learn more.</p>
                  )}
                </section>
              )}

              <section className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold">Suggested questions</h2>
                  <button onClick={refreshPrompts} className="text-faint hover:text-ink p-1">
                    <RefreshCw size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(prompts.length ? prompts : ['Is this authentic?', 'How should I price it?', 'How do I care for it?']).map(
                    (p, i) => (
                      <button
                        key={i}
                        onClick={() => handleChat(p)}
                        className="text-left text-xs px-3 py-2 rounded-full border border-line bg-elevated text-mute hover:text-ink hover:border-brand/40 transition-colors"
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
              </section>
            </div>
          )}

          {tab === 'value' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <section className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-center gap-2 text-brandsoft mb-1">
                  <DollarSign size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wider">Estimated range</span>
                </div>
                <div className="font-display text-4xl text-ink my-2">{money(mid, currency)}</div>
                <p className="text-sm text-mute">
                  Typical range {money(low, currency)} – {money(high, currency)}
                </p>
                <div className="mt-4 h-2 rounded-full bg-elevated overflow-hidden relative">
                  <div className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-faint/30 via-brandsoft/50 to-faint/30" />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-ink border-2 border-brand"
                    style={{
                      left: `${
                        high > low
                          ? Math.min(95, Math.max(5, ((mid - low) / (high - low)) * 100))
                          : 50
                      }%`,
                    }}
                  />
                </div>
                <p className="text-[11px] text-faint mt-3">
                  Confidence in ID: {confidence}% · Not a formal appraisal
                </p>
              </section>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-line bg-elevated p-4">
                  <div className="text-[10px] uppercase text-faint mb-1">Market mood</div>
                  <div className="font-semibold">{item.forecast?.marketSentiment || 'Stable'}</div>
                </div>
                <div className="rounded-2xl border border-line bg-elevated p-4">
                  <div className="text-[10px] uppercase text-faint mb-1">Liquidity</div>
                  <div className="font-semibold">{item.forecast?.liquidityScore ?? '—'}/100</div>
                </div>
                <div className="rounded-2xl border border-line bg-elevated p-4">
                  <div className="text-[10px] uppercase text-faint mb-1">Grade</div>
                  <div className="font-semibold">{item.forecast?.investmentGrade || '—'}</div>
                </div>
                <div className="rounded-2xl border border-line bg-elevated p-4">
                  <div className="text-[10px] uppercase text-faint mb-1">Rarity</div>
                  <div className="font-semibold">{item.rarityScore}/10</div>
                </div>
              </div>

              {item.rarityDescription && (
                <p className="text-sm text-mute leading-relaxed px-1">{item.rarityDescription}</p>
              )}

              {item.comparableSales && item.comparableSales.length > 0 && (
                <section className="rounded-2xl border border-line bg-surface p-4">
                  <h2 className="text-sm font-semibold mb-3">Comparable sales</h2>
                  <div className="space-y-2">
                    {item.comparableSales.slice(0, 6).map((c, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-3 text-sm border-b border-line last:border-0 pb-2 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="text-ink truncate">{c.title}</div>
                          <div className="text-[11px] text-faint">
                            {c.source}
                            {c.date ? ` · ${c.date}` : ''}
                          </div>
                        </div>
                        <div className="font-mono text-brandsoft shrink-0">{c.price}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <button
                onClick={() => runTool('SELL_STRATEGY')}
                disabled={!!toolBusy}
                className="w-full py-3 rounded-2xl border border-line bg-elevated text-sm font-semibold hover:border-brand/40 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {toolBusy === 'SELL_STRATEGY' ? <Loader2 size={16} className="animate-spin" /> : null}
                Get sell strategy
              </button>
              {toolOut && tab === 'value' && (
                <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-mute prose prose-invert prose-sm max-w-none">
                  <Markdown>{toolOut}</Markdown>
                </div>
              )}
            </div>
          )}

          {tab === 'authenticity' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <section className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-emerald-400 mb-1">
                      <ShieldCheck size={16} />
                      <span className="text-xs font-semibold uppercase tracking-wider">Authenticity</span>
                    </div>
                    <p className="text-sm text-mute leading-relaxed mt-2">
                      {item.authenticityAssessment || 'No detailed authenticity write-up for this scan.'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display text-3xl text-ink">{authScore}%</div>
                    <div className="text-[10px] text-faint uppercase">confidence</div>
                  </div>
                </div>
              </section>

              {item.authenticationMarks && item.authenticationMarks.length > 0 && (
                <section className="rounded-2xl border border-line bg-surface p-4">
                  <h2 className="text-sm font-semibold mb-2">Marks & signatures</h2>
                  <ul className="space-y-2">
                    {item.authenticationMarks.map((m, i) => (
                      <li key={i} className="text-sm text-mute flex gap-2">
                        <span className="text-brandsoft">•</span> {m}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {item.forensicInsight && (
                <section className="rounded-2xl border border-line bg-surface p-4">
                  <h2 className="text-sm font-semibold mb-2">Closer look</h2>
                  <p className="text-sm text-mute leading-relaxed">{item.forensicInsight}</p>
                </section>
              )}

              <div className="rounded-2xl border border-line bg-elevated p-4 text-xs text-faint font-mono break-all">
                <div className="text-mute mb-1 font-sans font-semibold">Evidence ID</div>
                {item.provenance?.digitalHash || '—'}
              </div>

              <button
                onClick={() => runTool('AUTH_CHECKLIST')}
                disabled={!!toolBusy}
                className="w-full py-3 rounded-2xl bg-brand text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {toolBusy === 'AUTH_CHECKLIST' ? <Loader2 size={16} className="animate-spin" /> : null}
                Get buyer checklist
              </button>
              {toolOut && tab === 'authenticity' && (
                <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-mute prose prose-invert prose-sm max-w-none">
                  <Markdown>{toolOut}</Markdown>
                </div>
              )}
            </div>
          )}

          {tab === 'care' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <section className="rounded-2xl border border-line bg-surface p-4">
                <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Wrench size={14} className="text-brandsoft" /> Condition
                </h2>
                <p className="text-sm text-ink font-medium mb-1">
                  {item.condition} · {item.conditionScore}/10
                </p>
                <p className="text-sm text-mute leading-relaxed">{item.careInstructions}</p>
              </section>

              <section className="rounded-2xl border border-line bg-surface p-4">
                <h2 className="text-sm font-semibold mb-2">Restoration outlook</h2>
                <p className="text-sm text-mute leading-relaxed mb-3">
                  {item.restoration?.restorationPotential || 'Not assessed'}
                </p>
                {typeof item.restoration?.estimatedCost === 'number' && item.restoration.estimatedCost > 0 && (
                  <p className="text-sm text-ink mb-3">
                    Rough restore cost: <strong>{money(item.restoration.estimatedCost, currency)}</strong>
                  </p>
                )}
                {item.restoration?.recommendedActions?.length > 0 && (
                  <ul className="space-y-2 mb-4">
                    {item.restoration.recommendedActions.map((a, i) => (
                      <li key={i} className="text-sm text-mute flex gap-2">
                        <span className="text-brandsoft font-mono text-xs mt-0.5">0{i + 1}</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                )}

                {restoreImg ? (
                  <img
                    src={restoreImg}
                    alt="Restored preview"
                    className="w-full rounded-xl border border-line object-cover aspect-square"
                  />
                ) : (
                  <button
                    onClick={genRestore}
                    disabled={restoreBusy}
                    className="w-full py-3 rounded-2xl border border-brand/40 bg-brand/10 text-brandsoft text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {restoreBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    Preview restored look
                  </button>
                )}
              </section>

              <button
                onClick={() => runTool('CARE_GUIDE')}
                disabled={!!toolBusy}
                className="w-full py-3 rounded-2xl border border-line bg-elevated text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {toolBusy === 'CARE_GUIDE' ? <Loader2 size={16} className="animate-spin" /> : null}
                Full care guide
              </button>
              {toolOut && tab === 'care' && (
                <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-mute prose prose-invert prose-sm max-w-none">
                  <Markdown>{toolOut}</Markdown>
                </div>
              )}
            </div>
          )}

          {tab === 'sell' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <section className="rounded-2xl border border-line bg-surface p-4">
                <h2 className="text-sm font-semibold mb-2">Where to sell</h2>
                <p className="text-sm text-ink mb-1">
                  {item.sellingProfile?.recommendedVenue || 'Online marketplace'}
                </p>
                <p className="text-sm text-mute">
                  {item.sellingProfile?.pricingStrategy || 'Price near mid estimate; leave room to negotiate.'}
                </p>
              </section>

              <button
                onClick={buildListing}
                disabled={!!toolBusy}
                className="w-full py-3.5 rounded-2xl bg-brand text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 shadow-glow"
              >
                {toolBusy === 'listing' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {listing ? 'Regenerate listing' : 'Generate listing'}
              </button>

              {listing && (
                <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase text-faint">Title</span>
                      <button
                        onClick={() => copyText(listing.title, 'Title copied')}
                        className="text-brandsoft text-xs flex items-center gap-1"
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />} Copy
                      </button>
                    </div>
                    <p className="text-sm font-medium text-ink">{listing.title}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase text-faint">Description</span>
                      <button
                        onClick={() => copyText(listing.body, 'Description copied')}
                        className="text-brandsoft text-xs flex items-center gap-1"
                      >
                        <Copy size={12} /> Copy
                      </button>
                    </div>
                    <p className="text-sm text-mute whitespace-pre-wrap leading-relaxed">{listing.body}</p>
                  </div>
                  <button
                    onClick={() =>
                      copyText(`${listing.title}\n\n${listing.body}`, 'Full listing copied')
                    }
                    className="w-full py-2.5 rounded-xl border border-line text-sm font-semibold"
                  >
                    Copy full listing
                  </button>
                </section>
              )}

              {item.sellingProfile?.keywords && item.sellingProfile.keywords.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {item.sellingProfile.keywords.map((k, i) => (
                    <span
                      key={i}
                      className="text-[11px] px-2.5 py-1 rounded-full bg-elevated border border-line text-mute"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky chat dock */}
      {!showChat && (
        <div className="absolute bottom-0 inset-x-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-canvas via-canvas/95 to-transparent">
          <div className="flex gap-2 max-w-lg mx-auto">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
              placeholder="Ask about this item…"
              className="flex-1 px-4 py-3.5 rounded-2xl bg-elevated border border-line text-sm text-ink outline-none focus:border-brandsoft/50"
            />
            <button
              onClick={() => handleChat()}
              disabled={!chatInput.trim() || chatLoading}
              className="w-12 h-12 rounded-2xl bg-brand text-white flex items-center justify-center disabled:opacity-40"
            >
              {chatLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      )}

      <AskCuratorChat
        showChat={showChat}
        setShowChat={setShowChat}
        chatHistory={chatHistory}
        isChatLoading={chatLoading}
        chatInput={chatInput}
        setChatInput={setChatInput}
        handleChat={handleChat}
      />
    </div>
  );
};
