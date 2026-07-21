import { CollectionItemSchema } from './schemas';
import { AppraisalResult, CollectionItem } from '../types';
import { compressImage } from './imageUtils';

/** Firestore rejects undefined and non-finite numbers. */
export function stripUndefined<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === 'number' && !Number.isFinite(v)) return 0;
      return v;
    })
  ) as T;
}

const CLASSIFICATIONS = new Set(['Antique', 'Vintage', 'Modern', 'New', 'Specialty']);
const SENTIMENTS = new Set(['Bullish', 'Bearish', 'Stable']);
const GRADES = new Set(['AAA', 'AA', 'A', 'B', 'C']);
const TIERS = new Set(['Level 1 (Snapshot)', 'Level 2 (Visual)', 'Level 3 (Verified)']);
const CHAINS = new Set(['Unregistered', 'Minted']);

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, x));
}

/** Normalize AI output so Firestore security rules accept the document. */
export function normalizeAppraisal(result: AppraisalResult): AppraisalResult {
  const classification = CLASSIFICATIONS.has(result.classification as string)
    ? result.classification
    : 'Specialty';

  const trustTier = TIERS.has(result.provenance?.trustTier as string)
    ? result.provenance.trustTier
    : 'Level 1 (Snapshot)';

  const chainStatus = CHAINS.has(result.provenance?.chainStatus as string)
    ? result.provenance.chainStatus
    : 'Unregistered';

  const marketSentiment = SENTIMENTS.has(result.forecast?.marketSentiment as string)
    ? result.forecast.marketSentiment
    : 'Stable';

  const investmentGrade = GRADES.has(result.forecast?.investmentGrade as string)
    ? result.forecast.investmentGrade
    : 'C';

  return {
    ...result,
    itemName: (result.itemName || 'Unknown Item').slice(0, 500),
    category: (result.category || 'Uncategorized').slice(0, 100),
    classification: classification as AppraisalResult['classification'],
    era: result.era || 'Unknown Era',
    origin: result.origin || 'Unknown Origin',
    condition: result.condition || 'Unknown Condition',
    conditionScore: clamp(result.conditionScore, 1, 10, 5),
    rarityScore: clamp(result.rarityScore, 1, 10, 5),
    rarityDescription: result.rarityDescription || 'Rarity not assessed.',
    valuation: {
      low: clamp(result.valuation?.low, 0, 1e12, 0),
      mid: clamp(result.valuation?.mid, 0, 1e12, 0),
      high: clamp(result.valuation?.high, 0, 1e12, 0),
      currency: result.valuation?.currency || 'USD',
      unit: result.valuation?.unit,
    },
    visualHotspots: Array.isArray(result.visualHotspots) ? result.visualHotspots : [],
    historicalContext: result.historicalContext || '',
    materials: result.materials || '',
    careInstructions: result.careInstructions || '',
    comparableSales: Array.isArray(result.comparableSales) ? result.comparableSales : [],
    sellingProfile: result.sellingProfile || {
      listingTitle: result.itemName || 'Item for Sale',
      listingDescription: '',
      keywords: [],
      recommendedVenue: 'Online Marketplace',
      pricingStrategy: 'Market Value',
    },
    forecast: {
      liquidityScore: clamp(result.forecast?.liquidityScore, 0, 100, 50),
      fiveYearProjection: Array.isArray(result.forecast?.fiveYearProjection)
        ? result.forecast.fiveYearProjection
        : [],
      marketSentiment: marketSentiment as AppraisalResult['forecast']['marketSentiment'],
      investmentGrade: investmentGrade as AppraisalResult['forecast']['investmentGrade'],
    },
    restoration: result.restoration || {
      restorationPotential: 'Not Assessed',
      estimatedCost: 0,
      recommendedActions: [],
      perfectStateDescription: 'Not Assessed',
    },
    provenance: {
      digitalHash: result.provenance?.digitalHash || '',
      chainStatus: chainStatus as AppraisalResult['provenance']['chainStatus'],
      trustTier: trustTier as AppraisalResult['provenance']['trustTier'],
    },
    insightfulPrompts: Array.isArray(result.insightfulPrompts) ? result.insightfulPrompts : [],
    confidence: clamp(result.confidence, 0, 100, 0),
    images: result.images,
  };
}

/** Compress evidence images so the Firestore doc stays under the 1MB limit. */
export async function compressEvidenceImages(
  images: string[],
  maxEachBytes = 180_000
): Promise<string[]> {
  const out: string[] = [];
  for (const img of images.slice(0, 6)) {
    let quality = 0.45;
    let maxWidth = 640;
    let compressed = await compressImage(img, maxWidth, quality);

    // Progressive downscale if still large (phone photos often are)
    let guard = 0;
    while (compressed.length > maxEachBytes && guard < 5) {
      quality = Math.max(0.25, quality - 0.08);
      maxWidth = Math.max(280, Math.round(maxWidth * 0.75));
      compressed = await compressImage(img, maxWidth, quality);
      guard++;
    }
    out.push(compressed);
  }
  return out.length ? out : [await compressImage(images[0] || '', 400, 0.35)];
}

export async function buildVaultItem(
  result: AppraisalResult,
  primaryImage: string,
  userId: string,
  existingId?: string
): Promise<CollectionItem> {
  const normalized = normalizeAppraisal(result);
  const rawImages = (normalized.images?.length ? normalized.images : [primaryImage]).filter(Boolean);
  const compressedImages = await compressEvidenceImages(rawImages);

  const { images: _dropFullRes, ...appraisalFields } = normalized;
  void _dropFullRes;

  const draft: CollectionItem = {
    ...appraisalFields,
    id: existingId || crypto.randomUUID(),
    userId,
    dateScanned: new Date().toISOString(),
    imageUrl: compressedImages[0] || primaryImage || '',
    images: compressedImages.filter(Boolean),
  };

  const parsed = CollectionItemSchema.safeParse(draft);
  if (parsed.success) {
    return stripUndefined(parsed.data as CollectionItem);
  }

  console.warn('Vault schema soft-fail, using normalized draft:', parsed.error);
  return stripUndefined(draft);
}

export function vaultErrorMessage(error: unknown, emailVerified?: boolean): string {
  const err = error as { code?: string; message?: string };
  const msg = err?.message || String(error || 'Unknown error');

  if (err?.code === 'permission-denied' || msg.includes('permission-denied') || msg.includes('Missing or insufficient permissions')) {
    if (emailVerified === false) {
      return 'Verify your email to save to the vault. Results are shown below.';
    }
    return 'Vault permission denied. Sign in again or verify email. Results are shown below.';
  }

  if (msg.includes('exceeds the maximum') || msg.includes('too large') || msg.includes('INVALID_ARGUMENT')) {
    return 'Photo too large for vault storage. Results are shown — try a smaller photo to save.';
  }

  // handleFirestoreError stringifies permission info as JSON
  try {
    const parsed = JSON.parse(msg);
    if (parsed?.error) {
      return `Vault save failed: ${parsed.error}. Results still available.`;
    }
  } catch {
    /* not JSON */
  }

  return `Vault save failed: ${msg.slice(0, 120)}. Results are still shown.`;
}
