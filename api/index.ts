import express from "express";
import cors from "cors";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
// Colocated with the serverless function so Vercel bundles them into /var/task
import {
  APPRAISAL_SYSTEM_V1,
  getAppraisalPrompt,
  VISUAL_FACTS_PROMPT,
} from "./appraisal.js";
import { getLiveAnalysisPrompt } from "./liveAnalysis.js";

// Vercel serverless: long Gemini vision calls need more than default 10s
export const config = {
  maxDuration: 60,
};

const upload = multer({
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  storage: multer.memoryStorage(),
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const getAI = () => {
  const apiKey = process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not defined");
  return new GoogleGenAI({ apiKey });
};

/**
 * Model routing (Google Gemini via @google/genai)
 *
 * gemini-2.5-pro is blocked for many new API keys ("no longer available to new users").
 * Default stack uses Gemini 3.x only.
 *
 * Env overrides (optional):
 *   IDENTIFICATION_MODEL  — main vision ID (default: gemini-3.1-pro-preview)
 *   FLASH_MODEL           — cheap/fast (default: gemini-3.1-flash-preview)
 */
const MODEL_ID_PRIMARY =
  process.env.IDENTIFICATION_MODEL ||
  process.env.CUSTOM_IDENTIFY_MODEL ||
  "gemini-3.1-pro-preview";

const MODEL_FLASH_PRIMARY =
  process.env.FLASH_MODEL || "gemini-3.1-flash-preview";

// Never fall back to gemini-2.5-pro (404 for new users)
const MODEL_ID_CHAIN = [
  MODEL_ID_PRIMARY,
  "gemini-3.1-pro-preview",
  "gemini-3-pro-preview",
  MODEL_FLASH_PRIMARY,
  "gemini-3.1-flash-preview",
  "gemini-2.5-flash",
].filter((m, i, arr) => m && arr.indexOf(m) === i);

const MODEL_FLASH_CHAIN = [
  MODEL_FLASH_PRIMARY,
  "gemini-3.1-flash-preview",
  "gemini-2.5-flash",
  MODEL_ID_PRIMARY,
].filter((m, i, arr) => m && arr.indexOf(m) === i);

const getModelAlias = (tier: "pro" | "flash" | "identify") => {
  if (tier === "flash") return MODEL_FLASH_CHAIN[0];
  return MODEL_ID_CHAIN[0];
};

async function generateWithFallback(
  ai: ReturnType<typeof getAI>,
  tier: "pro" | "flash" | "identify",
  request: any
) {
  const chain = tier === "flash" ? MODEL_FLASH_CHAIN : MODEL_ID_CHAIN;
  let lastError: any;

  for (const model of chain) {
    try {
      return await ai.models.generateContent({ model, ...request });
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || err || "");
      const unavailable =
        err?.status === 404 ||
        err?.code === 404 ||
        /NOT_FOUND|no longer available|not found|not supported/i.test(msg);
      console.warn(`Model ${model} failed${unavailable ? " (unavailable)" : ""}:`, msg.slice(0, 200));
      if (!unavailable && chain.indexOf(model) === chain.length - 1) break;
      // try next model on 404 / unavailable; also continue on other errors until chain ends
    }
  }

  throw lastError || new Error("All Gemini models failed");
}

// Sanitize appraisal data to conform to Firestore security rules
const sanitizeResult = (data: any): any => {
  if (typeof data.conditionScore === 'number') {
    data.conditionScore = Math.max(1, Math.min(10, Math.round(data.conditionScore)));
  }
  const validClassifications = ['Antique', 'Vintage', 'Modern', 'New', 'Specialty'];
  if (!validClassifications.includes(data.classification)) {
    data.classification = 'Specialty';
  }
  return data;
};

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Analyze Item (Multipart)
// mode=fast  → single Flash pass (quick answer)
// mode=full  → visual facts + Pro (default deeper analysis)
app.post("/api/analyze-item", upload.array("images"), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const userDescription = req.body?.userDescription as string | undefined;
    const mode = String(req.body?.mode || "full").toLowerCase() === "fast" ? "fast" : "full";
    if (!files.length) return res.status(400).json({ error: "No images provided" });

    const ai = getAI();
    const imageParts = files.map((f) => ({
      inlineData: { data: f.buffer.toString("base64"), mimeType: f.mimetype },
    }));

    // ── Optional Pass 1: visual facts (skip in fast mode for speed) ──
    let visualFacts: any = null;
    if (mode === "full") {
      try {
        const factsRes = await generateWithFallback(ai, "flash", {
          contents: {
            parts: [...imageParts, { text: VISUAL_FACTS_PROMPT }],
          },
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });
        const factsText = (factsRes.text || "").replace(/```json|```/g, "").trim();
        visualFacts = JSON.parse(factsText);
      } catch (factsErr: any) {
        console.warn("Visual facts pass failed (continuing):", factsErr?.message);
      }
    }

    const prompt = getAppraisalPrompt(
      files.length,
      userDescription,
      visualFacts ? JSON.stringify(visualFacts, null, 2) : undefined
    );

    // Fast = Flash model; Full = Pro/identify chain
    const analysisTier = mode === "fast" ? "flash" : "identify";

    const requestConfig = {
      contents: { parts: [...imageParts, { text: prompt }] },
      config: {
        systemInstruction: APPRAISAL_SYSTEM_V1,
        responseMimeType: "application/json",
        temperature: mode === "fast" ? 0.4 : 0.35,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            itemName: { type: Type.STRING },
            category: { type: Type.STRING },
            classification: {
              type: Type.STRING,
              enum: ["Antique", "Vintage", "Modern", "New", "Specialty"],
            },
            era: { type: Type.STRING },
            origin: { type: Type.STRING },
            condition: { type: Type.STRING },
            conditionScore: { type: Type.NUMBER },
            rarityScore: { type: Type.NUMBER },
            rarityDescription: { type: Type.STRING },
            valuation: {
              type: Type.OBJECT,
              properties: {
                low: { type: Type.NUMBER },
                mid: { type: Type.NUMBER },
                high: { type: Type.NUMBER },
                currency: { type: Type.STRING },
              },
            },
            authenticationMarks: { type: Type.ARRAY, items: { type: Type.STRING } },
            keyFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
            observedColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            brandEvidence: { type: Type.STRING },
            identificationDisclaimer: { type: Type.STRING },
            alternateIdentifications: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ["name", "reason"],
              },
            },
            visualHotspots: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                  type: {
                    type: Type.STRING,
                    enum: ["damage", "signature", "material", "design"],
                  },
                },
                required: ["x", "y", "label", "description"],
              },
            },
            historicalContext: { type: Type.STRING },
            materials: { type: Type.STRING },
            careInstructions: { type: Type.STRING },
            comparableSales: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  price: { type: Type.STRING },
                  date: { type: Type.STRING },
                  link: { type: Type.STRING },
                  source: { type: Type.STRING },
                },
              },
            },
            sellingProfile: {
              type: Type.OBJECT,
              properties: {
                listingTitle: { type: Type.STRING },
                listingDescription: { type: Type.STRING },
                keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendedVenue: { type: Type.STRING },
                pricingStrategy: { type: Type.STRING },
              },
            },
            forecast: {
              type: Type.OBJECT,
              properties: {
                liquidityScore: { type: Type.NUMBER },
                marketSentiment: {
                  type: Type.STRING,
                  enum: ["Bullish", "Bearish", "Stable"],
                },
                investmentGrade: {
                  type: Type.STRING,
                  enum: ["AAA", "AA", "A", "B", "C"],
                },
                fiveYearProjection: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      year: { type: Type.STRING },
                      value: { type: Type.NUMBER },
                    },
                  },
                },
              },
            },
            restoration: {
              type: Type.OBJECT,
              properties: {
                restorationPotential: { type: Type.STRING },
                estimatedCost: { type: Type.NUMBER },
                recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
                perfectStateDescription: { type: Type.STRING },
              },
            },
            provenance: {
              type: Type.OBJECT,
              properties: {
                trustTier: {
                  type: Type.STRING,
                  enum: [
                    "Level 1 (Snapshot)",
                    "Level 2 (Visual)",
                    "Level 3 (Verified)",
                  ],
                },
              },
            },
            forensicInsight: { type: Type.STRING },
            authenticityAssessment: { type: Type.STRING },
            authenticityScore: { type: Type.NUMBER },
            insightfulPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
            confidence: { type: Type.NUMBER },
          },
          required: [
            "itemName",
            "valuation",
            "forecast",
            "restoration",
            "insightfulPrompts",
            "authenticityAssessment",
            "authenticityScore",
            "confidence",
            "brandEvidence",
            "identificationDisclaimer",
          ],
        },
      },
    };

    // ── Main appraisal: Flash (fast) or Pro (full) ──
    const response = await generateWithFallback(ai, analysisTier as any, requestConfig);

    let cleanText = (response.text || "").replace(/```json|```/g, "").trim();
    const parsedResult = sanitizeResult(JSON.parse(cleanText));

    if (visualFacts) {
      parsedResult.visualFacts = visualFacts;
      if (!parsedResult.observedColors?.length && visualFacts.observedColors) {
        parsedResult.observedColors = visualFacts.observedColors;
      }
    }

    if (typeof parsedResult.confidence === "number") {
      if (parsedResult.confidence > 0 && parsedResult.confidence <= 1) {
        parsedResult.confidence = Math.round(parsedResult.confidence * 100);
      } else {
        parsedResult.confidence = Math.round(
          Math.min(100, Math.max(0, parsedResult.confidence))
        );
      }
    } else {
      parsedResult.confidence = 50;
    }

    const conf = parsedResult.confidence;
    if (!parsedResult.identificationDisclaimer) {
      parsedResult.identificationDisclaimer =
        conf >= 85
          ? "AI visual estimate based on this photo. Not a certified appraisal or brand authentication."
          : "Best-guess identification from this photo. Brand/model may be uncertain — treat as an AI estimate, not a confirmed ID.";
    }
    if (mode === "fast") {
      parsedResult.identificationDisclaimer =
        (parsedResult.identificationDisclaimer || "") +
        " Quick answer — a deeper Pro analysis may refine this shortly.";
    } else if (conf < 85 && !/guess|estimate|uncertain|not (a |an )?(certified|confirmed)/i.test(parsedResult.identificationDisclaimer)) {
      parsedResult.identificationDisclaimer +=
        " Confidence is moderate/low — this may be a best guess.";
    }

    const dataString = `${parsedResult.itemName || ""}${parsedResult.era || ""}${parsedResult.classification || ""}${imageParts[0].inlineData.data}`;
    parsedResult.provenance = {
      ...parsedResult.provenance,
      digitalHash:
        "0x" + crypto.createHash("sha256").update(dataString).digest("hex"),
    };
    parsedResult.modelUsed = getModelAlias(analysisTier as any);
    parsedResult.analysisTier = mode; // 'fast' | 'full'
    res.json(parsedResult);
  } catch (error: any) {
    console.error("Analysis Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Live Analysis
app.post("/api/analyze-live", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    const lensMode = req.body?.lensMode;
    const previousContext = req.body?.previousContext;
    if (!file) return res.status(400).json({ error: "No image provided" });

    const ai = getAI();
    const prompt = getLiveAnalysisPrompt(lensMode, previousContext);
    const response = await generateWithFallback(ai, "flash", {
      contents: { parts: [{ inlineData: { data: file.buffer.toString("base64"), mimeType: file.mimetype } }, { text: prompt }] },
      config: { responseMimeType: "application/json" },
    });

    let cleanText = (response.text || "").replace(/```json|```/g, "").trim();
    res.json(JSON.parse(cleanText));
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Chat / Ask Curator
app.post("/api/ask", async (req, res) => {
  try {
    const { itemContext, question } = req.body;
    const ai = getAI();
    const systemContext = `You are Curator Prime — a practical antiques & collectibles expert helping a non-expert owner.
Item: ${itemContext?.itemName} (${itemContext?.era}, ${itemContext?.origin}).
Key data: ${JSON.stringify({
  classification: itemContext?.classification,
  condition: itemContext?.condition,
  materials: itemContext?.materials,
  valuation: itemContext?.valuation,
  authenticityAssessment: itemContext?.authenticityAssessment,
  marks: itemContext?.authenticationMarks,
  care: itemContext?.careInstructions,
})}.
Rules: Answer clearly in plain English. Be specific and actionable. Short paragraphs or bullets. No sci-fi jargon. If uncertain, say so.`;
    const result = await generateWithFallback(ai, "flash", {
      contents: { parts: [{ text: systemContext + "\n\nUser Question: " + question }] },
    });
    res.json({ text: result.text });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Market Analysis
app.post("/api/market-analysis", async (req, res) => {
  try {
    const { query } = req.body;
    const ai = getAI();
    const result = await generateWithFallback(ai, "flash", {
      contents: { parts: [{ text: `Real-time market analysis for: "${query}". JSON output.` }] },
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties: { itemName: { type: Type.STRING }, trend: { type: Type.STRING, enum: ["UP","DOWN","STABLE"] }, changePercent: { type: Type.STRING }, summary: { type: Type.STRING }, keyInsight: { type: Type.STRING }, demandLevel: { type: Type.STRING, enum: ["High","Medium","Low"] }, lastUpdated: { type: Type.STRING } }, required: ["trend","changePercent","summary","keyInsight","demandLevel"] },
      },
    });

    let cleanText = (result.text || "").replace(/```json|```/g, "").trim();
    let data;
    try { data = JSON.parse(cleanText); } catch { data = { trend: "STABLE", changePercent: "0%", summary: "Analysis unavailable.", keyInsight: "Unable to find data.", demandLevel: "Medium", lastUpdated: new Date().toISOString() }; }
    const chunks = result.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = chunks.flatMap((c: any) => c.web?.uri ? [{ title: c.web.title || "Source", url: c.web.uri }] : []).slice(0, 5);
    res.json({ ...data, sources });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Image Generation (Restoration preview)
app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, aspectRatio } = req.body;
    const ai = getAI();
    const result = await ai.models.generateImages({ model: "imagen-3.0-generate-002", prompt, config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: aspectRatio || "1:1" } });
    if (result.generatedImages?.[0]) return res.json({ imageUrl: `data:image/jpeg;base64,${result.generatedImages[0].image.imageBytes}` });
    res.status(404).json({ error: "No image generated" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default app;
