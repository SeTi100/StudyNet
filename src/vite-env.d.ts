/// <reference types="vite/client" />

declare module '*?worker&url' {
  const src: string;
  export default src;
}

declare module '*?url' {
  const src: string;
  export default src;
}

declare module '*?worker' {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const src: string;
  export default src;
}
