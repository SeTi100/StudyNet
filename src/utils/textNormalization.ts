/**
 * @file textNormalization.ts
 * Bereinigt PDF-Texte von Ligatur-Artefakten, fehlerhaften Schriftkodierungen
 * (z. B. Æ -> fi, Ø -> fl, Œ -> ff) und korrigiert Wortabstände.
 */

import type * as pdfjsLib from 'pdfjs-dist';

/**
 * Normalisiert Unicode-Ligaturen und weit verbreitete PDF-Schriftart-Artefakte
 * (z. B. aus alten Type-1- / TeX- / Windows-1252-Kodierungen in wissenschaftlichen PDFs).
 */
export function normalizeLigaturesAndFontArtifacts(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // 1. Standard Unicode Ligaturen
  cleaned = cleaned
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft')
    .replace(/\uFB06/g, 'st');

  // 2. Unsichtbare Steuerzeichen & Soft-Hyphens
  cleaned = cleaned
    .replace(/\u00AD/g, '') // Soft hyphen
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // Zero-width spaces
    .replace(/[\u00A0\u202F\u2007]/g, ' '); // Non-breaking spaces

  // 3. Typische PDF-Font-Mapping-Fehler (Type-1 / TeX Encodings)
  // Æ / æ -> fi (z.B. Æltered -> Filtered, signiÆcant -> significant)
  cleaned = cleaned
    .replace(/\bÆ([a-z])/g, 'Fi$1')
    .replace(/([a-zA-Z])Æ([a-zA-Z])/g, '$1fi$2')
    .replace(/\bÆ([a-z])/gi, 'fi$1') // Fallback für mitten im Satz nach Satzzeichen
    .replace(/([a-z])Æ\b/g, '$1fi')
    .replace(/\bæ([a-z])/g, 'fi$1')
    .replace(/([a-zA-Z])æ([a-zA-Z])/g, '$1fi$2');
    
  // Alle restlichen vereinzelten Æ durch fi ersetzen (verhindert hängende Æs)
  cleaned = cleaned.replace(/Æ/g, 'fi').replace(/æ/g, 'fi');

  // Ø / ø -> fl (z.B. inØuence -> influence)
  cleaned = cleaned
    .replace(/\bØ([a-z])/g, 'Fl$1')
    .replace(/([a-zA-Z])Ø([a-zA-Z])/g, '$1fl$2')
    .replace(/([a-zA-Z])ø([a-zA-Z])/g, '$1fl$2')
    .replace(/\bø([a-z])/g, 'fl$1')
    .replace(/Ø/g, 'fl').replace(/ø/g, 'fl');

  // Œ / œ -> ff (z.B. eŒect -> effect)
  cleaned = cleaned
    .replace(/\bŒ([a-z])/g, 'Ff$1')
    .replace(/([a-zA-Z])Œ([a-zA-Z])/g, '$1ff$2')
    .replace(/([a-zA-Z])œ([a-zA-Z])/g, '$1ff$2')
    .replace(/\bœ([a-z])/g, 'ff$1')
    .replace(/Œ/g, 'ff').replace(/œ/g, 'ff');

  // Bindestrich-Artefakte (z.B. precursor±support -> precursor-support)
  cleaned = cleaned
    .replace(/([a-zA-Z0-9])±([a-zA-Z0-9])/g, '$1-$2');

  // Spezifische bekannte Wortkorrekturen für hartnäckige Fälle
  cleaned = cleaned
    .replace(/signiÆcant/gi, 'significant')
    .replace(/inØuence/gi, 'influence')
    .replace(/inøuence/gi, 'influence')
    .replace(/speciÆc/gi, 'specific')
    .replace(/deÆn/gi, 'defin')
    .replace(/proÆl/gi, 'profil')
    .replace(/difÆcult/gi, 'difficult')
    .replace(/eÆcient/gi, 'efficient')
    .replace(/eŒect/gi, 'effect')
    .replace(/diŒer/gi, 'differ')
    .replace(/suŒer/gi, 'suffer')
    .replace(/afÆn/gi, 'affin')
    .replace(/veriÆ/gi, 'verif')
    .replace(/modiÆ/gi, 'modif')
    .replace(/conÆg/gi, 'config')
    .replace(/conÆr/gi, 'confir')
    .replace(/beneÆ/gi, 'benef')
    .replace(/coefÆc/gi, 'coeffic')
    .replace(/ampliÆ/gi, 'amplif')
    .replace(/artiÆc/gi, 'artific')
    .replace(/identiÆ/gi, 'identif');

  return cleaned;
}

/**
 * Extrahiert den Text einer PDF-Seite mit präziser Positionsauswertung für Leerzeichen
 * und bereinigt diesen direkt von Ligatur- und Kodierungsfehlern.
 */
export async function extractCleanPageText(page: pdfjsLib.PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  const items = textContent.items;
  if (!items || items.length === 0) return '';

  let fullText = '';
  let lastX = 0;
  let lastY = -1;
  let lastFontSize = 10;

  for (const item of items) {
    if (!('str' in item) || item.str.length === 0) continue;

    const tx = (item as any).transform;
    const fontSize = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) || lastFontSize;
    const x = tx[4];
    const y = tx[5];
    const width = (item as any).width || 0;

    // Erkennung neuer Zeilen (vertikaler Versatz größer als halbe Schriftgröße)
    const isNewLine = lastY !== -1 && Math.abs(y - lastY) > fontSize * 0.6;

    // Erkennung von Wortabständen auf derselben Zeile (Schwellenwert ca. 0.2 * fontSize)
    let hasSpaceGap = !isNewLine && lastX > 0 && x - lastX > Math.max(1.2, fontSize * 0.18);

    // Heuristik für Subskripte/Superskripte (z.B. chemische Formeln wie Al 2 O 3 -> Al2O3)
    if (hasSpaceGap && fullText.length > 0) {
      const isSubscript = fontSize < lastFontSize * 0.9;
      const isReturnFromSubscript = fontSize > lastFontSize * 1.1;
      
      // Nur anwenden, wenn der physische Abstand nicht gewaltig ist (echter Tab/Abstand)
      if (x - lastX < fontSize * 1.0) {
        if (isSubscript && /^[0-9]+$/.test(item.str)) {
          // Prüfe, ob vorheriger Text auf einen Buchstaben endet (z.B. O, Al)
          if (/[a-zA-Z]$/.test(fullText.trimEnd())) {
            hasSpaceGap = false;
          }
        } else if (isReturnFromSubscript && /^[a-zA-Z]+$/.test(item.str)) {
          // Rücksprung: Vorher war eine Zahl, jetzt kommt ein Buchstabe (z.B. O nach 2)
          if (/[0-9]$/.test(fullText.trimEnd())) {
            hasSpaceGap = false;
          }
        }
      }
    }

    if (isNewLine) {
      // Wenn die vorherige Zeile mit Bindestrich endete (z.B. "precur-"), verbinden wir das Wort
      if (fullText.endsWith('-') && /[a-zA-Z]-$/.test(fullText)) {
        fullText = fullText.slice(0, -1);
      } else if (!fullText.endsWith(' ') && !fullText.endsWith('\n')) {
        fullText += '\n';
      }
    } else if (hasSpaceGap && !fullText.endsWith(' ') && !fullText.endsWith('\n')) {
      fullText += ' ';
    }

    fullText += item.str;

    lastX = x + width;
    lastY = y;
    lastFontSize = fontSize;
  }

  return normalizeLigaturesAndFontArtifacts(fullText);
}
