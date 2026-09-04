import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { NoteImage } from './NoteImage';

interface NoteViewerProps {
  content: string;
  className?: string;
  onUpdateImage?: (oldSrc: string, newParams: { width?: number; rotate?: number; align?: 'left' | 'center' | 'right' }) => void;
  onDeleteImage?: (src: string) => void;
  onMoveImageBlock?: (src: string, direction: 'up' | 'down') => void;
  isEditable?: boolean;
}

export const NoteViewer: React.FC<NoteViewerProps> = ({
  content,
  className = '',
  onUpdateImage,
  onDeleteImage,
  onMoveImageBlock,
  isEditable = true,
}) => {
  const components = useMemo(() => ({
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      if (!src) return null;
      // Use clean URL without query/hash params as stable key so NoteImage never remounts
      const cleanKey = src.split('#')[0].split('?')[0];
      return (
        <NoteImage
          key={cleanKey}
          src={src}
          alt={alt}
          onUpdateParams={onUpdateImage}
          onDelete={onDeleteImage}
          onMoveBlock={onMoveImageBlock}
          isEditable={isEditable}
        />
      );
    },
    h1: ({ children }: any) => <h1 className="text-xl font-bold text-neutral-100 mt-4 mb-2 pb-1 border-b border-neutral-800">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-lg font-semibold text-neutral-200 mt-3 mb-1.5">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-base font-semibold text-neutral-300 mt-2 mb-1">{children}</h3>,
    p: ({ children }: any) => <p className="mb-2 leading-relaxed text-neutral-300">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc pl-5 my-2 space-y-1 text-neutral-300">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal pl-5 my-2 space-y-1 text-neutral-300">{children}</ol>,
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-blue-500/70 pl-3 py-1 my-2 bg-blue-950/20 text-neutral-300 rounded-r">
        {children}
      </blockquote>
    ),
    code: ({ children }: any) => (
      <code className="bg-neutral-800 text-blue-300 px-1.5 py-0.5 rounded text-xs font-mono">
        {children}
      </code>
    ),
    a: ({ href, children }: any) => (
      <a href={href} className="text-blue-400 hover:underline hover:text-blue-300 transition-colors">
        {children}
      </a>
    ),
    pre: ({ children }: any) => (
      <pre className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg overflow-x-auto text-xs my-2 font-mono">
        {children}
      </pre>
    ),
  }), [onUpdateImage, onDeleteImage, onMoveImageBlock, isEditable]);

  return (
    <div className={`prose prose-invert max-w-none text-neutral-200 text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) => url}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
