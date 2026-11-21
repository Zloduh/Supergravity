import {
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import mermaid from 'mermaid';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { cn } from '../utils/cn';
import { resolveTheme, useAppStore } from '../stores/appStore';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

const MarkdownThemeContext = createContext<'dark' | 'light'>('dark');

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: Parameters<typeof ReactMarkdown>[0]['rehypePlugins'] = [
  rehypeKatex,
  [rehypeHighlight, { plainText: ['mermaid', 'text', 'txt', 'plain'] }],
];

export function extractPlainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractPlainText).join('');
  }
  if (isValidElement(node)) {
    if (node.type === 'br') {
      return '\n';
    }
    const props = node.props as { children?: ReactNode };
    return extractPlainText(props.children);
  }
  if (typeof node === 'object' && Symbol.iterator in node) {
    return Array.from(node as Iterable<ReactNode>)
      .map(extractPlainText)
      .join('');
  }
  return '';
}

function MermaidBlock({
  code,
  theme,
}: {
  code: string;
  theme: 'dark' | 'light';
}) {
  const reactId = useId().replace(/:/g, '');
  const renderSeqRef = useRef(0);
  const [lastValidSvg, setLastValidSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setRendering(true);

    const timer = setTimeout(async () => {
      const seq = ++renderSeqRef.current;
      const renderId = `mermaid-${reactId}-${seq}`;

      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === 'light' ? 'default' : 'dark',
          securityLevel: 'strict',
        });

        const res = await mermaid.render(renderId, code);
        if (!active || seq !== renderSeqRef.current) return;
        setLastValidSvg(res.svg);
        setError(null);
      } catch (e) {
        if (!active || seq !== renderSeqRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (typeof document !== 'undefined') {
          document.getElementById(`d${renderId}`)?.remove();
        }
        if (active && seq === renderSeqRef.current) {
          setRendering(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [code, reactId, theme]);

  if (lastValidSvg) {
    return (
      <div className="my-3 rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
        {(error || rendering) && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900/90 border-b border-gray-800 text-[11px] text-amber-300">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {error
                ? 'Syntax incomplete — showing last valid diagram'
                : 'Rendering diagram…'}
            </span>
          </div>
        )}
        <div
          className="p-3 overflow-x-auto flex justify-center"
          dangerouslySetInnerHTML={{ __html: lastValidSvg }}
        />
        {error && (
          <details className="border-t border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-400">
            <summary className="cursor-pointer select-none hover:text-gray-200">
              View raw Mermaid source
            </summary>
            <pre className="mt-2 p-2 rounded bg-gray-950 text-gray-300 overflow-x-auto font-mono text-[11px]">
              {code}
            </pre>
          </details>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-3 rounded-lg border border-amber-500/30 bg-amber-950/20 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Unable to render Mermaid diagram</span>
        </div>
        <details className="border-t border-amber-500/20 bg-gray-950/80 px-3 py-2 text-xs text-gray-400">
          <summary className="cursor-pointer select-none hover:text-gray-200">
            Show diagram source
          </summary>
          <pre className="mt-2 p-2 rounded bg-gray-950 text-gray-300 overflow-x-auto font-mono text-[11px]">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className="my-3 p-3 rounded-lg bg-gray-950 border border-gray-800 text-xs text-gray-400">
      Rendering diagram…
    </div>
  );
}

function copyTextWithFallback(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      // ignore clipboard promise rejection
    });
    return;
  }
  if (typeof document !== 'undefined' && document.body) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore fallback failure
    }
    document.body.removeChild(textarea);
  }
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const resolvedTheme = useContext(MarkdownThemeContext);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lang = /language-([^\s]+)/.exec(className || '')?.[1] || '';
  const codeText = extractPlainText(children).replace(/\n$/, '');

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (lang.toLowerCase() === 'mermaid') {
    return <MermaidBlock code={codeText} theme={resolvedTheme} />;
  }

  if (lang.toLowerCase() === 'html-widget' || lang.toLowerCase() === 'generative-ui') {
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-indigo-500/40 bg-gray-950">
        <div className="flex items-center justify-between px-3 py-1.5 bg-indigo-950/40 border-b border-indigo-500/30 text-xs text-indigo-300">
          <span className="font-semibold">Interactive Generative UI Widget</span>
          <button
            type="button"
            onClick={() => {
              copyTextWithFallback(codeText);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-800 text-gray-300"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy HTML'}</span>
          </button>
        </div>
        <iframe
          title="Generative UI Widget"
          sandbox="allow-scripts"
          srcDoc={codeText}
          className="w-full h-72 bg-white border-0"
        />
      </div>
    );
  }

  const handleCopy = () => {
    copyTextWithFallback(codeText);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 1500);
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-gray-800 bg-[#0d1117]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900/90 border-b border-gray-800 text-xs text-gray-400">
        <span className="font-mono text-[11px] uppercase tracking-wide text-gray-400">
          {lang || 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-800 hover:text-white transition-colors"
          aria-label="Copy code"
          title="Copy code"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="m-0 overflow-x-auto bg-[#0d1117] text-[13px] leading-relaxed">
        <code
          className={cn(
            'block p-3.5 font-mono !bg-transparent',
            !className?.includes('hljs') && 'text-gray-200',
            className
          )}
        >
          {children}
        </code>
      </pre>
    </div>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  h1({ children }) {
    return (
      <h1 className="text-xl font-bold text-white mt-5 mb-2.5 pb-1.5 border-b border-gray-800 first:mt-0">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="text-lg font-semibold text-white mt-4 mb-2 pb-1 border-b border-gray-800/70 first:mt-0">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="text-base font-semibold text-gray-100 mt-3.5 mb-1.5 first:mt-0">
        {children}
      </h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="text-sm font-semibold text-gray-200 mt-3 mb-1 first:mt-0">
        {children}
      </h4>
    );
  },
  p({ children }) {
    return <p className="my-2.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>;
  },
  ul({ className: ulClass, children }) {
    const isTaskList = ulClass?.includes('contains-task-list');
    return (
      <ul
        className={cn(
          'my-2.5 space-y-1',
          isTaskList ? 'list-none pl-1' : 'list-disc pl-5',
          ulClass
        )}
      >
        {children}
      </ul>
    );
  },
  ol({ node: _node, start, className: olClass, children, ...props }) {
    return (
      <ol
        start={start}
        className={cn('my-2.5 list-decimal pl-5 space-y-1', olClass)}
        {...props}
      >
        {children}
      </ol>
    );
  },
  li({ className: liClass, children }) {
    return <li className={cn('leading-relaxed', liClass)}>{children}</li>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 pl-3.5 py-0.5 border-l-2 border-blue-500/70 text-gray-300 bg-gray-900/40 rounded-r">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-4 border-gray-800" />;
  },
  strong({ children }) {
    return <strong className="font-semibold text-white">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-gray-200">{children}</em>;
  },
  del({ children }) {
    return <del className="line-through text-gray-400">{children}</del>;
  },
  pre({ children }) {
    if (isValidElement(children)) {
      const codeProps = children.props as {
        className?: string;
        children?: ReactNode;
      };
      return <CodeBlock className={codeProps.className}>{codeProps.children}</CodeBlock>;
    }
    return <CodeBlock>{children}</CodeBlock>;
  },
  code({ className: codeClass, node: _node, children, ...props }) {
    const text = extractPlainText(children);
    const isBlock = Boolean(codeClass?.includes('language-')) || text.includes('\n');
    if (isBlock) {
      return <CodeBlock className={codeClass}>{children}</CodeBlock>;
    }
    return (
      <code
        className={cn(
          'px-1.5 py-0.5 rounded bg-gray-800/90 text-sky-300 text-[0.85em] font-mono border border-gray-700/60',
          codeClass
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3 rounded-lg border border-gray-800">
        <table className="min-w-full border-collapse text-xs sm:text-sm">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-gray-900/90 text-gray-200">{children}</thead>;
  },
  tr({ children }) {
    return <tr className="border-b border-gray-800 last:border-b-0">{children}</tr>;
  },
  th({ children }) {
    return (
      <th className="px-3 py-2 text-left font-semibold border-r border-gray-800 last:border-r-0">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="px-3 py-2 text-gray-300 border-r border-gray-800 last:border-r-0">
        {children}
      </td>
    );
  },
  img({ src, alt }) {
    return (
      <img
        src={src}
        alt={alt || ''}
        className="my-3 max-w-full rounded-lg border border-gray-800"
      />
    );
  },
};

export function MarkdownRenderer({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = resolveTheme(theme);

  return (
    <MarkdownThemeContext.Provider value={resolvedTheme}>
      <div
        className={cn(
          'max-w-none break-words text-sm leading-relaxed text-gray-100 [&_.katex-display]:overflow-x-auto [&_.katex-display]:py-1',
          className
        )}
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownThemeContext.Provider>
  );
}
