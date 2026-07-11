const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const SUMMARY_TIMEOUT = 15000;
const MIN_CONTENT_CHARS = 80;

export class InsufficientContentError extends Error {
  constructor(message = '正文抽取不足') {
    super(message);
    this.name = 'InsufficientContentError';
  }
}

export function isContentSufficient(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CONTENT_CHARS) return false;
  const meaningful = trimmed.replace(/[^\p{L}\p{N}]/gu, '');
  return meaningful.length / trimmed.length >= 0.3;
}

const PROMPT =
  '请对该文章提炼出一个50~80字的简短概述，该概述需精准反映文章的核心主题、主要观点及最终结论，做到言简意赅且信息完整。直接输出概述，不要输出额外任何内容。';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export async function summarizeArticle(text: string, apiKey: string): Promise<string> {
  if (!isContentSufficient(text)) {
    throw new InsufficientContentError();
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n\n${text}` }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 400,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(SUMMARY_TIMEOUT),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Gemini API error: ${resp.status} ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as GeminiResponse;
  const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!summary) {
    throw new Error('Gemini 未返回总结内容');
  }
  return summary;
}
