-- Billing details for GST invoices, and who paused a campaign (so dayparting only re-enables its own pauses)
alter table orgs add column if not exists billing_name text;
alter table orgs add column if not exists billing_gstin text;
alter table orgs add column if not exists billing_state_code text;
alter table orgs add column if not exists billing_address text;

alter table campaigns add column if not exists paused_by_daypart boolean not null default false;

create table if not exists negative_keywords (
  org_id      bigint not null references orgs(id) on delete cascade,
  campaign_id text not null,
  keyword     text not null,
  match_type  text not null default 'negativeExact',
  created_at  timestamptz not null default now(),
  primary key (org_id, campaign_id, keyword)
);
