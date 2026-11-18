-- Connections hub: one connection per platform per brand, with encrypted credentials and an inbound webhook address.
create table if not exists integrations (
  id            bigserial primary key,
  org_id        bigint not null references orgs(id) on delete cascade,
  platform      text not null,
  settings      jsonb not null default '{}',        -- non-secret fields (store URL, seller ID…)
  secrets_enc   text,                               -- AES-256-GCM encrypted JSON of secret fields
  status        text not null default 'saved',      -- saved | connected | error
  message       text,                               -- last test result, in plain words
  last_test_at  timestamptz,
  webhook_token text not null unique,               -- secret part of the inbound webhook URL
  signing_enc   text not null,                      -- encrypted Pulse signing secret (generic webhooks, outgoing events)
  created_by    bigint references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, platform)
);

create table if not exists webhook_events (
  id             bigserial primary key,
  org_id         bigint not null references orgs(id) on delete cascade,
  integration_id bigint not null references integrations(id) on delete cascade,
  platform       text not null,
  topic          text,
  verified       boolean not null default false,
  body           jsonb,                             -- parsed JSON body, when it is JSON
  body_text      text,                              -- raw body (first 64 KB) when it is not JSON
  received_at    timestamptz not null default now()
);
create index if not exists webhook_events_org_idx on webhook_events (org_id, received_at desc);
create index if not exists webhook_events_integration_idx on webhook_events (integration_id, id desc);
