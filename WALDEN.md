# Walden Local demo portal

Fork of `recharge-meal-kit-demo-portal`, restyled for Walden Local (store `se-waldenlocal-sp` / `se-waldenlocal.myshopify.com`).

## Status: UX pass
All screens render live Recharge + Shopify data. Actions (change date, skip/unskip, one-time address, nickname, save order) are captured by each route's `action` and return `wired: false`, so the UI shows a "preview" toast. Nothing is written to Recharge yet.

| Route | Screen |
|---|---|
| `/:customerId` | Upcoming Orders (delivery-date-first cards) + Change Delivery Date / Confirm / Skip / Edit Shipping Address modals |
| `/:customerId/plans` | Your Plans |
| `/:customerId/shop?charge=:id` | Shop All + My Order panel (edit one delivery) |
| `/:customerId/orders` | Order History |
| `/:customerId/account` | Account (legacy body, Walden shell) |

## Where things live
- `app/lib/walden/config.ts`: order minimum, capture/edit-cutoff business days, skip reasons
- `app/lib/walden/dates.ts`: delivery ↔ charge date maths (R-01, R-03, R-06)
- `app/lib/walden/portal.server.ts`: maps Recharge charges/subscriptions/bundle selections + Shopify products into view models. `getDeliveryOptions()` is a **placeholder** for the zip calendar (R-02) until Walden's metaobject calendar is wired.
- `app/components/walden/*`: header/footer shell, order card, modals
- Brand: `tailwind.config.ts` (forest / cream / carrot / gold), `public/walden-logo.svg`

## Run
`npm install && npm run dev` → http://localhost:5173. Fill `.env` first; sign in with `DEMO_BYPASS_EMAIL` to open `DEMO_CUSTOMER_ID` without an email code.
