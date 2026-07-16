const MAX_AI_ANSWER_LENGTH = 700;

function getOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  return (response.output || []).flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('');
}

export async function refineTravelAnswer({ message, draft }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { answer: draft.answer, provider: 'rules' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_TRAVEL_GUIDE_MODEL || 'gpt-5.4-mini',
        instructions: '당신은 STAY HALONG의 한국어 여행 안내자입니다. 제공된 초안의 사실만 자연스럽고 간결하게 정리하세요. 가격, 재고, 예약 확정, 취소 규정을 새로 만들거나 단정하지 마세요. 결제·예약·취소 실행을 약속하지 말고 필요한 경우 현지 상담원 확인을 안내하세요. 3문장 이내로 답하세요.',
        input: `고객 문의: ${message}\n\n확인된 초안: ${draft.answer}`,
        max_output_tokens: 220,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
    const answer = getOutputText(await response.json()).trim().slice(0, MAX_AI_ANSWER_LENGTH);
    return answer ? { answer, provider: 'openai' } : { answer: draft.answer, provider: 'rules' };
  } catch (error) {
    console.warn('Travel guide AI fallback:', error instanceof Error ? error.message : 'unknown error');
    return { answer: draft.answer, provider: 'rules' };
  } finally { clearTimeout(timeout); }
}
