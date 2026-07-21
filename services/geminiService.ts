
import { AppraisalResult, LiveAnalysisUpdate, MarketAnalysis, LensMode } from "../types";
import { generateProvenanceHash } from "../lib/cryptoUtils";

// Helper to convert dataURL to Blob for multipart upload
const dataURLToBlob = (dataURL: string) => {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
};

/** Parse API response as JSON; surface HTML/404 bodies as readable errors. */
async function readApiJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  const trimmed = (text || '').trim();
  if (!trimmed) {
    throw new Error(`Empty response from analysis API (${response.status})`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const preview = trimmed.slice(0, 120).replace(/\s+/g, ' ');
    if (response.status === 404 || /NOT_FOUND|<!DOCTYPE|<html/i.test(trimmed)) {
      throw new Error('Analysis API is offline (404). Redeploy with serverless /api routes.');
    }
    throw new Error(`Analysis API returned non-JSON (${response.status}): ${preview}`);
  }
}

// FULL APPRAISAL (Manual Mode)
export const analyzeItem = async (imageBuffers: string[], userDescription?: string): Promise<AppraisalResult> => {
  const formData = new FormData();
  imageBuffers.forEach((buffer, i) => {
    const blob = dataURLToBlob(buffer);
    formData.append('images', blob, `image-${i}.jpg`);
  });
  
  if (userDescription) {
    formData.append('userDescription', userDescription);
  }

  const response = await fetch('/api/analyze-item', {
    method: 'POST',
    body: formData,
  });

  const payload = await readApiJson<AppraisalResult & { error?: string }>(response);
  if (!response.ok) {
    throw new Error(payload.error || `Analysis failed (${response.status})`);
  }

  const result = payload as AppraisalResult;
  
  const generatedHash = await generateProvenanceHash(result, imageBuffers[0]);

  // Client-side enhancement for deterministic fields
  result.provenance = {
      ...result.provenance,
      digitalHash: result.provenance?.digitalHash || generatedHash,
      chainStatus: 'Unregistered',
      trustTier: result.provenance?.trustTier || (imageBuffers.length >= 3 ? 'Level 3 (Verified)' : 'Level 1 (Snapshot)')
  };

  result.images = imageBuffers;
  return result;
};

export const generateRestorationPreview = async (item: AppraisalResult): Promise<string | null> => {
    try {
        const prompt = `A highly realistic, professional museum-quality photograph of a fully restored, perfect condition ${item.era} ${item.itemName} (${item.classification}). ${item.materials}. It looks flawless, clean, and authentic to its original era. Studio lighting, white background.`;
        
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, aspectRatio: "1:1" })
        });

        if (!response.ok) return null;
        const data = await response.json();
        return data.imageUrl || null;
    } catch (e: any) {
        console.error("Image generation failed", e);
        return null;
    }
};

export const generateDynamicPrompts = async (item: AppraisalResult): Promise<string[]> => {
    const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            itemContext: item,
            question: "Generate 3 NEW, highly specific, 'insider' questions that a wealthy collector or historian would ask to reveal hidden value. Return as JSON array of 3 strings."
        })
    });
    const data = await response.json();
    // Since askCurator returns text on server, we might need to parse it if we expect JSON
    try {
        const text = data.text || "";
        const cleanText = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleanText);
        return parsed.prompts || parsed || ["How do I sell this?", "Is it authentic?", "How do I clean it?"];
    } catch {
        return ["How do I sell this?", "Is it authentic?", "How do I clean it?"];
    }
};

export const executeItemTool = async (item: AppraisalResult, toolId: string): Promise<string> => {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemContext: item, question: `Execute Tool ID: ${toolId}` })
  });
  const data = await response.json();
  return data.text || "Tool execution failed.";
};

export const analyzeLiveFrame = async (imageBuffer: string, lensMode: LensMode, previousContext?: string): Promise<LiveAnalysisUpdate> => {
  const formData = new FormData();
  formData.append('image', dataURLToBlob(imageBuffer), 'frame.jpg');
  formData.append('lensMode', lensMode);
  if (previousContext) formData.append('previousContext', previousContext);

  const response = await fetch('/api/analyze-live', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) return { status: 'SEARCHING', shortTitle: '', classification: 'Modern', quickFacts: [], confidence: 0, lensMode };
  const data = await response.json();
  return { ...data, lensMode };
};

export const askCurator = async (itemContext: AppraisalResult, question: string): Promise<string> => {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemContext, question })
  });
  const data = await response.json();
  return data.text || "Unavailable.";
};

export const getMarketAnalysis = async (query: string): Promise<MarketAnalysis> => {
  const response = await fetch('/api/market-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!response.ok) throw new Error("Market analysis failed.");
  return await response.json();
};
