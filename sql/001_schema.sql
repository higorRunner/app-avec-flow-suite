-- Execute no SQL Editor do Supabase, como proprietário do projeto.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  master_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.establishments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active boolean not null default true,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.memberships (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'operator' check(role in ('owner','manager','operator','viewer')),
  created_at timestamptz not null default now(),
  primary key (establishment_id,user_id)
);
-- Credenciais privadas; acessíveis somente via RPC de escrita, não via SELECT do browser.
create table if not exists public.integration_secrets (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  avec_token text,
  clickmassa_token text,
  clickmassa_url text,
  clickmassa_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.integration_status (
  establishment_id uuid primary key references public.establishments(id) on delete cascade,
  avec_configured boolean not null default false,
  clickmassa_configured boolean not null default false,
  last_avec_sync timestamptz,
  last_clickmassa_sync timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  external_id text not null,
  name text not null,
  type text not null default 'whatsapp',
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique(establishment_id,external_id)
);
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  external_id text not null,
  name text not null,
  body text not null default '',
  variables jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  synced_at timestamptz not null default now(),
  unique(establishment_id,external_id)
);
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  external_id text not null,
  name text not null,
  default_return_days integer check(default_return_days between 1 and 3650),
  active boolean not null default true,
  synced_at timestamptz not null default now(),
  unique(establishment_id,external_id)
);
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  external_id text not null,
  name text not null default '',
  phone text,
  email text,
  birthday date,
  marketing_opt_in boolean not null default false,
  opted_out_at timestamptz,
  extra jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique(establishment_id,external_id)
);
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  external_id text not null,
  customer_id uuid references public.customers(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  status text not null default 'scheduled',
  scheduled_at timestamptz,
  completed_at timestamptz,
  arrived_at timestamptz,
  amount numeric(14,2),
  extra jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique(establishment_id,external_id)
);
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  type text not null check(type in ('csat','inactive','post_service','return','birthday','cross_sell','stock','arrival')),
  name text not null,
  enabled boolean not null default false,
  channel_id uuid references public.channels(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  delay_days integer not null default 0 check(delay_days between 0 and 3650),
  send_time time not null default '09:00',
  rules jsonb not null default '{}'::jsonb,
  variable_mapping jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.automation_services (
  automation_id uuid not null references public.automations(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key(automation_id,service_id)
);
create table if not exists public.message_jobs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  channel_id uuid references public.channels(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  source text not null default 'automatic' check(source in ('automatic','manual')),
  scheduled_for timestamptz not null default now(),
  status text not null default 'queued' check(status in ('queued','processing','sent','delivered','read','failed','skipped','canceled')),
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  external_message_id text,
  error_message text,
  attempts integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_message_jobs_idempotency on public.message_jobs(establishment_id,idempotency_key) where idempotency_key is not null;
create table if not exists public.integration_logs (
  id bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  source text not null,
  event text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ix_jobs_tenant_status_schedule on public.message_jobs(establishment_id,status,scheduled_for);
create index if not exists ix_appointments_tenant_date on public.appointments(establishment_id,scheduled_at desc);
create index if not exists ix_customers_tenant_phone on public.customers(establishment_id,phone);
create index if not exists ix_automations_tenant_type on public.automations(establishment_id,type);
create index if not exists ix_logs_tenant_created on public.integration_logs(establishment_id,created_at desc);

-- JWT identity; privilégios master são concedidos manualmente via SQL.
create or replace function public.init_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','')) on conflict(id) do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.init_profile();
insert into public.profiles(id,full_name) select id,coalesce(raw_user_meta_data->>'full_name','') from auth.users on conflict do nothing;

create or replace function public.is_master() returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select master_admin from public.profiles where id = (select auth.uid())),false)
$$;
create or replace function public.has_tenant(p_est uuid, p_roles text[] default array['owner','manager','operator','viewer']) returns boolean language sql stable security definer set search_path = '' as $$
 select public.is_master() or exists(select 1 from public.memberships m join public.establishments e on e.id=m.establishment_id where m.establishment_id=p_est and m.user_id=(select auth.uid()) and m.role=any(p_roles) and e.active=true)
$$;
create or replace function public.can_manage(p_est uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select public.is_master() or public.has_tenant(p_est,array['owner','manager'])
$$;

-- Provisionamento atômico multi-tenant: apenas master.
create or replace function public.create_establishment(p_name text,p_slug text,p_timezone text default 'America/Sao_Paulo') returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if not public.is_master() then raise exception 'Not authorized'; end if;
 if length(trim(p_name))<2 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid name or slug'; end if;
 insert into public.establishments(name,slug,timezone) values(trim(p_name),p_slug,coalesce(nullif(p_timezone,''),'America/Sao_Paulo')) returning id into v_id;
 insert into public.integration_secrets(establishment_id) values(v_id);
 insert into public.integration_status(establishment_id) values(v_id);
 return v_id;
end $$;
-- Atualização de credenciais por master, em trânsito HTTPS. Nunca devolve segredos.
create or replace function public.update_integration_credentials(p_est uuid,p_avec_token text default null,p_clickmassa_token text default null,p_clickmassa_url text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_master() then raise exception 'Not authorized'; end if;
 if p_clickmassa_url is not null and p_clickmassa_url<>'' and p_clickmassa_url !~ '^https://' then raise exception 'URL deve usar HTTPS'; end if;
 insert into public.integration_secrets(establishment_id,avec_token,clickmassa_token,clickmassa_url,clickmassa_updated_at)
 values(p_est,nullif(p_avec_token,''),nullif(p_clickmassa_token,''),nullif(p_clickmassa_url,''),case when nullif(p_clickmassa_token,'') is not null then now() else null end)
 on conflict(establishment_id) do update set
  avec_token=coalesce(excluded.avec_token,public.integration_secrets.avec_token),
  clickmassa_token=coalesce(excluded.clickmassa_token,public.integration_secrets.clickmassa_token),
  clickmassa_url=coalesce(excluded.clickmassa_url,public.integration_secrets.clickmassa_url),
  clickmassa_updated_at=case when excluded.clickmassa_token is not null then now() else public.integration_secrets.clickmassa_updated_at end,
  updated_at=now();
 insert into public.integration_status(establishment_id,avec_configured,clickmassa_configured)
 values(p_est,exists(select 1 from public.integration_secrets where establishment_id=p_est and avec_token is not null),exists(select 1 from public.integration_secrets where establishment_id=p_est and clickmassa_token is not null and clickmassa_url is not null))
 on conflict(establishment_id) do update set avec_configured=excluded.avec_configured,clickmassa_configured=excluded.clickmassa_configured,updated_at=now();
end $$;
-- Permite master atribuir usuário já cadastrado (por e-mail).
create or replace function public.grant_membership_by_email(p_est uuid,p_email text,p_role text default 'manager') returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
 if not public.is_master() then raise exception 'Not authorized'; end if;
 if p_role not in ('owner','manager','operator','viewer') then raise exception 'Invalid role'; end if;
 select id into v_uid from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null limit 1;
 if v_uid is null then raise exception 'Usuário não encontrado ou e-mail não confirmado'; end if;
 insert into public.memberships(establishment_id,user_id,role) values(p_est,v_uid,p_role)
 on conflict(establishment_id,user_id) do update set role=excluded.role;
end $$;
-- RLS no schema inteiro.
alter table public.profiles enable row level security;
alter table public.establishments enable row level security;
alter table public.memberships enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.integration_status enable row level security;
alter table public.channels enable row level security;
alter table public.templates enable row level security;
alter table public.services enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.automations enable row level security;
alter table public.automation_services enable row level security;
alter table public.message_jobs enable row level security;
alter table public.integration_logs enable row level security;

create policy "profiles read own or master" on public.profiles for select to authenticated using (id=(select auth.uid()) or public.is_master());
create policy "profiles update own name" on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
-- Não conceder UPDATE direto de master_admin a usuários!
revoke update on public.profiles from authenticated;
grant update(full_name) on public.profiles to authenticated;
create policy "establishments read members" on public.establishments for select to authenticated using(public.is_master() or exists(select 1 from public.memberships m where m.establishment_id=id and m.user_id=(select auth.uid())));
create policy "establishments update master" on public.establishments for update to authenticated using(public.is_master()) with check(public.is_master());
create policy "memberships read" on public.memberships for select to authenticated using(public.is_master() or user_id=(select auth.uid()) or public.can_manage(establishment_id));
create policy "memberships master delete" on public.memberships for delete to authenticated using(public.is_master());
-- Nenhuma política em integration_secrets -> somente service_role ou RPC security definer.
create policy "status read" on public.integration_status for select to authenticated using(public.has_tenant(establishment_id));
create policy "channels read" on public.channels for select to authenticated using(public.has_tenant(establishment_id));
create policy "templates read" on public.templates for select to authenticated using(public.has_tenant(establishment_id));
create policy "services read" on public.services for select to authenticated using(public.has_tenant(establishment_id));
create policy "customers read" on public.customers for select to authenticated using(public.has_tenant(establishment_id));
create policy "appointments read" on public.appointments for select to authenticated using(public.has_tenant(establishment_id));
create policy "automations read" on public.automations for select to authenticated using(public.has_tenant(establishment_id));
create policy "automations create" on public.automations for insert to authenticated with check(public.can_manage(establishment_id));
create policy "automations edit" on public.automations for update to authenticated using(public.can_manage(establishment_id)) with check(public.can_manage(establishment_id));
create policy "automations delete" on public.automations for delete to authenticated using(public.can_manage(establishment_id));
create policy "automation services read" on public.automation_services for select to authenticated using(exists(select 1 from public.automations a where a.id=automation_id and public.has_tenant(a.establishment_id)));
create policy "automation services create" on public.automation_services for insert to authenticated with check(exists(select 1 from public.automations a join public.services s on s.id=service_id where a.id=automation_id and a.establishment_id=s.establishment_id and public.can_manage(a.establishment_id)));
create policy "automation services delete" on public.automation_services for delete to authenticated using(exists(select 1 from public.automations a where a.id=automation_id and public.can_manage(a.establishment_id)));
create policy "jobs read" on public.message_jobs for select to authenticated using(public.has_tenant(establishment_id));
-- Envio manual: apenas criar job queued, permitido para operadores. n8n faz processamento real.
create policy "jobs manual insert" on public.message_jobs for insert to authenticated with check(public.has_tenant(establishment_id,array['owner','manager','operator']) and source='manual' and status='queued' and automation_id is null and attempts=0 and sent_at is null);
create policy "logs read" on public.integration_logs for select to authenticated using(public.has_tenant(establishment_id));

revoke all on function public.create_establishment(text,text,text) from public,anon;
revoke all on function public.update_integration_credentials(uuid,text,text,text) from public,anon;
revoke all on function public.grant_membership_by_email(uuid,text,text) from public,anon;
grant execute on function public.create_establishment(text,text,text) to authenticated;
grant execute on function public.update_integration_credentials(uuid,text,text,text) to authenticated;
grant execute on function public.grant_membership_by_email(uuid,text,text) to authenticated;
-- SERVICE_ROLE (somente no n8n seguro) pode sincronizar canais/templates/serviços/clientes e processar jobs.

-- Apenas gerentes/proprietários podem editar o intervalo médio de retorno.
create policy "services update return settings" on public.services for update to authenticated using(public.can_manage(establishment_id)) with check(public.can_manage(establishment_id));
revoke update on public.services from authenticated;
grant update(default_return_days) on public.services to authenticated;
-- Impede relações cruzadas entre estabelecimentos no agendamento de envios e nas automações.
create or replace function public.verify_tenant_references() returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_table_name='automations' then
  if new.channel_id is not null and not exists(select 1 from public.channels where id=new.channel_id and establishment_id=new.establishment_id) then raise exception 'Canal pertence a outro estabelecimento'; end if;
  if new.template_id is not null and not exists(select 1 from public.templates where id=new.template_id and establishment_id=new.establishment_id) then raise exception 'Template pertence a outro estabelecimento'; end if;
 elsif tg_table_name='message_jobs' then
  if new.channel_id is not null and not exists(select 1 from public.channels where id=new.channel_id and establishment_id=new.establishment_id) then raise exception 'Canal pertence a outro estabelecimento'; end if;
  if new.template_id is not null and not exists(select 1 from public.templates where id=new.template_id and establishment_id=new.establishment_id) then raise exception 'Template pertence a outro estabelecimento'; end if;
  if new.customer_id is not null and not exists(select 1 from public.customers where id=new.customer_id and establishment_id=new.establishment_id) then raise exception 'Cliente pertence a outro estabelecimento'; end if;
  if new.automation_id is not null and not exists(select 1 from public.automations where id=new.automation_id and establishment_id=new.establishment_id) then raise exception 'Automação pertence a outro estabelecimento'; end if;
  if new.appointment_id is not null and not exists(select 1 from public.appointments where id=new.appointment_id and establishment_id=new.establishment_id) then raise exception 'Agendamento pertence a outro estabelecimento'; end if;
  if tg_op='INSERT' and new.source='manual' and new.customer_id is not null and not exists(select 1 from public.customers where id=new.customer_id and establishment_id=new.establishment_id and marketing_opt_in and opted_out_at is null) then raise exception 'Cliente não autorizou mensagem'; end if;
 end if;
 return new;
end $$;
drop trigger if exists verify_automation_tenant on public.automations;
create trigger verify_automation_tenant before insert or update on public.automations for each row execute function public.verify_tenant_references();
drop trigger if exists verify_job_tenant on public.message_jobs;
create trigger verify_job_tenant before insert or update on public.message_jobs for each row execute function public.verify_tenant_references();

-- O n8n deve usar a SERVICE_ROLE somente do lado servidor, nunca no frontend.
