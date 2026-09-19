// Invoice payments are reconciled by staff; a browser redirect never proves payment.
export const runtime = 'nodejs';

export async function GET(request) {
  return Response.redirect(new URL('/booking/reservations?payment=review', request.url));
}
