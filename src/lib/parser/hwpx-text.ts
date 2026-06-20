import JSZip from 'jszip';

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTextFromSectionXml(xml: string): string {
  const tokens = [...xml.matchAll(
    /<(?:hp:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:hp:)?t>|<(?:hp:)?tab\s*\/?>|<(?:hp:)?br\s*\/?>|<\/(?:hp:)?p>|<\/(?:hp:)?tr>/g,
  )];

  const textNodes = tokens.map((match) => {
    if (match[1] != null) return decodeXmlEntities(match[1]);
    if (/tab/i.test(match[0])) return '\t';
    return '\n';
  });

  if (textNodes.length > 0) {
    return normalizeExtractedText(textNodes.join(''));
  }

  return normalizeExtractedText(decodeXmlEntities(
    xml
      .replace(/<\/(?:hp:)?p>|<\/(?:hp:)?tr>/g, '\n')
      .replace(/<(?:hp:)?br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' '),
  ));
}

export async function extractHwpxText(buffer: Buffer, filename = 'document.hwpx'): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new Error(`HWPX ZIP 구조를 읽을 수 없습니다. (${filename}: ${error instanceof Error ? error.message : String(error)})`);
  }

  const sectionFiles = Object.keys(zip.files)
    .filter(name => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  if (sectionFiles.length === 0) {
    throw new Error(`HWPX 본문 section XML을 찾을 수 없습니다. (${filename})`);
  }

  const chunks: string[] = [];
  for (const sectionFile of sectionFiles) {
    const file = zip.files[sectionFile];
    if (!file || file.dir) continue;
    const xml = await file.async('string');
    const text = extractTextFromSectionXml(xml);
    if (text) chunks.push(text);
  }

  const text = normalizeExtractedText(chunks.join('\n'));
  if (text.length < 10) {
    throw new Error(`HWPX 본문 텍스트가 비어 있습니다. (${filename})`);
  }
  return text;
}
