/**
 * Curator Prime — single-job specialist: identify object from photo, then value it.
 * Consistency matters: same photo should not invent a new name every scan.
 */

export const APPRAISAL_SYSTEM_V1 = `You are Curator Prime, a specialist visual appraiser for a photo → ID → value app.

YOUR JOB
1) Identify the object accurately from the photo(s).
2) Estimate fair market value and give practical notes (condition, authenticity, care, sell).

METHOD (strict order)
1. Read all text on the object first: brand, model, logos, stamps, labels, nameplates.
2. Identify product type from shape/function.
3. Combine into a stable, specific itemName (Brand + type + model when known).
4. Value that exact identification.

RULES
- Readable brand/model text or logos on the object ALWAYS win. itemName must use them.
- Never replace a visible brand with a more famous similar product (shape alone is not enough).
- If a prior/quick ID conflicts with a visible logo or printed brand, you MUST CORRECT itemName and brand fields.
- You may guess when text is missing — set confidence honestly and say so in identificationDisclaimer.
- Do not invent text or model numbers that are not visible.
- Prefer the most literal description of what is in the photo.
- When unsure between two names, pick the better-supported one and list the other under alternateIdentifications.
- Plain English. No sci-fi jargon.

OUTPUT
- confidence: 0–100 for identification certainty
- identificationDisclaimer: always present
- brandEvidence: quote visible logo/text when present, or state none readable
- valuation for the identified object
- insightfulPrompts: exactly 3 short, varied questions someone would ask that YOU can answer from the photo, product ID, and online/general knowledge (price, models, variants, history, market, etc. — not hands-on tests). See user prompt rules.`;

export const OCR_PASS_PROMPT = `Read the product photo carefully. Extract ONLY text and logos you can actually see.

Priority: brand logos, brand wordmarks, model numbers, nameplates, stamped/printed labels.

Return JSON:
{
  "objectType": "product category (e.g. rotary tool, lamp, watch)",
  "observedColors": ["colors on the object"],
  "visibleTextOrLogos": ["exact words or logo names visible on the object"],
  "likelyBrandFromText": "brand from visible text/logo, or empty string if none",
  "likelyModelFromText": "model from visible text, or empty string if none",
  "shapeAndForm": "brief shape description",
  "materialsGuess": "brief",
  "notes": "any readability limits"
}

Rules:
- If a brand logo or name is visible, put it in likelyBrandFromText and visibleTextOrLogos.
- Do NOT invent famous brands from shape alone.
- Empty strings are better than guesses.`;

export const APPRAISAL_USER_V1 = `Appraise this object from the photo(s).

PHOTOS: {{evidenceCount}}
{{userDescription}}
{{visualFacts}}
{{priorId}}

Produce a complete JSON appraisal.
- itemName MUST include any readable brand/model from logos, nameplates, or printed text.
- If VISIBLE TEXT / FACTS lists a brand, that brand is the correct one for itemName.
- If PRIOR IDENTIFICATION is provided: it is only a first-pass guess.
  * If the photo (or VISIBLE TEXT) shows a different brand/logo/name, CORRECT itemName now.
  * If prior was already right, keep the name and improve value, condition, and details.
  * Never protect a wrong brand just because it was in the prior pass.
- confidence 0–100, identificationDisclaimer always.
- Hotspots 3–5 if possible (mark logos as type "signature" when you see them).
- Valuation, care, authenticity, sell tips.
- insightfulPrompts: exactly 3 short questions (under ~14 words each). Make them DIVERSE — pick different angles for this specific item, not three generic care questions.
  Audience: anyone curious about the item (owner or buyer is fine).
  ALLOWED — anything answerable from the photo, identification, and online/product knowledge, including:
    * price / fair market value / what similar ones sell for
    * models, series, generations, year range, regional variants
    * brand/maker history and why this piece matters
    * how this compares to other variants or competitors
    * marks, logos, serial styles and what they mean
    * authenticity / common fakes or repros for this type
    * rarity, collectability, market demand
    * materials, era, original accessories/kit
    * care, storage, selling venues (when relevant)
  FORBIDDEN — only things that need hands-on testing the camera cannot show:
    battery health, vibrations, noise, smell, "does it power on", motor strength, grip feel, torque.
  Prefer questions specific to THIS itemName/brand/category.
  Good examples: "What is a fair market price?", "Which model or variant is this?", "What's the history of this maker?", "How does this compare to later models?", "What years was this made?"
  Bad examples: "Does the battery still hold a charge?", "Any unusual vibrations?", "How does it feel when running?"`;

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
        ? `PRIOR IDENTIFICATION (first-pass guess only — CORRECT if logo/brand/text disagrees):\n${priorIdentification}`
        : ''
    );
}

const OWNER_PROMPT_BANNED =
  /\b(batter(y|ies)|vibrat|noise|sound|smell|odor|feel|grip|torque|motor strong|still (work|run)|hold(s)? a charge|charge last|unusual|plug it in|turn it on|does it work|how does it (run|feel)|should i buy|before (i )?buy)\b/i;

const DEFAULT_ANSWERABLE_PROMPTS = [
  "What is a fair market price?",
  "Which model or variant is this?",
  "What's the history behind this item?",
];

/** Drop questions Curator cannot answer from a photo (hands-on / sensory tests). */
export function sanitizeInsightfulPrompts(prompts: unknown): string[] {
  const list = Array.isArray(prompts) ? prompts.map(String) : [];
  const cleaned = list.filter((q) => {
    const s = q.trim();
    return s.length > 8 && s.length < 120 && !OWNER_PROMPT_BANNED.test(s);
  });
  if (cleaned.length >= 3) return cleaned.slice(0, 3);
  return [...cleaned, ...DEFAULT_ANSWERABLE_PROMPTS].slice(0, 3);
}

/**
 * Force brand into the name when OCR clearly found a brand/logo string
 * and the model omitted it or used a different brand. Does not invent brands.
 */
export function enforceReadableBrand(result: any, visualFacts: any): any {
  if (!result || !visualFacts) return result;

  let brand = String(visualFacts.likelyBrandFromText || "").trim();

  // Fallback: first logo-like token from visible text if brand field empty
  if (brand.length < 2 && Array.isArray(visualFacts.visibleTextOrLogos)) {
    for (const t of visualFacts.visibleTextOrLogos) {
      const s = String(t || "").trim();
      if (s.length >= 2 && /[a-zA-Z]{2,}/.test(s) && s.split(/\s+/).length <= 3) {
        brand = s;
        break;
      }
    }
  }

  if (brand.length < 2 || !/[a-zA-Z]{2,}/.test(brand)) return result;

  // Avoid forcing generic words
  const blocklist = new Set([
    "the", "and", "made", "china", "model", "type", "size", "with", "for", "use",
    "power", "tool", "tools", "series", "professional", "heavy", "duty",
    "item", "object", "product", "unknown",
  ]);
  if (blocklist.has(brand.toLowerCase())) return result;

  const name = String(result.itemName || "");
  const brandLower = brand.toLowerCase();
  if (name.toLowerCase().includes(brandLower)) {
    if (typeof result.confidence === "number" && result.confidence < 72) {
      result.confidence = Math.max(result.confidence, 72);
    }
    return result;
  }

  // Prefer double confirmation via visibleTextOrLogos, but accept likelyBrand alone
  const texts: string[] = Array.isArray(visualFacts.visibleTextOrLogos)
    ? visualFacts.visibleTextOrLogos.map((t: any) => String(t).toLowerCase())
    : [];
  const brandConfirmed =
    texts.some((t) => t.includes(brandLower)) ||
    String(visualFacts.likelyBrandFromText || "").toLowerCase() === brandLower;
  if (!brandConfirmed) return result;

  const objectType = visualFacts.objectType || result.category || "item";
  const model = String(visualFacts.likelyModelFromText || "").trim();
  const previous = name;

  result.alternateIdentifications = [
    {
      name: previous || "Unnamed",
      reason: "Name before applying visible logo/brand from photo",
    },
    ...(Array.isArray(result.alternateIdentifications)
      ? result.alternateIdentifications
      : []),
  ].slice(0, 4);

  result.itemName = [brand, objectType, model].filter(Boolean).join(" ");
  result.brandEvidence = `Readable brand/logo on object: "${brand}". Corrected title to match photo.`;
  result.identificationDisclaimer =
    (result.identificationDisclaimer || "") +
    (previous
      ? ` Title updated from “${previous}” to match visible brand “${brand}”.`
      : ` Title set from visible brand “${brand}”.`);
  result.confidence = Math.max(
    typeof result.confidence === "number" ? result.confidence : 50,
    80
  );
  result.authenticationMarks = Array.from(
    new Set([...(result.authenticationMarks || []), brand])
  );

  return result;
}
