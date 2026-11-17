-- Brand Analytics repeat purchase report, and listing content fields from the category listings report
create table repeat_purchase (
  org_id        bigint not null references orgs(id) on delete cascade,
  period_end    date not null,
  asin          text not null,
  title         text,
  orders        int,
  unique_customers int,
  repeat_customers_pct numeric(6,2),
  repeat_revenue numeric(14,2),
  repeat_revenue_pct numeric(6,2),
  primary key (org_id, period_end, asin)
);

alter table products add column if not exists title_length int;
alter table products add column if not exists description_length int;
