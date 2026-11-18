-- Shopify store connection: orders and catalogue pulled through the GraphQL Admin API.
-- Kept apart from the Amazon tables so Amazon analytics (fees, ACoS, FBA splits) are unchanged.

create table shopify_orders (
  org_id        bigint not null references orgs(id) on delete cascade,
  order_id      text not null,              -- gid://shopify/Order/…
  name          text not null,              -- #1068
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  cancelled_at  timestamptz,
  financial_status   text,                  -- PAID, PENDING, REFUNDED, PARTIALLY_REFUNDED …
  fulfillment_status text,                  -- FULFILLED, UNFULFILLED …
  source        text,                       -- web, shopify_draft_order, app id
  payment       text,                       -- gateway names joined, used for COD vs prepaid
  is_cod        boolean not null default false,
  subtotal      numeric(12,2) not null default 0,   -- after discounts, before shipping and tax
  shipping      numeric(12,2) not null default 0,
  tax           numeric(12,2) not null default 0,
  discounts     numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  refunded      numeric(12,2) not null default 0,
  discount_codes text,
  ship_city     text,
  ship_state    text,                       -- province code, e.g. KA
  ship_postal   text,
  customer_key  text,                       -- hashed customer id, for repeat purchase
  primary key (org_id, order_id)
);
create index on shopify_orders (org_id, created_at);

create table shopify_order_lines (
  org_id        bigint not null references orgs(id) on delete cascade,
  line_id       text not null,
  order_id      text not null,
  sku           text not null default '',
  title         text,
  product_id    text,
  variant_id    text,
  quantity      int not null default 0,      -- current quantity, after removals and refunds
  ordered_qty   int not null default 0,
  unit_price    numeric(12,2) not null default 0,
  line_total    numeric(12,2) not null default 0,   -- after line discounts, before tax
  discount      numeric(12,2) not null default 0,
  tax           numeric(12,2) not null default 0,
  primary key (org_id, line_id)
);
create index on shopify_order_lines (org_id, order_id);

create table shopify_variants (
  org_id        bigint not null references orgs(id) on delete cascade,
  variant_id    text not null,
  product_id    text not null,
  sku           text not null default '',
  product_title text not null default '',
  variant_title text,
  product_type  text,
  handle        text,
  status        text,                        -- ACTIVE, DRAFT, ARCHIVED
  price         numeric(12,2),
  compare_at    numeric(12,2),
  cost          numeric(12,2),
  inventory     int,
  updated_at    timestamptz not null default now(),
  primary key (org_id, variant_id)
);
