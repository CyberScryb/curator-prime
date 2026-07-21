import { AppraisalResult, LiveAnalysisUpdate, MarketAnalysis, LensMode } from "../types";
import { generateProvenanceHash } from "../lib/cryptoUtils";

const dataURLToBlob = (dataURL: string) => {
  const arr = dataURL.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/jpeg";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
};

async function readApiJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error(`Empty response from API (${response.status})`);
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const preview = trimmed.slice(0, 120).replace(/\s+/g, " ");
    if (response.status === 404 || /NOT_FOUND|<!DOCTYPE|<html/i.test(trimmed)) {
      throw new Error("Analysis service is offline. Try again in a moment.");
    }
    throw new Error(`Unexpected response (${response.status}): ${preview}`);
  }
}

export type AnalyzeMode = "fast" | "full";

export type AnalyzeOptions = {
  mode?: AnalyzeMode;
  signal?: AbortSignal;
  /** Quick-pass ID for Pro to verify/correct (not a hard lock — logos win) */
  priorIdentification?: Partial<AppraisalResult> | Record<string, unknown>;
};

export const analyzeItem = async (
  imageBuffers: string[],
  userDescription?: string,
  options?: AnalyzeOptions
): Promise<AppraisalResult> => {
  const mode: AnalyzeMode = options?.mode === "fast" ? "fast" : "full";
  const formData = new FormData();
  imageBuffers.forEach((buffer, i) => {
    formData.append("images", dataURLToBlob(buffer), `image-${i}.jpg`);
  });
  if (userDescription) formData.append("userDescription", userDescription);
  formData.append("mode", mode);
  if (options?.priorIdentification) {
    formData.append(
      "priorIdentification",
      JSON.stringify({
        itemName: (options.priorIdentification as any).itemName,
        category: (options.priorIdentification as any).category,
        classification: (options.priorIdentification as any).classification,
        authenticationMarks: (options.priorIdentification as any).authenticationMarks,
        brandEvidence: (options.priorIdentification as any).brandEvidence,
        confidence: (options.priorIdentification as any).confidence,
      })
    );
  }

  const response = await fetch("/api/analyze-item", {
    method: "POST",
    body: formData,
    signal: options?.signal,
  });
  const payload = await readApiJson<
    AppraisalResult & { error?: string; analysisTier?: string }
  >(response);
  if (!response.ok) throw new Error(payload.error || `Analysis failed (${response.status})`);

  const result = payload as AppraisalResult;
  const generatedHash = await generateProvenanceHash(result, imageBuffers[0]);

  result.provenance = {
    ...result.provenance,
    digitalHash: result.provenance?.digitalHash || generatedHash,
    chainStatus: result.provenance?.chainStatus || "Unregistered",
    trustTier:
      result.provenance?.trustTier ||
      (imageBuffers.length >= 3 ? "Level 3 (Verified)" : "Level 1 (Snapshot)"),
  };
  if (typeof result.confidence === "number" && result.confidence > 0 && result.confidence <= 1) {
    result.confidence = Math.round(result.confidence * 100);
  }
  result.images = imageBuffers;
  result.analysisTier = (payload.analysisTier as AnalyzeMode) || mode;
  return result;
};

export const generateRestorationPreview = async (
  item: AppraisalResult
): Promise<string | null> => {
  try {
    const prompt = `Professional museum photo of a fully restored ${item.era} ${item.itemName}. Materials: ${item.materials}. Perfect original condition, studio lighting, neutral background, photorealistic.`;
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, aspectRatio: "1:1" }),
    });
    if (!response.ok) return null;
    const data = await readApiJson<{ imageUrl?: string; error?: string }>(response);
    return data.imageUrl || null;
  } catch (e) {
    console.error("Image generation failed", e);
    return null;
  }
};

export const generateDynamicPrompts = async (item: AppraisalResult): Promise<string[]> => {
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemContext: item,
        question: `Return ONLY a JSON array of exactly 3 short practical questions a collector would ask about this ${item.itemName}. Example: ["Is this authentic?","What is it worth?","How do I care for it?"]`,
      }),
    });
    const data = await readApiJson<{ text?: string }>(response);
    const clean = (data.text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    const arr = Array.isArray(parsed) ? parsed : parsed.prompts || [];
    if (arr.length >= 3) return arr.slice(0, 3).map(String);
  } catch {
    /* fall through */
  }
  return [
    "Is this authentic, and what should I check?",
    "How should I price this if I sell?",
    "How do I clean and store this safely?",
  ];
};

const TOOL_PROMPTS: Record<string, (item: AppraisalResult) => string> = {
  LISTING_TITLE_ONLY: (item) =>
    `Write ONE marketplace listing title (max 80 characters) for: ${item.itemName}, ${item.era}, ${item.classification}. No quotes. Title only.`,
  LISTING_DESCRIPTION_ONLY: (item) =>
    `Write a complete marketplace listing description for ${item.itemName} (${item.era}, ${item.origin}). Include condition (${item.condition}), materials (${item.materials}), authenticity notes, and a fair asking-price suggestion around $${item.valuation?.mid}. Use short paragraphs. No markdown headers.`,
  CARE_GUIDE: (item) =>
    `Write a practical care & storage guide for this ${item.itemName} made of ${item.materials}. Condition: ${item.condition}. Existing advice: ${item.careInstructions}. Give 5 clear bullet steps.`,
  AUTH_CHECKLIST: (item) =>
    `Create a buyer's authenticity checklist for ${item.itemName} (${item.era}). Marks: ${(item.authenticationMarks || []).join(", ") || "none listed"}. Assessment: ${item.authenticityAssessment || "n/a"}. List 6 yes/no checks.`,
  SELL_STRATEGY: (item) =>
    `Recommend where and how to sell ${item.itemName}. Value range $${item.valuation?.low}–$${item.valuation?.high}. Venue hint: ${item.sellingProfile?.recommendedVenue}. Give a short plan: best venue, timing, and pricing strategy.`,
  HISTORY_BRIEF: (item) =>
    `Summarize the historical context of this ${item.itemName} in plain English for a non-expert. Context: ${item.historicalContext}. 3 short paragraphs max.`,
};

export const executeItemTool = async (item: AppraisalResult, toolId: string): Promise<string> => {
  const builder = TOOL_PROMPTS[toolId];
  const question = builder
    ? builder(item)
    : `Help with this request about the item: ${toolId}. Be practical and specific.`;

  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemContext: item, question }),
  });
  const data = await readApiJson<{ text?: string; error?: string }>(response);
  if (!response.ok) throw new Error(data.error || "Tool failed");
  return data.text || "No response.";
};

export const analyzeLiveFrame = async (
  imageBuffer: string,
  lensMode: LensMode,
  previousContext?: string
): Promise<LiveAnalysisUpdate> => {
  const formData = new FormData();
  formData.append("image", dataURLToBlob(imageBuffer), "frame.jpg");
  formData.append("lensMode", lensMode);
  if (previousContext) formData.append("previousContext", previousContext);

  try {
    const response = await fetch("/api/analyze-live", { method: "POST", body: formData });
    if (!response.ok) {
      return { status: "SEARCHING", shortTitle: "", classification: "Modern", quickFacts: [], confidence: 0, lensMode };
    }
    const data = await readApiJson<LiveAnalysisUpdate>(response);
    return { ...data, lensMode };
  } catch {
    return { status: "SEARCHING", shortTitle: "", classification: "Modern", quickFacts: [], confidence: 0, lensMode };
  }
};

export const askCurator = async (itemContext: AppraisalResult, question: string): Promise<string> => {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemContext, question }),
  });
  const data = await readApiJson<{ text?: string; error?: string }>(response);
  if (!response.ok) throw new Error(data.error || "Chat unavailable");
  return data.text || "I couldn't answer that right now.";
};

export const getMarketAnalysis = async (query: string): Promise<MarketAnalysis> => {
  const response = await fetch("/api/market-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await readApiJson<MarketAnalysis & { error?: string }>(response);
  if (!response.ok) throw new Error(data.error || "Market analysis failed");
  return data;
};
