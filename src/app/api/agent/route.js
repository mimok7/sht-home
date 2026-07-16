import { NextResponse } from 'next/server';
import { runTravelSubagent } from '@/lib/agents/travelSubagent';
import { getAgentMetrics, recordAgentEvent } from '@/lib/agents/agentTelemetry';

export const runtime = 'nodejs';
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const requests = new Map();

function getClientKey(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function isRateLimited(key) {
  const now = Date.now();
  const entry = requests.get(key);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    requests.set(key, { startedAt: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

export async function POST(request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: '허용되지 않은 요청 출처입니다.' }, { status: 403 });
  if (isRateLimited(getClientKey(request))) return NextResponse.json({ error: '잠시 후 다시 시도해주세요.' }, { status: 429, headers: { 'Retry-After': '60' } });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON 형식의 요청 본문이 필요합니다.' }, { status: 400 }); }
  try {
    const result = await runTravelSubagent(body?.message);
    recordAgentEvent(result);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Travel assistant request failed:', error);
    recordAgentEvent({ intent: 'error', provider: 'rules', requiresHumanReview: false, failed: true });
    return NextResponse.json({ error: '안내를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 400 });
  }
}

export async function GET(request) {
  const metricsToken = process.env.AGENT_METRICS_TOKEN;
  if (!metricsToken || request.headers.get('authorization') !== `Bearer ${metricsToken}`) return new Response(null, { status: 404 });
  return NextResponse.json(getAgentMetrics(), { headers: { 'Cache-Control': 'no-store' } });
}
