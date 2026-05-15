import * as admin from 'firebase-admin';

// Check if GOOGLE_APPLICATION_CREDENTIALS is set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Missing GOOGLE_APPLICATION_CREDENTIALS environment variable. Please run export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"');
  process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

async function backfill() {
  console.log('Starting backfill for items collection...');
  let updatedCount = 0;
  let skippedCount = 0;

  const itemsRef = db.collection('items');
  const snapshot = await itemsRef.get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let hasChanges = false;
    const update: any = {};

    const checkString = (key: string, defaultValue: string = '') => {
      if (data[key] === undefined || data[key] === null || typeof data[key] !== 'string') {
        update[key] = defaultValue;
        hasChanges = true;
      }
    };

    const checkNumber = (key: string, defaultValue: number = 0) => {
      if (data[key] === undefined || data[key] === null || typeof data[key] !== 'number') {
        update[key] = defaultValue;
        hasChanges = true;
      }
    };

    const checkArray = (key: string) => {
      if (!Array.isArray(data[key])) {
        update[key] = [];
        hasChanges = true;
      }
    };

    // Fields from AppraisalResultSchema
    checkString('itemName', '');
    checkString('category', '');
    
    if (!['Antique', 'Vintage', 'Modern', 'New', 'Specialty'].includes(data.classification)) {
      update.classification = 'Modern';
      hasChanges = true;
    }

    checkString('era', '');
    checkString('origin', '');
    checkString('condition', '');
    checkNumber('conditionScore', 0);
    checkNumber('rarityScore', 0);
    checkString('rarityDescription', '');

    if (!data.valuation || typeof data.valuation !== 'object') {
      update.valuation = { low: 0, mid: 0, high: 0, currency: 'USD' };
      hasChanges = true;
    } else {
      let valUpdated = false;
      const val = { ...data.valuation };
      if (typeof val.low !== 'number') { val.low = 0; valUpdated = true; }
      if (typeof val.mid !== 'number') { val.mid = 0; valUpdated = true; }
      if (typeof val.high !== 'number') { val.high = 0; valUpdated = true; }
      if (typeof val.currency !== 'string') { val.currency = 'USD'; valUpdated = true; }
      if (valUpdated) {
        update.valuation = val;
        hasChanges = true;
      }
    }

    if (data.authenticationMarks !== undefined && !Array.isArray(data.authenticationMarks)) {
      update.authenticationMarks = [];
      hasChanges = true;
    }
    if (data.keyFeatures !== undefined && !Array.isArray(data.keyFeatures)) {
      update.keyFeatures = [];
      hasChanges = true;
    }
    
    checkArray('visualHotspots');
    checkString('historicalContext', '');
    checkString('materials', '');
    checkString('careInstructions', '');
    checkArray('comparableSales');

    if (!data.sellingProfile || typeof data.sellingProfile !== 'object') {
      update.sellingProfile = {
        listingTitle: '',
        listingDescription: '',
        keywords: [],
        recommendedVenue: '',
        pricingStrategy: ''
      };
      hasChanges = true;
    } else {
        let spUpdated = false;
        const sp = { ...data.sellingProfile };
        if (typeof sp.listingTitle !== 'string') { sp.listingTitle = ''; spUpdated = true; }
        if (typeof sp.listingDescription !== 'string') { sp.listingDescription = ''; spUpdated = true; }
        if (!Array.isArray(sp.keywords)) { sp.keywords = []; spUpdated = true; }
        if (typeof sp.recommendedVenue !== 'string') { sp.recommendedVenue = ''; spUpdated = true; }
        if (typeof sp.pricingStrategy !== 'string') { sp.pricingStrategy = ''; spUpdated = true; }
        if (spUpdated) {
            update.sellingProfile = sp;
            hasChanges = true;
        }
    }

    if (!data.forecast || typeof data.forecast !== 'object') {
      update.forecast = {
        liquidityScore: 0,
        fiveYearProjection: [],
        marketSentiment: 'Stable',
        investmentGrade: 'B'
      };
      hasChanges = true;
    } else {
        let fUpdated = false;
        const f = { ...data.forecast };
        if (typeof f.liquidityScore !== 'number') { f.liquidityScore = 0; fUpdated = true; }
        if (!Array.isArray(f.fiveYearProjection)) { f.fiveYearProjection = []; fUpdated = true; }
        if (!['Bullish', 'Bearish', 'Stable'].includes(f.marketSentiment)) { f.marketSentiment = 'Stable'; fUpdated = true; }
        if (!['AAA', 'AA', 'A', 'B', 'C'].includes(f.investmentGrade)) { f.investmentGrade = 'B'; fUpdated = true; }
        if (fUpdated) {
            update.forecast = f;
            hasChanges = true;
        }
    }

    if (!data.restoration || typeof data.restoration !== 'object') {
      update.restoration = {
        restorationPotential: '',
        estimatedCost: 0,
        recommendedActions: [],
        perfectStateDescription: ''
      };
      hasChanges = true;
    } else {
        let rUpdated = false;
        const r = { ...data.restoration };
        if (typeof r.restorationPotential !== 'string') { r.restorationPotential = ''; rUpdated = true; }
        if (typeof r.estimatedCost !== 'number') { r.estimatedCost = 0; rUpdated = true; }
        if (!Array.isArray(r.recommendedActions)) { r.recommendedActions = []; rUpdated = true; }
        if (typeof r.perfectStateDescription !== 'string') { r.perfectStateDescription = ''; rUpdated = true; }
        if (rUpdated) {
            update.restoration = r;
            hasChanges = true;
        }
    }

    if (!data.provenance || typeof data.provenance !== 'object') {
      update.provenance = {
        digitalHash: '',
        chainStatus: 'Unregistered',
        trustTier: 'Level 1 (Snapshot)'
      };
      hasChanges = true;
    } else {
        let pUpdated = false;
        const p = { ...data.provenance };
        if (typeof p.digitalHash !== 'string') { p.digitalHash = ''; pUpdated = true; }
        if (!['Unregistered', 'Minted'].includes(p.chainStatus)) { p.chainStatus = 'Unregistered'; pUpdated = true; }
        if (!['Level 1 (Snapshot)', 'Level 2 (Visual)', 'Level 3 (Verified)'].includes(p.trustTier)) { p.trustTier = 'Level 1 (Snapshot)'; pUpdated = true; }
        if (pUpdated) {
            update.provenance = p;
            hasChanges = true;
        }
    }

    checkArray('insightfulPrompts');
    checkNumber('confidence', 0);

    // CollectionItemSchema specific fields
    checkString('userId');
    checkString('dateScanned');
    checkString('imageUrl');
    
    if (data.id !== doc.id) {
        update.id = doc.id;
        hasChanges = true;
    }

    if (hasChanges) {
      await doc.ref.update(update);
      console.log(`Updated document ID: ${doc.id}`);
      updatedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(`Backfill complete. Updated ${updatedCount} documents. Skipped ${skippedCount} items that validated cleanly.`);
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
