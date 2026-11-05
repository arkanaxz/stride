"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";

// Parse plain AI Markdown into React text nodes rather than inserting unsafe HTML.
// This also formats reviews saved before the feature was added.
function inlineMarkdown(value: string): ReactNode[] {
  const output: ReactNode[] = [];
  const tokens = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let previous = 0;
  let index = 0;
  for (const match of value.matchAll(tokens)) {
    const at = match.index ?? 0;
    if (at > previous) output.push(value.slice(previous, at));
    const token = match[0];
    const key = "md-" + index++;
    if (token.startsWith("**") || token.startsWith("__")) output.push(<strong key={key}>{inlineMarkdown(token.slice(2, -2))}</strong>);
    else if (token.charAt(0) === "`") output.push(<code key={key}>{token.slice(1, -1)}</code>);
    else output.push(<em key={key}>{inlineMarkdown(token.slice(1, -1))}</em>);
    previous = at + token.length;
  }
  if (previous < value.length) output.push(value.slice(previous));
  return output;
}

const bullet = /^\s*(?:([-*+])\s+|(\d+)[.)]\s+)(.*)$/;
const heading = /^\s*(#{1,4})\s+(.+)$/;
const boldTitle = /^\s*\*\*(.+?)\*\*\s*$/;
function special(line: string) {
  return bullet.test(line) || heading.test(line) || boldTitle.test(line) || /^\s*>\s?/.test(line);
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const title = heading.exec(line);
    if (title) {
      blocks.push(title[1].length <= 2 ? <h3 key={i}>{inlineMarkdown(title[2])}</h3> : <h4 key={i}>{inlineMarkdown(title[2])}</h4>);
      i++; continue;
    }
    const bold = boldTitle.exec(line);
    if (bold) {
      blocks.push(<h3 key={i}>{inlineMarkdown(bold[1])}</h3>);
      i++; continue;
    }
    const item = bullet.exec(lines[i]);
    if (item) {
      const ordered = Boolean(item[2]);
      const entries: ReactNode[] = [];
      const start = i;
      while (i < lines.length) {
        const current = bullet.exec(lines[i]);
        if (!current || Boolean(current[2]) !== ordered) break;
        let content = current[3].trim();
        i++;
        while (i < lines.length && lines[i].trim() && !special(lines[i])) {
          content += " " + lines[i].trim();
          i++;
        }
        entries.push(<li key={i}>{inlineMarkdown(content)}</li>);
      }
      blocks.push(ordered ? <ol key={start}>{entries}</ol> : <ul key={start}>{entries}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const start = i;
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, "")); i++;
      }
      blocks.push(<blockquote key={start}>{inlineMarkdown(quoted.join(" "))}</blockquote>);
      continue;
    }
    const start = i;
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && (i === start || !special(lines[i]))) {
      paragraph.push(lines[i].trim()); i++;
    }
    blocks.push(<p key={start}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <div className="analysis-markdown">{blocks}</div>;
}

export default function AnalysisReview({ text, defaultExpanded = false }: { text: string; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  return <section className="analysis-review">
    <div className="analysis-review-head"><strong>AI analysis</strong><button type="button" className="btn analysis-collapse" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((open) => !open)}>{expanded ? "Minimize analysis ↑" : "Expand analysis ↓"}</button></div>
    {expanded ? <div id={contentId} className="analysis-result analysis-prose"><MarkdownContent text={text}/></div> : <p className="analysis-preview muted">Review saved. Expand to read the full analysis.</p>}
  </section>;
}
