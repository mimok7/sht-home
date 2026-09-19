// The invoice portal uses the existing manager payment workflow.
// No homepage-issued payments exist; do not accept unconfigured payment callbacks.
export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ success: false, error: '현재 결제는 담당자 확인 방식으로 처리합니다.' }, { status: 410 });
}

export const POST = GET;
