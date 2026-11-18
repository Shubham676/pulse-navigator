-- Manual expenses entered on the Profit and loss page (rent, salaries, packaging…).
create table if not exists expenses (
  id          bigserial primary key,
  org_id      bigint not null references orgs(id) on delete cascade,
  spent_on    date not null,
  category    text not null,
  description text,
  amount      numeric(14,2) not null check (amount > 0),
  monthly     boolean not null default false,   -- repeats every month from spent_on until deleted
  created_by  bigint references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists expenses_org_idx on expenses (org_id, spent_on desc);
