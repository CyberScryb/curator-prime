/**
 * Curator Prime — single-job specialist: identify object from photo, then value it.
 * Consistency matters: same photo should not invent a new name every scan.
 */

export const APPRAISAL_SYSTEM_V1 = `You are Curator Prime, a specialist visual appraiser for a photo → ID → value app.

YOUR JOB
1) Identify the object accurately from the photo(s).
2) Estimate fair market value and give practical notes (condition, authenticity, care, sell).

METHOD (strict order)
1. Read all text on the object first: brand, model, logos, stamps, labels.
2. Identify product type from shape/function.
3. Combine into a stable, specific itemName (Brand + type + model when known).
4. Value that exact identification.

RULES
- Readable brand/model text on the object is authoritative. Include it in itemName.
- Do not swap a visible brand for a more famous similar product.
- You may guess when text is missing — set confidence honestly and say so in identificationDisclaimer.
- Do not invent text or model numbers that are not visible.
- Be consistent: prefer the most literal description of what is in the photo.
- Temperature of judgment: conservative. When unsure between two names, pick the more generic accurate one and list the other under alternateIdentifications.
- Plain English. No sci-fi jargon.

OUTPUT
- confidence: 0–100 for identification certainty
- identificationDisclaimer: always present
- brandEvidence: what you saw (quote visible text or state none readable)
- valuation for the identified object`;

export const OCR_PASS_PROMPT = `Extract readable text from the product photo for identification.

Return JSON:
{
  "objectType": "product category",
  "observedColors": ["colors on the object"],
  "visibleTextOrLogos": ["exact words/logos on the object"],
  "likelyBrandFromText": "brand from text or empty",
  "likelyModelFromText": "model from text or empty",
  "shapeAndForm": "brief",
  "materialsGuess": "brief",
  "notes": "limitations"
}

Only include text you can actually read. Empty is better than invented.`;

export const APPRAISAL_USER_V1 = `Appraise this object from the photo(s).

PHOTOS: {{evidenceCount}}
{{userDescription}}
{{visualFacts}}
{{priorId}}

Produce a complete JSON appraisal.
- itemName must reflect any readable brand/model on the object.
- If PRIOR IDENTIFICATION is provided, KEEP the same itemName and brand unless the photo text clearly proves a different brand/model. You may improve value, condition, details, and confidence — do not invent a new identity for the same photo.
- confidence 0–100, identificationDisclaimer always.
- Hotspots 3–5 if possible.
- Valuation, care, authenticity, sell tips, 3 owner questions.`;

/** @deprecated name kept for imports */
export const VISUAL_FACTS_PROMPT = OCR_PASS_PROMPT;

export function getAppraisalPrompt(
  evidenceCount: number,
  userDescription?: string,
  visualFactsJson?: string,
  priorIdentification?: string
): string {
  return APPRAISAL_USER_V1
    .replace(/\{\{evidenceCount\}\}/g, evidenceCount.toString())
    .replace(
      '{{userDescription}}',
      userDescription
        ? `OWNER NOTES: "${userDescription}"`
        : ''
    )
    .replace(
      '{{visualFacts}}',
      visualFactsJson
        ? `VISIBLE TEXT / FACTS:\n${visualFactsJson}`
        : 'Read all text on the object carefully in this pass.'
    )
    .replace(
      '{{priorId}}',
      priorIdentification
        ? `PRIOR IDENTIFICATION (keep unless photo text clearly contradicts):\n${priorIdentification}`
        : ''
    );
}

/**
 * Only force brand into the name when OCR clearly found a brand string
 * and the model omitted it entirely. Does not invent brands.
 */
export function enforceReadableBrand(result: any, visualFacts: any): any {
  if (!result || !visualFacts) return result;

  const brand = String(visualFacts.likelyBrandFromText || "").trim();
  if (brand.length < 2 || !/[a-zA-Z]{2,}/.test(brand)) return result;

  // Avoid forcing generic words
  const blocklist = new Set([
    "the", "and", "made", "china", "model", "type", "size", "with", "for", "use",
    "power", "tool", "tools", "series", "professional", "heavy", "duty",
  ]);
  if (blocklist.has(brand.toLowerCase())) return result;

  const name = String(result.itemName || "");
  if (name.toLowerCase().includes(brand.toLowerCase())) {
    if (typeof result.confidence === "number" && result.confidence < 72) {
      result.confidence = Math.max(result.confidence, 72);
    }
    return result;
  }

  // Only force if brand also appears in visibleTextOrLogos (double confirmation)
  const texts: string[] = Array.isArray(visualFacts.visibleTextOrLogos)
    ? visualFacts.visibleTextOrLogos.map((t: any) => String(t).toLowerCase())
    : [];
  if (!texts.some((t) => t.includes(brand.toLowerCase()))) {
    return result;
  }

  const objectType = visualFacts.objectType || result.category || "item";
  const model = String(visualFacts.likelyModelFromText || "").trim();
  const previous = name;

  result.alternateIdentifications = [
    { name: previous, reason: "Name before applying readable brand label" },
    ...(Array.isArray(result.alternateIdentifications)
      ? result.alternateIdentifications
      : []),
  ].slice(0, 4);

  result.itemName = [brand, objectType, model].filter(Boolean).join(" ");
  result.brandEvidence = `Readable brand on object: "${brand}". Applied to title.`;
  result.confidence = Math.max(
    typeof result.confidence === "number" ? result.confidence : 50,
    78
  );
  result.authenticationMarks = Array.from(
    new Set([...(result.authenticationMarks || []), brand])
  );

  return result;
}
