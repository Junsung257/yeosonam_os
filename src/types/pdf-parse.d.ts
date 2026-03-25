declare module 'pdf-parse' {
  function parse(buffer: Buffer): Promise<{
    text: string;
    [key: string]: any;
  }>;

  export default parse;
}
