-- Per-unit cost sheets entered on Profit and loss: a product's raw material, packaging and marketing cost,
-- or a bundle made of other products (items) plus its own extra costs.
create table if not exists cost_sheets (
  id           bigserial primary key,
  org_id       bigint not null references orgs(id) on delete cascade,
  sku          text not null,
  name         text,
  kind         text not null default 'product' check (kind in ('product', 'bundle')),
  raw_material numeric(14,2) not null default 0 check (raw_material >= 0),
  packaging    numeric(14,2) not null default 0 check (packaging >= 0),
  marketing    numeric(14,2) not null default 0 check (marketing >= 0),
  items        jsonb not null default '[]',      -- bundles: [{ "sku": "...", "qty": 2 }]
  updated_by   bigint references users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  unique (org_id, sku)
);
