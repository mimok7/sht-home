<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Homepage work

- `shthome.stayhalong.com` and local `localhost:3000` are the fixed official homepage initial screen. Do not change their screen, menu, or calls to action while the homepage remains under review, unless the user explicitly requests a change to that domain.
- `stayhalong.com` is the temporary homepage operating screen until final acceptance. Make ongoing homepage changes only to its `StayHalongLanding` experience.
- The two domains are selected in `src/app/page.js` by request host and must remain visibly distinct, including their header menu behavior and call-to-action labels and destinations.
- Keep `/home` removed unless the user explicitly requests restoring that route.

## Reservation and payment migration

- Display every customer-facing price or amount right-aligned on desktop and mobile. Do not introduce mobile CSS overrides that move a price, total, or rate value to the left.
- Follow `docs/homepage-reservation-payment-plan.md` for all reservation and payment work.
- Do not modify the existing `sht-platform` customer, manager, reservation, or payment implementation. It must remain independently operable throughout the migration.
- Build the replacement customer booking experience only in this homepage repository. Keep the existing customer platform and the new homepage flow running in parallel until explicit acceptance and cutover approval.
- Keep manager reservation operations in the existing platform. The homepage replaces customer-facing functions only.
- Use the platform Supabase project as the authority for customer identity, reservations, quotes, and payments. The homepage Supabase project may additionally store the customer-facing `homepage_booking_carts` selection draft, but never a reservation, quote, or payment ledger.
- Do not change platform tables, columns, RLS policies, functions, triggers, or payment endpoints without separate explicit approval and a zero-impact compatibility review. Prefer using the existing data contract as-is.
- Do not remove or redirect the existing platform entry points during parallel operation. Clearly label the homepage flow as a new/beta flow until cutover.
- Revalidate availability and price against platform data before a reservation mutation. Never trust URL parameters or homepage cache values as final price data.
- Keep payment provider secrets server-only. Preserve the existing manager-issued OnePay workflow until a homepage-native payment flow has passed ownership, amount, signature, idempotency, failure, and duplicate-notification tests.

## Version control

- Always create a Git commit after modifying files. Include only the files relevant to the completed task.
