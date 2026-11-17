create extension if not exists citext;

-- Pulse Seller Platform: initial schema.
-- Money is stored in rupees as numeric(14,2). Every business table carries org_id.

create table users (
  id            bigserial primary key,
  email         citext unique not null,
  name          text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table orgs (
  id            bigserial primary key,
  name          text not null,
  marketplace   text not null default 'Amazon.in',
  target_acos   numeric(5,2) not null default 30,
  fee_rate      numeric(5,4) not null default 0.20,     -- share of price lost to marketplace fees, used for break-even ACoS
  wallet_paise  bigint not null default 0,
  created_at    timestamptz not null default now()
);

create table memberships (
  org_id   bigint not null references orgs(id) on delete cascade,
  user_id  bigint not null references users(id) on delete cascade,
  role     text not null check (role in ('owner','admin','member','viewer')),
  primary key (org_id, user_id)
);

create table invites (
  token       text primary key,
  org_id      bigint not null references orgs(id) on delete cascade,
  email       citext not null,
  role        text not null,
  invited_by  bigint references users(id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

create table sessions (
  token_hash  text primary key,
  user_id     bigint not null references users(id) on delete cascade,
  org_id      bigint references orgs(id) on delete set null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index on sessions (user_id);

-- Catalogue -----------------------------------------------------------------
create table products (
  org_id       bigint not null references orgs(id) on delete cascade,
  sku          text not null,
  asin         text,
  name         text not null default '',
  category     text,
  price        numeric(12,2),
  cogs         numeric(12,2),
  images       int,
  bullets      int,
  has_aplus    boolean,
  rating       numeric(3,2),
  reviews      int,
  status       text,               -- Active, Inactive, Suppressed
  suppressed_reason text,
  fba_qty      int not null default 0,
  fbm_qty      int not null default 0,
  inventory_as_of date,
  updated_at   timestamptz not null default now(),
  primary key (org_id, sku)
);

create table product_links (     -- product master: one SKU mapped to listings on several marketplaces
  org_id      bigint not null references orgs(id) on delete cascade,
  sku         text not null,
  marketplace text not null,
  external_id text,
  primary key (org_id, sku, marketplace)
);

-- Sales ---------------------------------------------------------------------
create table order_items (
  org_id        bigint not null references orgs(id) on delete cascade,
  order_id      text not null,
  sku           text not null,
  purchased_at  timestamptz not null,
  status        text not null,           -- Shipped, Pending, Cancelled, Unshipped
  fulfillment   text,                    -- Amazon or Merchant
  ship_service  text,
  quantity      int not null default 0,
  item_price    numeric(12,2) not null default 0,
  item_tax      numeric(12,2) not null default 0,
  shipping_price numeric(12,2) not null default 0,
  promo_discount numeric(12,2) not null default 0,
  ship_city     text,
  ship_state    text,
  ship_postal   text,
  is_business   boolean not null default false,
  promotion_ids text,
  buyer_key     text,                    -- hashed buyer identifier when the report has one, for repeat purchase
  primary key (org_id, order_id, sku)
);
create index on order_items (org_id, purchased_at);

create table returns (
  org_id        bigint not null references orgs(id) on delete cascade,
  order_id      text not null,
  sku           text not null,
  returned_at   date not null,
  quantity      int not null default 1,
  refund_amount numeric(12,2),
  reason        text,
  status        text,
  carrier       text,
  label_paid_by text,
  a_to_z        boolean,
  primary key (org_id, order_id, sku, returned_at)
);
create index on returns (org_id, returned_at);

create table traffic_daily (    -- Business Report: sessions and page views
  org_id      bigint not null references orgs(id) on delete cascade,
  day         date not null,
  sku         text not null,
  sessions    int not null default 0,
  page_views  int not null default 0,
  buy_box_pct numeric(5,2),
  primary key (org_id, day, sku)
);

create table transactions (     -- settlement / date range transaction report, for P&L
  id          bigserial primary key,
  org_id      bigint not null references orgs(id) on delete cascade,
  posted_at   timestamptz not null,
  type        text not null,
  order_id    text,
  sku         text,
  description text,
  quantity    int,
  product_sales numeric(12,2) not null default 0,
  shipping_credits numeric(12,2) not null default 0,
  promo_rebates numeric(12,2) not null default 0,
  selling_fees numeric(12,2) not null default 0,
  fba_fees    numeric(12,2) not null default 0,
  other_fees  numeric(12,2) not null default 0,
  tax_withheld numeric(12,2) not null default 0,
  other       numeric(12,2) not null default 0,
  total       numeric(12,2) not null default 0,
  row_key     text not null,
  unique (org_id, row_key)
);
create index on transactions (org_id, posted_at);

create table coupons (
  org_id     bigint not null references orgs(id) on delete cascade,
  coupon_id  text not null,
  name       text,
  discount_type text,
  discount   numeric(10,2),
  budget     numeric(12,2),
  spent      numeric(12,2),
  clips      int, redemptions int, sales numeric(12,2),
  starts_on  date, ends_on date,
  primary key (org_id, coupon_id)
);

create table deals (
  org_id    bigint not null references orgs(id) on delete cascade,
  deal_id   text not null,
  type      text, sku text, starts_at timestamptz, ends_at timestamptz,
  glance_views int, units int, revenue numeric(12,2), status text,
  primary key (org_id, deal_id)
);

create table account_health (
  org_id   bigint not null references orgs(id) on delete cascade,
  as_of    date not null,
  source   text not null,          -- api or manual
  metrics  jsonb not null,
  primary key (org_id, as_of)
);

-- Advertising ---------------------------------------------------------------
create table campaigns (
  org_id      bigint not null references orgs(id) on delete cascade,
  campaign_id text not null,          -- Amazon campaign id, or name-hash for uploaded reports
  name        text not null,
  ad_type     text not null check (ad_type in ('SP','SB','SD')),
  status      text not null default 'Live',
  daily_budget numeric(12,2),
  bid_adjust_pct int not null default 0,
  starts_on   date,
  portfolio   text,
  sku         text,                    -- main advertised SKU, when known
  remote      boolean not null default false,   -- true when synced through the Ads API, so changes can be pushed
  updated_at  timestamptz not null default now(),
  primary key (org_id, campaign_id)
);

create table ad_daily (
  org_id      bigint not null references orgs(id) on delete cascade,
  campaign_id text not null,
  day         date not null,
  impressions int not null default 0,
  clicks      int not null default 0,
  spend       numeric(12,2) not null default 0,
  sales       numeric(12,2) not null default 0,
  orders      int not null default 0,
  units       int not null default 0,
  primary key (org_id, campaign_id, day)
);

create table ad_terms (           -- search term and targeting rows, per day
  org_id      bigint not null references orgs(id) on delete cascade,
  campaign_id text not null,
  ad_group    text not null default '',
  targeting   text not null default '',
  match_type  text not null default '',
  search_term text not null,
  day         date not null,
  impressions int not null default 0,
  clicks      int not null default 0,
  spend       numeric(12,2) not null default 0,
  sales       numeric(12,2) not null default 0,
  orders      int not null default 0,
  primary key (org_id, campaign_id, ad_group, targeting, search_term, day)
);

create table ad_placements (
  org_id      bigint not null references orgs(id) on delete cascade,
  campaign_id text not null,
  placement   text not null,
  day         date not null,
  impressions int not null default 0, clicks int not null default 0,
  spend numeric(12,2) not null default 0, sales numeric(12,2) not null default 0, orders int not null default 0,
  primary key (org_id, campaign_id, placement, day)
);

create table ad_changes (          -- every change made through Pulse: insights applied, toggles, budgets
  id          bigserial primary key,
  org_id      bigint not null references orgs(id) on delete cascade,
  user_id     bigint references users(id),
  campaign_id text,
  action      text not null,
  detail      jsonb not null default '{}',
  pushed      boolean not null default false,    -- true when sent to Amazon through the Ads API
  push_error  text,
  created_at  timestamptz not null default now()
);

create table trackers (
  id        bigserial primary key,
  org_id    bigint not null references orgs(id) on delete cascade,
  name      text not null, metric text not null, op text not null, value numeric not null,
  frequency text not null, range_days int not null, level text not null, enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table dayparts (
  id          bigserial primary key,
  org_id      bigint not null references orgs(id) on delete cascade,
  campaign_id text not null, days text not null, hours_off int[] not null,
  created_at  timestamptz not null default now()
);

-- Data connections and imports ---------------------------------------------
create table connections (
  org_id      bigint not null references orgs(id) on delete cascade,
  kind        text not null,      -- sp_api, ads_api
  config      jsonb not null default '{}',   -- non-secret settings (region, marketplace, profile id)
  secret_enc  text,               -- AES-256-GCM encrypted JSON of secrets
  status      text not null default 'connected',
  last_sync_at timestamptz,
  last_error  text,
  primary key (org_id, kind)
);

create table imports (
  id         bigserial primary key,
  org_id     bigint not null references orgs(id) on delete cascade,
  user_id    bigint references users(id),
  source     text not null,       -- upload or sp_api or ads_api
  report     text not null,
  filename   text,
  rows_read  int not null default 0,
  rows_saved int not null default 0,
  status     text not null default 'done',
  message    text,
  created_at timestamptz not null default now()
);

create table jobs (
  id         bigserial primary key,
  org_id     bigint not null references orgs(id) on delete cascade,
  kind       text not null,
  run_after  timestamptz not null default now(),
  state      text not null default 'queued',   -- queued, running, done, failed
  attempts   int not null default 0,
  payload    jsonb not null default '{}',
  result     text,
  updated_at timestamptz not null default now()
);
create index on jobs (state, run_after);

-- Copilot, agents, wallet ---------------------------------------------------
create table copilot_memory (
  id     bigserial primary key,
  org_id bigint not null references orgs(id) on delete cascade,
  fact   text not null,
  created_at timestamptz not null default now()
);

create table chats (
  id      bigserial primary key,
  org_id  bigint not null references orgs(id) on delete cascade,
  user_id bigint references users(id),
  title   text not null,
  created_at timestamptz not null default now()
);
create table chat_messages (
  id      bigserial primary key,
  chat_id bigint not null references chats(id) on delete cascade,
  role    text not null check (role in ('user','assistant')),
  content text not null,
  meta    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table agent_runs (
  id        bigserial primary key,
  org_id    bigint not null references orgs(id) on delete cascade,
  user_id   bigint references users(id),
  agent     text not null,
  input     jsonb not null,
  output    jsonb,
  cost_paise bigint not null,
  status    text not null,          -- done, failed, refunded
  created_at timestamptz not null default now()
);

create table wallet_ledger (
  id          bigserial primary key,
  org_id      bigint not null references orgs(id) on delete cascade,
  amount_paise bigint not null,     -- positive = top-up, negative = spend
  kind        text not null,        -- topup, agent, refund, adjustment
  description text not null,
  ref         text unique,          -- payment id or agent run id, prevents double credit
  created_at  timestamptz not null default now()
);

create table payments (
  order_id    text primary key,     -- Razorpay order id
  org_id      bigint not null references orgs(id) on delete cascade,
  amount_paise bigint not null,     -- amount charged including GST
  credit_paise bigint not null,     -- wallet credit (taxable value)
  status      text not null default 'created',
  payment_id  text,
  invoice_no  text unique,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create sequence invoice_seq start 1001;

create table audit_log (
  id       bigserial primary key,
  org_id   bigint references orgs(id) on delete cascade,
  user_id  bigint references users(id),
  action   text not null,
  detail   jsonb not null default '{}',
  created_at timestamptz not null default now()
);
