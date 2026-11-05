import ReactMarkdown from "react-markdown";

export default function AnalysisMarkdown({
  text,
  title = "AI analysis",
  initiallyOpen = true,
}: {
  text: string;
  title?: string;
  initiallyOpen?: boolean;
}) {
  return (
    <details className="analysis-panel" open={initiallyOpen || undefined}>
      <summary>
        {title}
        <span>Show / hide</span>
      </summary>
      <div className="analysis-result markdown-body">
        <ReactMarkdown
          components={{
            a: ({ children, ...props }) => (
              <a {...props} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </details>
  );
}
