declare module 'pdf-parse' {
  type PdfParseResult = {
    text: string;
    numpages?: number;
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
  };

  type PdfParse = (buffer: Buffer) => Promise<PdfParseResult>;

  const pdfParse: PdfParse;
  export default pdfParse;
}
