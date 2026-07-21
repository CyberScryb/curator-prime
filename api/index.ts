import express from "express";
import cors from "cors";
import multer from "multer";
import { GoogleGenAI, Type } from "@google/genai";
import crypto from "crypto";
// Colocated with the serverless function so Vercel bundles them into /var/task
import { APPRAISAL_SYSTEM_V1, getAppraisalPrompt } from "./appraisal.js";
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

const getModelAlias = (tier: "pro" | "flash") => {
  const hasCustomKey = !!process.env.CUSTOM_GEMINI_API_KEY;
  if (tier === "pro") return hasCustomKey ? "gemini-3.1-pro-preview" : "gemini-2.5-pro";
  return hasCustomKey ? "gemini-3.1-flash-preview" : "gemini-2.5-flash";
};

// Fallback model names (stable versions)
const getFallbackModel = (tier: "pro" | "flash") => {
  return tier === "pro" ? "gemini-2.5-pro" : "gemini-2.5-flash";
};

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
app.post("/api/analyze-item", upload.array("images"), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    const userDescription = req.body?.userDescription as string | undefined;
    if (!files.length) return res.status(400).json({ error: "No images provided" });

    const ai = getAI();
    const prompt = getAppraisalPrompt(files.length, userDescription);
    const imageParts = files.map((f) => ({
      inlineData: { data: f.buffer.toString("base64"), mimeType: f.mimetype },
    }));

    const requestConfig = {
      contents: { parts: [...imageParts, { text: prompt }] },
      config: {
        systemInstruction: APPRAISAL_SYSTEM_V1,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            itemName: { type: Type.STRING }, category: { type: Type.STRING },
            classification: { type: Type.STRING, enum: ["Antique","Vintage","Modern","New","Specialty"] },
            era: { type: Type.STRING }, origin: { type: Type.STRING },
            condition: { type: Type.STRING }, conditionScore: { type: Type.NUMBER },
            rarityScore: { type: Type.NUMBER }, rarityDescription: { type: Type.STRING },
            valuation: { type: Type.OBJECT, properties: { low: { type: Type.NUMBER }, mid: { type: Type.NUMBER }, high: { type: Type.NUMBER }, currency: { type: Type.STRING } } },
            authenticationMarks: { type: Type.ARRAY, items: { type: Type.STRING } },
            keyFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
            visualHotspots: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, label: { type: Type.STRING }, description: { type: Type.STRING }, type: { type: Type.STRING, enum: ["damage","signature","material","design"] } }, required: ["x","y","label","description"] } },
            historicalContext: { type: Type.STRING }, materials: { type: Type.STRING }, careInstructions: { type: Type.STRING },
            comparableSales: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, price: { type: Type.STRING }, date: { type: Type.STRING }, link: { type: Type.STRING }, source: { type: Type.STRING } } } },
            sellingProfile: { type: Type.OBJECT, properties: { listingTitle: { type: Type.STRING }, listingDescription: { type: Type.STRING }, keywords: { type: Type.ARRAY, items: { type: Type.STRING } }, recommendedVenue: { type: Type.STRING }, pricingStrategy: { type: Type.STRING } } },
            forecast: { type: Type.OBJECT, properties: { liquidityScore: { type: Type.NUMBER }, marketSentiment: { type: Type.STRING, enum: ["Bullish","Bearish","Stable"] }, investmentGrade: { type: Type.STRING, enum: ["AAA","AA","A","B","C"] }, fiveYearProjection: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { year: { type: Type.STRING }, value: { type: Type.NUMBER } } } } } },
            restoration: { type: Type.OBJECT, properties: { restorationPotential: { type: Type.STRING }, estimatedCost: { type: Type.NUMBER }, recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } }, perfectStateDescription: { type: Type.STRING } } },
            provenance: { type: Type.OBJECT, properties: { trustTier: { type: Type.STRING, enum: ["Level 1 (Snapshot)","Level 2 (Visual)","Level 3 (Verified)"] } } },
            forensicInsight: { type: Type.STRING }, authenticityAssessment: { type: Type.STRING },
            authenticityScore: { type: Type.NUMBER }, insightfulPrompts: { type: Type.ARRAY, items: { type: Type.STRING } },
            confidence: { type: Type.NUMBER },
          },
          required: ["itemName","valuation","forecast","restoration","insightfulPrompts","authenticityAssessment","authenticityScore"],
        },
      },
    };

    let response;
    try {
      response = await ai.models.generateContent({ model: getModelAlias("pro"), ...requestConfig });
    } catch (primaryError: any) {
      console.warn(`Primary model failed (${getModelAlias("pro")}), falling back to ${getFallbackModel("pro")}:`, primaryError.message);
      response = await ai.models.generateContent({ model: getFallbackModel("pro"), ...requestConfig });
    }

    let cleanText = (response.text || "").replace(/```json|```/g, "").trim();
    const parsedResult = sanitizeResult(JSON.parse(cleanText));
    const dataString = `${parsedResult.itemName || ""}${parsedResult.era || ""}${parsedResult.classification || ""}${imageParts[0].inlineData.data}`;
    parsedResult.provenance = { ...parsedResult.provenance, digitalHash: "0x" + crypto.createHash("sha256").update(dataString).digest("hex") };
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
    const response = await ai.models.generateContent({
      model: getModelAlias("flash"),
      contents: { parts: [{ inlineData: { data: file.buffer.toString("base64"), mimeType: file.mimetype } }, { text: prompt }] },
      config: { responseMimeType: "application/json" },
    });

    let cleanText = (response.text || "").replace(/```json|```/g, "").trim();
    res.json(JSON.parse(cleanText));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Chat / Ask Curator
app.post("/api/ask", async (req, res) => {
  try {
    const { itemContext, question } = req.body;
    const ai = getAI();
    const systemContext = `You are the "Prime Curator", the world's most knowledgeable expert on this specific item: ${itemContext.itemName} (${itemContext.era}). Data: ${JSON.stringify(itemContext)}. Instructions: 1. Answer immediately and directly. No fluff. 2. Be incredibly insightful. Mention specific manufacturing techniques, historical events of that year, or specific market buyers. 3. Use a tone that is professional, high-end, and extremely knowledgeable.`;
    const result = await ai.models.generateContent({ model: getModelAlias("flash"), contents: { parts: [{ text: systemContext + "\n\nUser Question: " + question }] } });
    res.json({ text: result.text });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Market Analysis
app.post("/api/market-analysis", async (req, res) => {
  try {
    const { query } = req.body;
    const ai = getAI();
    const result = await ai.models.generateContent({
      model: getModelAlias("flash"),
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
