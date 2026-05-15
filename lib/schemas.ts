import { z } from 'zod';

export const VisualHotspotSchema = z.object({
  x: z.number(),
  y: z.number(),
  label: z.string(),
  description: z.string(),
  type: z.enum(['damage', 'signature', 'material', 'design']).optional(),
});

export const ItemClassificationSchema = z.enum(['Antique', 'Vintage', 'Modern', 'New', 'Specialty']);

export const AppraisalResultSchema = z.object({
  itemName: z.string(),
  category: z.string().catch('Uncategorized'),
  classification: ItemClassificationSchema.catch('Specialty'),
  era: z.string().catch('Unknown Era'),
  origin: z.string().catch('Unknown Origin'),
  condition: z.string().catch('Unknown Condition'),
  conditionScore: z.number().catch(5),
  rarityScore: z.number().catch(5),
  rarityDescription: z.string().catch('Rarity not assessed.'),
  valuation: z.object({
    low: z.number().catch(0),
    mid: z.number().catch(0),
    high: z.number().catch(0),
    currency: z.string().catch('USD'),
    unit: z.string().optional(),
  }).catch({ low: 0, mid: 0, high: 0, currency: 'USD' }),
  authenticationMarks: z.array(z.string()).optional(),
  keyFeatures: z.array(z.string()).optional(),
  visualHotspots: z.array(VisualHotspotSchema).catch([]),
  historicalContext: z.string().catch('Historical context not available.'),
  materials: z.string().catch('Materials unknown.'),
  careInstructions: z.string().catch('Care instructions not provided.'),
  comparableSales: z.array(
    z.object({
      title: z.string().catch('Unknown'),
      price: z.string().catch('$0'),
      date: z.string().catch('Unknown'),
      link: z.string().catch('#'),
      source: z.string().catch('Unknown'),
    })
  ).catch([]),
  sellingProfile: z.object({
    listingTitle: z.string().catch('Item for Sale'),
    listingDescription: z.string().catch('Description not available.'),
    keywords: z.array(z.string()).catch([]),
    recommendedVenue: z.string().catch('Online Marketplace'),
    pricingStrategy: z.string().catch('Market Value'),
  }).catch({
    listingTitle: 'Item for Sale',
    listingDescription: 'Description not available.',
    keywords: [],
    recommendedVenue: 'Online Marketplace',
    pricingStrategy: 'Market Value'
  }),
  forecast: z.object({
    liquidityScore: z.number().catch(50),
    fiveYearProjection: z.array(
      z.object({
        year: z.string().catch(''),
        value: z.number().catch(0),
      })
    ).catch([]),
    marketSentiment: z.enum(['Bullish', 'Bearish', 'Stable']).catch('Stable'),
    investmentGrade: z.enum(['AAA', 'AA', 'A', 'B', 'C']).catch('C'),
  }).catch({
    liquidityScore: 50,
    fiveYearProjection: [],
    marketSentiment: 'Stable',
    investmentGrade: 'C'
  }),
  restoration: z.object({
    restorationPotential: z.string().catch('Not Assessed'),
    estimatedCost: z.number().catch(0),
    recommendedActions: z.array(z.string()).catch([]),
    perfectStateDescription: z.string().catch('Not Assessed'),
  }).catch({
    restorationPotential: 'Not Assessed',
    estimatedCost: 0,
    recommendedActions: [],
    perfectStateDescription: 'Not Assessed'
  }),
  provenance: z.object({
    digitalHash: z.string().catch(''),
    chainStatus: z.enum(['Unregistered', 'Minted']).catch('Unregistered'),
    trustTier: z.enum(['Level 1 (Snapshot)', 'Level 2 (Visual)', 'Level 3 (Verified)']).catch('Level 1 (Snapshot)'),
  }).catch({
    digitalHash: '',
    chainStatus: 'Unregistered',
    trustTier: 'Level 1 (Snapshot)'
  }),
  forensicInsight: z.string().optional(),
  authenticityAssessment: z.string().optional(),
  authenticityScore: z.number().optional(),
  insightfulPrompts: z.array(z.string()).catch([]),
  confidence: z.number().catch(0),
  images: z.array(z.string()).optional(),
});

export const CollectionItemSchema = AppraisalResultSchema.extend({
  id: z.string(),
  userId: z.string(),
  dateScanned: z.string(),
  imageUrl: z.string(),
  images: z.array(z.string()).optional(),
  userNotes: z.string().optional(),
  seller: z.string().optional(),
});
