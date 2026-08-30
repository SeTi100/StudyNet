/**
 * @file chunker.ts
 * @description Sektions-bewusster Text-Chunker für wissenschaftliche Arbeiten.
 * Teilt extrahierten PDF-Text semantisch sinnvoll in Chunks auf, erkennt Überschriften
 * (ALL-CAPS und nummeriert), berücksichtigt Satzgrenzen und fügt konfigurierbaren Overlap ein.
 */

export interface TextChunk {
  chunkId: string;         // z.B. 'chunk_p4_0', 'chunk_p4_1'
  text: string;            // Der Inhalt des Chunks
  pageNumber: number;      // Quellseite
  sectionHeader?: string;  // Erkannte Abschnittsüberschrift (z.B. 'Methods', 'Results')
  startCharIndex: number;  // Startposition im vollständigen Seitentext
  endCharIndex: number;    // Endposition im vollständigen Seitentext
}

export interface ChunkerOptions {
  targetTokens?: number;   // Standard: 500
  maxTokens?: number;      // Standard: 800
  overlapSentences?: number; // Anzahl der überlappenden Sätze zwischen Chunks, Standard: 1
}

export interface SentenceSpan {
  text: string;
  startIndex: number;
  endIndex: number;
  isHeader?: boolean;
  headerText?: string;
}

/**
 * Regex zur Erkennung von ALL-CAPS Überschriften (z.B. 'METHODOLOGY', 'RESULTS AND DISCUSSION').
 */
export const ALL_CAPS_HEADER_REGEX = /^\s*([A-Z][A-Z\s]{2,})$/m;

/**
 * Regex zur Erkennung von nummerierten Überschriften (z.B. '3.1 Experimental Setup', '1. INTRODUCTION').
 */
export const NUMBERED_HEADER_REGEX = /^\s*(\d+[\.\d]*\s+[A-Z].+)$/m;

/**
 * Bekannte wissenschaftliche und englische Abkürzungen, nach denen kein Satzende vermutet wird.
 */
export const ABBREVIATIONS = new Set([
  'al',
  'eg',
  'ie',
  'fig',
  'figs',
  'tab',
  'tabs',
  'eq',
  'eqs',
  'ref',
  'refs',
  'sec',
  'secs',
  'dr',
  'prof',
  'vs',
  'vol',
  'no',
  'pp',
  'p',
  'dept',
  'approx',
  'est',
  'min',
  'max',
  'inc',
  'corp',
  'co',
  'ltd',
]);

/**
 * Schätzt die Anzahl der Tokens in einem gegebenen Text (Faustformel: 1 Token ≈ 4 Zeichen).
 *
 * @param text - Der zu schätzende Text.
 * @returns Die geschätzte Anzahl der Tokens.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Prüft, ob ein Textabschnitt eine Abschnittsüberschrift darstellt, und gibt diese bereinigt zurück.
 *
 * @param text - Der zu prüfende Text.
 * @returns Die gefundene Überschrift oder null.
 */
export function extractSectionHeader(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return null;

  // Prüfe nummerierte Überschriften zuerst (z.B. '3.1 Experimental Setup', '1. INTRODUCTION')
  const numberedMatch = trimmed.match(/^\s*(\d+[\.\d]*\s+[A-Z].+)$/);
  if (numberedMatch) {
    return numberedMatch[1].trim();
  }

  // Prüfe ALL-CAPS Überschriften (z.B. 'METHODOLOGY', 'RESULTS AND DISCUSSION')
  const allCapsMatch = trimmed.match(/^\s*([A-Z][A-Z\s]{2,})$/);
  if (allCapsMatch) {
    return allCapsMatch[1].trim();
  }

  return null;
}

/**
 * Teilt einen überlangen Satz / Textspanne rekursiv in kleinere Teilstücke auf,
 * sodass kein Stück maxTokens überschreitet.
 *
 * @param span - Die aufzuteilende Textspanne.
 * @param maxTokens - Maximale Tokenanzahl pro Stück.
 * @param targetTokens - Ziel-Tokenanzahl pro Stück.
 * @returns Ein Array kleinerer SentenceSpans.
 */
export function splitOversizedSpan(
  span: SentenceSpan,
  maxTokens: number,
  targetTokens: number
): SentenceSpan[] {
  const spanTokens = estimateTokens(span.text);
  if (spanTokens <= maxTokens) {
    return [span];
  }

  const maxChars = maxTokens * 4;
  const targetChars = targetTokens * 4;
  const result: SentenceSpan[] = [];

  let currentOffset = 0;
  const fullText = span.text;

  while (currentOffset < fullText.length) {
    const remainingLength = fullText.length - currentOffset;
    if (remainingLength <= maxChars) {
      const sliceText = fullText.substring(currentOffset);
      result.push({
        text: sliceText,
        startIndex: span.startIndex + currentOffset,
        endIndex: span.startIndex + fullText.length,
      });
      break;
    }

    // Finde eine passende Trennstelle (z.B. Leerzeichen) nahe targetChars
    let splitAt = currentOffset + targetChars;
    const spaceIndex = fullText.lastIndexOf(' ', splitAt);
    if (spaceIndex > currentOffset + targetChars / 2) {
      splitAt = spaceIndex;
    }

    // Niemals maxChars überschreiten
    if (splitAt - currentOffset > maxChars) {
      splitAt = currentOffset + maxChars;
    }

    const sliceText = fullText.substring(currentOffset, splitAt);
    result.push({
      text: sliceText,
      startIndex: span.startIndex + currentOffset,
      endIndex: span.startIndex + splitAt,
    });

    currentOffset = splitAt;
    // Überspringe führende Leerzeichen beim nächsten Teilstück
    while (currentOffset < fullText.length && fullText[currentOffset] === ' ') {
      currentOffset++;
    }
  }

  return result;
}

/**
 * Zerlegt den Text einer Seite in Sätze und Abschnitte, erkennt Überschriften
 * und liefert genaue Start- und End-Indizes im Originaltext.
 *
 * @param pageText - Vollständiger Text der Seite.
 * @param maxTokens - Maximale Tokenanzahl pro Satz/Span.
 * @param targetTokens - Ziel-Tokenanzahl pro Span.
 * @returns Ein Array aus SentenceSpans.
 */
export function splitPageIntoSentences(
  pageText: string,
  maxTokens: number = 800,
  targetTokens: number = 500
): SentenceSpan[] {
  if (!pageText || pageText.trim().length === 0) {
    return [];
  }

  const rawSpans: SentenceSpan[] = [];

  // Zerlege den Text zeilenweise, um Zeilen-Überschriften und Absätze sauber zu identifizieren
  const lineRegex = /([^\r\n]*)(\r?\n|$)/g;
  let lineMatch: RegExpExecArray | null;

  interface TextBlock {
    text: string;
    startIndex: number;
    endIndex: number;
    isHeader?: boolean;
    headerText?: string;
  }

  const blocks: TextBlock[] = [];
  let currentParagraphText = '';
  let currentParagraphStart = -1;
  let currentParagraphEnd = -1;

  const flushParagraph = () => {
    if (currentParagraphText.trim().length > 0 && currentParagraphStart !== -1) {
      blocks.push({
        text: currentParagraphText,
        startIndex: currentParagraphStart,
        endIndex: currentParagraphEnd,
      });
    }
    currentParagraphText = '';
    currentParagraphStart = -1;
    currentParagraphEnd = -1;
  };

  while ((lineMatch = lineRegex.exec(pageText)) !== null) {
    const lineFull = lineMatch[0];
    const lineContent = lineMatch[1];
    const lineStart = lineMatch.index;
    const lineEnd = lineStart + lineContent.length;

    // Wenn der Match leer ist und am Ende des Textes steht, abbrechen
    if (lineFull.length === 0 && lineStart >= pageText.length) {
      break;
    }

    const detectedHeader = extractSectionHeader(lineContent);

    if (detectedHeader) {
      // Wenn die Zeile eine Überschrift ist: aktuellen Absatz abschließen und Überschrift als Block anfügen
      flushParagraph();
      blocks.push({
        text: lineContent,
        startIndex: lineStart,
        endIndex: lineEnd,
        isHeader: true,
        headerText: detectedHeader,
      });
    } else if (lineContent.trim().length === 0) {
      // Leere Zeile = Absatzgrenze
      flushParagraph();
    } else {
      // Normale Textzeile: an aktuellen Absatz anhängen
      if (currentParagraphStart === -1) {
        currentParagraphStart = lineStart;
        currentParagraphText = lineContent;
      } else {
        currentParagraphText += ' ' + lineContent;
      }
      currentParagraphEnd = lineEnd;
    }

    if (lineRegex.lastIndex >= pageText.length && lineFull.length === 0) {
      break;
    }
  }

  flushParagraph();

  // Falls keine Blöcke durch Zeilen gefunden wurden, gesamten Text als einen Block nutzen
  if (blocks.length === 0 && pageText.trim().length > 0) {
    blocks.push({
      text: pageText,
      startIndex: 0,
      endIndex: pageText.length,
    });
  }

  // Zerlege jeden Block in Sätze
  for (const block of blocks) {
    if (block.isHeader) {
      rawSpans.push({
        text: block.text,
        startIndex: block.startIndex,
        endIndex: block.endIndex,
        isHeader: true,
        headerText: block.headerText,
      });
      continue;
    }

    const blockText = block.text;
    const blockStart = block.startIndex;

    // Satzgrenzen: Punkt / Ausrufezeichen / Fragezeichen gefolgt von Leerzeichen und Großbuchstaben
    const sentenceEndRegex = /([.!?])(\s+)(?=[A-Z])/g;
    let sentenceStart = 0;
    let sentMatch: RegExpExecArray | null;

    while ((sentMatch = sentenceEndRegex.exec(blockText)) !== null) {
      const punct = sentMatch[1];
      const matchIndex = sentMatch.index;
      const punctEndIndex = matchIndex + punct.length;

      // Prüfe auf Abkürzungen bei Punkten
      if (punct === '.') {
        // Prüfe auf bekannte Abkürzungen (z.B. 'et al.', 'e.g.', 'Fig.')
        const beforePunct = blockText.substring(Math.max(0, matchIndex - 10), matchIndex);
        const wordMatch = beforePunct.match(/([a-zA-Z]+)$/);
        if (wordMatch) {
          const word = wordMatch[1].toLowerCase();
          if (ABBREVIATIONS.has(word)) {
            continue;
          }
          // Einzelner Großbuchstabe (z.B. Initiale 'John D. Rockefeller')
          if (wordMatch[1].length === 1 && wordMatch[1] === wordMatch[1].toUpperCase()) {
            continue;
          }
        }
      }

      const sentenceText = blockText.substring(sentenceStart, punctEndIndex).trim();
      if (sentenceText.length > 0) {
        const subStart = blockStart + sentenceStart;
        const subEnd = blockStart + punctEndIndex;
        const innerHeader = extractSectionHeader(sentenceText);

        rawSpans.push({
          text: sentenceText,
          startIndex: subStart,
          endIndex: subEnd,
          isHeader: !!innerHeader,
          headerText: innerHeader || undefined,
        });
      }

      sentenceStart = punctEndIndex + sentMatch[2].length;
    }

    // Restlichen Text des Blocks als Satz hinzufügen
    if (sentenceStart < blockText.length) {
      const remainingText = blockText.substring(sentenceStart).trim();
      if (remainingText.length > 0) {
        const subStart = blockStart + sentenceStart;
        const subEnd = blockStart + blockText.length;
        const innerHeader = extractSectionHeader(remainingText);

        rawSpans.push({
          text: remainingText,
          startIndex: subStart,
          endIndex: subEnd,
          isHeader: !!innerHeader,
          headerText: innerHeader || undefined,
        });
      }
    }
  }

  // Überlange Sätze aufteilen, falls vorhanden
  const finalSpans: SentenceSpan[] = [];
  for (const span of rawSpans) {
    if (estimateTokens(span.text) > maxTokens) {
      const splitSpans = splitOversizedSpan(span, maxTokens, targetTokens);
      finalSpans.push(...splitSpans);
    } else {
      finalSpans.push(span);
    }
  }

  return finalSpans;
}

/**
 * Teilt ein Record von Seitentexten (aus pdfProcessor.worker) in semantische Text-Chunks auf.
 *
 * @param pageTexts - Record mit Seitennummer als Schlüssel und vollem Seitentext als Wert.
 * @param options - Optionen für Chunk-Größe, Maximalgröße und Satzüberlappung.
 * @returns Array der erstellten TextChunk-Objekte.
 */
export function chunkPageTexts(
  pageTexts: Record<number, string>,
  options?: ChunkerOptions
): TextChunk[] {
  const targetTokens = options?.targetTokens ?? 500;
  const maxTokens = options?.maxTokens ?? 800;
  const overlapSentences = Math.max(0, options?.overlapSentences ?? 1);

  const chunks: TextChunk[] = [];
  let currentSectionHeader: string | undefined = undefined;

  // Seiten numerisch aufsteigend sortieren
  const pageNumbers = Object.keys(pageTexts)
    .map(Number)
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b);

  for (const pageNumber of pageNumbers) {
    const pageText = pageTexts[pageNumber];
    if (!pageText || pageText.trim().length === 0) {
      continue;
    }

    // Zerlege den Seitentext in Sätze/Abschnitte unter Berücksichtigung von Überschriften
    const sentenceSpans = splitPageIntoSentences(pageText, maxTokens, targetTokens);
    if (sentenceSpans.length === 0) {
      continue;
    }

    let chunkIndex = 0;
    let sentenceCursor = 0;
    const pageChunkSentences: SentenceSpan[][] = [];

    while (sentenceCursor < sentenceSpans.length) {
      const currentChunkSpans: SentenceSpan[] = [];
      let currentTokens = 0;

      // Prüfe, ob der nächste neue Satz eine neue Überschrift ist
      const isStartingNewSection =
        sentenceCursor < sentenceSpans.length &&
        !!sentenceSpans[sentenceCursor].isHeader;

      // Füge Überlappungssätze aus dem vorherigen Chunk nur hinzu,
      // wenn wir uns noch in derselben Sektion befinden
      if (
        !isStartingNewSection &&
        pageChunkSentences.length > 0 &&
        overlapSentences > 0
      ) {
        const prevSpans = pageChunkSentences[pageChunkSentences.length - 1];
        const nextSpanTokens =
          sentenceCursor < sentenceSpans.length
            ? estimateTokens(sentenceSpans[sentenceCursor].text)
            : 0;

        const candidateOverlap = prevSpans.slice(-overlapSentences);
        // Behalte nur so viele Überlappungssätze, dass mindestens der nächste neue Satz noch hineinpasst
        for (const span of candidateOverlap) {
          const spanTokens = estimateTokens(span.text);
          if (currentTokens + spanTokens + nextSpanTokens <= maxTokens) {
            currentChunkSpans.push(span);
            currentTokens += spanTokens;
          }
        }
      }

      // Füge neue Sätze hinzu, bis targetTokens erreicht oder maxTokens droht überschritten zu werden
      let addedNewSentence = false;

      while (sentenceCursor < sentenceSpans.length) {
        const span = sentenceSpans[sentenceCursor];
        const spanTokens = estimateTokens(span.text);

        // Wenn dieser Span eine neue Überschrift ist und wir bereits NEUE Sätze im aktuellen Chunk haben:
        // Schließe vorherigen Chunk ab, damit die neue Sektion sauber einen neuen Chunk beginnt.
        if (span.isHeader && span.headerText && addedNewSentence) {
          break;
        }

        // Aktualisiere die aktive Abschnittsüberschrift
        if (span.isHeader && span.headerText) {
          currentSectionHeader = span.headerText;
        }

        // Wenn das Hinzufügen dieses Satzes maxTokens überschreiten würde und wir bereits Sätze haben:
        if (currentTokens + spanTokens > maxTokens && currentChunkSpans.length > 0) {
          break;
        }

        currentChunkSpans.push(span);
        currentTokens += spanTokens;
        sentenceCursor++;
        addedNewSentence = true;

        // Wenn wir targetTokens erreicht haben, beenden wir diesen Chunk
        if (currentTokens >= targetTokens) {
          break;
        }
      }

      // Falls kein neuer Satz hinzugefügt werden konnte (z.B. wegen Overlap-Größe),
      // entferne den Overlap und füge den neuen Satz einzeln hinzu
      if (!addedNewSentence && sentenceCursor < sentenceSpans.length) {
        currentChunkSpans.length = 0;
        const span = sentenceSpans[sentenceCursor];
        currentChunkSpans.push(span);
        sentenceCursor++;
      }

      if (currentChunkSpans.length === 0) {
        break;
      }

      pageChunkSentences.push(currentChunkSpans);

      // Bestimme Start- und End-Index im Seitentext
      const firstSpan = currentChunkSpans[0];
      const lastSpan = currentChunkSpans[currentChunkSpans.length - 1];
      const startCharIndex = firstSpan.startIndex;
      const endCharIndex = lastSpan.endIndex;

      // Rohtext aus dem Seitentext extrahieren
      const rawText = pageText.substring(startCharIndex, endCharIndex).trim();

      // Chunk-Text erstellen (ggf. mit aktuellem Section-Header voranstellen)
      let chunkText = rawText;
      if (
        currentSectionHeader &&
        !rawText.toLowerCase().startsWith(currentSectionHeader.toLowerCase())
      ) {
        chunkText = `${currentSectionHeader}\n\n${rawText}`;
      }

      const chunkId = `chunk_p${pageNumber}_${chunkIndex}`;

      chunks.push({
        chunkId,
        text: chunkText,
        pageNumber,
        sectionHeader: currentSectionHeader,
        startCharIndex,
        endCharIndex,
      });

      chunkIndex++;
    }
  }

  return chunks;
}
