/**
 * Specialized identification logic for Curator Prime.
 * Job: photo → accurate product ID (read labels first) → value estimate.
 */

export const APPRAISAL_SYSTEM_V1 = `You are Curator Prime's product identification specialist.

Your ONLY job for this app: look at photos of real-world objects (tools, collectibles, antiques, electronics, household goods, art, etc.) and produce the most accurate identification and fair market estimate possible.

═══════════════════════════════════════
CORE METHOD (always in this order)
═══════════════════════════════════════
1. READ TEXT FIRST — logos, brand names, model numbers, stamps, tags, packaging, engravings.
   Whatever you can read on the object is HARD EVIDENCE. Do not ignore it.
2. SHAPE / CATEGORY second — what kind of object is it?
3. COLORS / MATERIALS third — support the ID, never override readable text.
4. Then value, condition, care, authenticity notes.

═══════════════════════════════════════
TEXT VS GUESS
═══════════════════════════════════════
- If a brand name is VISIBLE on the item, the itemName MUST include that brand (unless the photo clearly shows the mark is fake/unrelated stickers — then explain why).
- Never replace a visible brand with a more famous competitor just because the shape is similar.
- If text is unreadable, you may guess — set confidence lower and say so in identificationDisclaimer.
- Do not invent model numbers or text that is not in the image.
- Guessing is allowed when text is missing; ignoring visible text is not.

═══════════════════════════════════════
OUTPUT QUALITY
═══════════════════════════════════════
- itemName: specific and useful (Brand + product type + model if known). Prefer "Brand Widget 2000" over "Generic widget".
- brandEvidence: quote what you read ("Logo reads 'ACME' on housing") or say "No readable brand text; type inferred from shape."
- confidence: honest 0–100 for the identification.
- identificationDisclaimer: always present; stronger wording when guessing.
- alternateIdentifications: list if not highly certain.
- Valuation for the identified object (branded vs generic can differ a lot).
- Plain English. No sci-fi jargon.`;

export const OCR_PASS_PROMPT = `You are an OCR + visual evidence specialist for product photos.

Task: Extract EVERY readable piece of text and logo from the image(s). This text will be treated as ground truth for identification.

Return JSON only:
{
  "objectType": "generic product category (e.g. cordless drill, ceramic vase, wristwatch)",
  "observedColors": ["colors actually on the object"],
  "visibleTextOrLogos": ["every distinct word/logo/model string you can read — exact spelling if possible"],
  "likelyBrandFromText": "best brand string from visible text, or empty if none",
  "likelyModelFromText": "model/SKU string if readable, else empty",
  "shapeAndForm": "brief shape description",
  "materialsGuess": "visible materials",
  "textLocations": ["where text appears, e.g. side of housing, nameplate"],
  "notes": "blur, glare, or anything that limits reading"
}

Rules:
- Prefer incomplete real text over inventing clean brand names.
- If you see a brand word clearly, put it in visibleTextOrLogos AND likelyBrandFromText.
- Do NOT invent logos. Empty arrays are better than fabrications.
- Ignore background clutter text (posters, unrelated packaging) when possible; prefer text printed ON the object.`;

export const APPRAISAL_USER_V1 = `Identify and appraise this object for a collector/owner app.

PHOTOS: {{evidenceCount}}
{{userDescription}}

═══════════════════════════════════════
OCR / VISUAL EVIDENCE (GROUND TRUTH)
═══════════════════════════════════════
{{visualFacts}}

INSTRUCTIONS:
1. If OCR lists a brand or model in visibleTextOrLogos / likelyBrandFromText, you MUST use that brand in itemName unless you have a strong reason the text is not the product brand (explain in brandEvidence).
2. Do not substitute a more famous brand for a less famous one when the text disagrees.
3. Build itemName as: [Brand if known] + [product type] + [model if known].
4. Set confidence based on text clarity + visual match (readable brand on object → usually high confidence).
5. brandEvidence must mention the actual text you relied on, or that no text was readable.
6. identificationDisclaimer always required.
7. Hotspots: mark logos/nameplates as type "signature" when possible.
8. Valuation, condition, care, sell tips, 3 owner questions.

Return valid JSON matching the schema.`;

/** @deprecated alias — keep import name stable */
export const VISUAL_FACTS_PROMPT = OCR_PASS_PROMPT;

export function getAppraisalPrompt(
  evidenceCount: number,
  userDescription?: string,
  visualFactsJson?: string
): string {
  return APPRAISAL_USER_V1
    .replace(/\{\{evidenceCount\}\}/g, evidenceCount.toString())
    .replace(
      '{{userDescription}}',
      userDescription
        ? `OWNER NOTES (use if helpful; photo text overrides if they conflict): "${userDescription}"`
        : ''
    )
    .replace(
      '{{visualFacts}}',
      visualFactsJson ||
        '(No separate OCR pass — read all text on the object carefully yourself.)'
    );
}

/**
 * Server-side guard: if OCR found brand text and the model ignored it, force it in.
 * Generic specialization for ANY product — not category-specific rules.
 */
export function enforceReadableBrand(result: any, visualFacts: any): any {
  if (!result || !visualFacts) return result;

  const textBits: string[] = [
    ...(Array.isArray(visualFacts.visibleTextOrLogos)
      ? visualFacts.visibleTextOrLogos
      : []),
    visualFacts.likelyBrandFromText || "",
    visualFacts.likelyModelFromText || "",
  ]
    .map((t) => String(t || "").trim())
    .filter((t) => t.length >= 2);

  if (!textBits.length) return result;

  const brand =
    String(visualFacts.likelyBrandFromText || "").trim() ||
    // longest alphabetic token that looks like a brand (not pure numbers)
    textBits
      .filter((t) => /[a-zA-Z]{2,}/.test(t) && !/^\d+$/.test(t))
      .sort((a, b) => b.length - a.length)[0] ||
    "";

  if (!brand || brand.length < 2) return result;

  const name = String(result.itemName || "");
  const nameLower = name.toLowerCase();
  const brandLower = brand.toLowerCase();

  // Already reflected
  if (nameLower.includes(brandLower)) {
    result.brandEvidence =
      result.brandEvidence ||
      `Visible on object: "${brand}" (from OCR).`;
    // Readable brand on object → bump confidence floor
    if (typeof result.confidence === "number" && result.confidence < 70) {
      result.confidence = Math.max(result.confidence, 75);
    }
    return result;
  }

  // Model ignored visible brand — force into name
  const objectType =
    visualFacts.objectType || result.category || "item";
  const model =
    String(visualFacts.likelyModelFromText || "").trim();
  const forcedName = [brand, objectType, model].filter(Boolean).join(" ");

  result.alternateIdentifications = [
    { name, reason: "Model preferred this before OCR brand enforcement" },
    ...(Array.isArray(result.alternateIdentifications)
      ? result.alternateIdentifications
      : []),
  ].slice(0, 5);

  result.itemName = forcedName;
  result.brandEvidence = `Visible brand text on object: "${brand}". Identification corrected to include readable label. Other OCR text: ${textBits
    .slice(0, 8)
    .join(", ")}.`;
  result.confidence = Math.max(
    typeof result.confidence === "number" ? result.confidence : 50,
    80
  );
  result.authenticationMarks = Array.from(
    new Set([...(result.authenticationMarks || []), brand, ...textBits.slice(0, 5)])
  );
  result.identificationDisclaimer =
    (result.identificationDisclaimer || "") +
    ` Brand text "${brand}" was readable on the item and applied to the name.`;

  return result;
}
