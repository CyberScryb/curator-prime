export const LIVE_ANALYSIS_V1 = `Real-time Scan. Lens: {{lensMode}}.
      Instructions: {{lensInstructions}}
      Context: {{previousContext}}
      
      Return status LOCKED only if confidence > 85%.
      If you clearly identify a potential damage area, a signature, or a maker's mark within the visual frame, set "hotspotDetected" to true.
      Return valid JSON.`;

export function getLiveAnalysisPrompt(lensMode: string, previousContext?: string): string {
    let lensInstructions = "";
    if (lensMode === 'IDENTITY') {
      lensInstructions = `FOCUS: Establish Provenance. Identify Maker & Era.`;
    } else if (lensMode === 'MARKET') {
      lensInstructions = `FOCUS: Money. Estimate price.`;
    } else if (lensMode === 'FORENSICS') {
      lensInstructions = `FOCUS: Damage and Details. Look for scratches, patina, marks.`;
    } else if (lensMode === 'DECIPHER') {
      lensInstructions = `FOCUS: Text. Read everything.`;
    }

    return LIVE_ANALYSIS_V1
        .replace('{{lensMode}}', lensMode)
        .replace('{{lensInstructions}}', lensInstructions)
        .replace('{{previousContext}}', previousContext || "None.");
}