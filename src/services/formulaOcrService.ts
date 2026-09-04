import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Extracts a mathematical formula from an image blob using the Gemini API.
 * @param blob The image blob containing the formula
 * @param apiKey The user's Gemini API Key
 * @returns The extracted LaTeX string
 */
export async function extractFormulaFromBlob(blob: Blob, apiKey: string): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Kein Gemini API-Key gefunden. Bitte trage diesen in den Einstellungen ein.');
  }

  // Convert Blob to Base64
  const base64String = await blobToBase64(blob);
  // Remove data URL prefix (e.g., "data:image/png;base64,")
  const base64Data = base64String.split(',')[1];
  const mimeType = blob.type || 'image/png';

  const prompt = "Analyze this image. If it contains mathematical formulas or equations, extract them and return ONLY the raw LaTeX code. Do not include markdown code block syntax (like ```latex), just the raw LaTeX string. If there are no formulas, return nothing.";

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ]
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const errorMessage = errorData?.error?.message || `HTTP Fehler: ${response.status}`;
    throw new Error(`Gemini API Fehler: ${errorMessage}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    throw new Error('Die API hat keinen Text zurückgegeben.');
  }

  return cleanLatexCode(text);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to convert blob to base64'));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function cleanLatexCode(code: string): string {
  let cleaned = code.trim();
  // Remove markdown blocks if the model still outputs them
  if (cleaned.startsWith('```latex')) {
    cleaned = cleaned.substring('```latex'.length);
  }
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}
