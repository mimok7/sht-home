import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Exercise real route logic against isolated PostgREST-shaped storage; no live bookings.
const contract = pathToFileURL(`${process.cwd()}/src/lib/booking-cart-contract.js`).href;
let context;
globalThis.bookingTestContext = () => context;
const deps = `const getPlatformCartOwner = async () => globalThis.bookingTestContext().owner;
const getBookingCartDatabase = () => globalThis.bookingTestContext().db;
const getPlatformUserDatabase = () => globalThis.bookingTestContext().db;
const getPlatformBearerToken = () => 'test';`;
async function route(path) {
  let source = await readFile(path, 'utf8');
  source = source.replace(/import .* from '@\/lib\/homepage-booking-cart-server';/g, deps)
    .replace("'@/lib/booking-cart-contract'", JSON.stringify(contract));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const submit = await route('src/app/api/booking/submit/route.js');
const cartRoute = await route('src/app/api/booking/cart/route.js');
const create = await route('src/app/api/payments/onepay/create/route.js');
const notify = await route('src/app/api/payments/onepay/notify/route.js');
const returned = await route('src/app/api/payments/onepay/return/route.js');
function setup({ failDetail = false, otherOwner = false } = {}) {
  const item = { id: 'item', serviceType: 'hotel', productId: 'hotel', name: 'Test hotel', optionId: 'rate', startDate: '2099-01-01', endDate: '2099-01-03', adults: 2, quantity: 1, unitPrice: 1, currency: 'VND', metadata: { platform: { contractVersion: 2, hotelPriceCode: 'rate', checkin: '2099-01-01', checkout: '2099-01-03', roomCount: 1 } } };
  const tables = { homepage_booking_carts: [{ id: 'cart', platform_user_id: otherOwner ? 'other' : 'owner', status: 'active', updated_at: 'version1', items: [item] }], users: [{ id: 'owner', name: 'Test' }], quote: [], reservation: [], reservation_hotel: [], hotel_price: [{ hotel_price_code: 'rate', base_price: 500000, start_date: '2098-01-01', end_date: '2100-01-01' }] };
  const db = { from(table) {
    let action = 'select', values, single = false;
    const filters = [];
    const q = {
      select() { return q; }, eq(key, value) { filters.push(r => r[key] === value); return q; },
      insert(value) { action = 'insert'; values = value; return q; }, update(value) { action = 'update'; values = value; return q; },
      maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (failDetail && table === 'reservation_hotel' && action === 'insert') return { data: null, error: { message: 'injected detail failure' } };
        const rows = tables[table] ||= [];
        let result = rows.filter(r => filters.every(f => f(r)));
        if (action === 'insert') { result = (Array.isArray(values) ? values : [values]).map(v => ({ id: `id-${rows.length}`, re_id: `reservation-${rows.length}`, ...v })); rows.push(...result); }
        if (action === 'update') result.forEach(r => Object.assign(r, values));
        return { data: structuredClone(single ? result[0] || null : result), error: null };
      }).then(resolve, reject); },
    }; return q;
  } };
  context = { owner: { id: 'owner', email: 'test@example.invalid' }, db, tables, item };
  return context;
}
const request = (body = { updatedAt: 'version1' }) => new Request('https://example.invalid/api/booking/submit', { method: 'POST', body: JSON.stringify(body) });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
await check('anonymous submission denied', async () => { setup(); context.owner = null; assert.equal((await submit.POST(request())).status, 401); });
await check('another customer cart cannot be submitted', async () => { setup({ otherOwner: true }); assert.equal((await submit.POST(request())).status, 409); assert.equal(context.tables.reservation.length, 0); });
await check('stale checkout blocked before writes', async () => { setup(); assert.equal((await submit.POST(request({updatedAt:'old'}))).status, 409); assert.equal(context.tables.quote.length, 0); });
await check('simultaneous submission saves once at server price', async () => {
  setup(); const responses = await Promise.all([submit.POST(request()), submit.POST(request())]);
  assert.deepEqual(responses.map(r=>r.status).sort(), [200,409]);
  assert.equal(context.tables.reservation.length, 1); assert.equal(context.tables.reservation[0].total_amount, 1000000);
  assert.equal(context.tables.reservation_hotel.length, 1); assert.equal(context.tables.homepage_booking_carts[0].items.length, 0);
});
await check('detail failure preserves parent and blocks retry', async () => {
  setup({failDetail:true}); assert.equal((await submit.POST(request())).status, 409);
  assert.equal(context.tables.reservation.length, 1); assert.equal(context.tables.homepage_booking_carts[0].status,'review_required');
  assert.equal((await submit.POST(request())).status,409); assert.equal(context.tables.reservation.length,1);
});
await check('processing cart cannot be overwritten', async () => {
  setup(); context.tables.homepage_booking_carts[0].status='submitting';
  assert.equal((await cartRoute.PUT(request({items:[]}))).status,409); assert.equal(context.tables.homepage_booking_carts[0].items.length,1);
});
await check('checkout before checkin rejected', async () => {
  setup(); context.item.metadata.platform.checkout='2098-12-31'; assert.equal((await submit.POST(request())).status,400); assert.equal(context.tables.reservation.length,0);
});
await check('expired room rate rejected', async () => {
  setup(); context.tables.hotel_price[0].end_date='2099-01-01'; assert.equal((await submit.POST(request())).status,400); assert.equal(context.tables.reservation.length,0);
});
await check('manager payment workflow prevents direct charges', async () => {
  setup(); assert.equal((await create.POST(request())).status,409); assert.equal(context.tables.reservation.length,0);
  context.owner=null; assert.equal((await create.POST(request())).status,401);
});
await check('forged callback cannot mark payment complete', async () => {
  setup(); assert.equal((await notify.GET(request())).status,410);
  const response=await returned.GET(new Request('https://example.invalid/api/payments/onepay/return?vpc_TxnResponseCode=0'));
  assert.equal(response.headers.get('location'),'https://example.invalid/booking/reservations?payment=review');
});
console.log(`${passed} booking/payment regression checks passed`);
delete globalThis.bookingTestContext;
