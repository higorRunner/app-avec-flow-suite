-- REINICIALIZAÇÃO DESTRUTIVA DO FLOWSUITE.
-- Remove dados, contas e configurações das versões do FlowSuite.
-- Execute como proprietário do banco, após exportar um backup.
-- Os schemas de infraestrutura do Supabase permanecem disponíveis.
BEGIN;

DO $reset$
DECLARE fn record; table_name text;
BEGIN
  -- Remove somente os segredos do Vault referenciados pelo antigo FlowSuite.
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    IF to_regclass('public.fs_integration_settings') IS NOT NULL THEN
      EXECUTE 'DELETE FROM vault.secrets WHERE id IN (
        SELECT catalog_password_id FROM public.fs_integration_settings
        UNION SELECT avec_token_id FROM public.fs_integration_settings)';
    END IF;
    IF to_regclass('public.fs_clickmassa_senders') IS NOT NULL THEN
      EXECUTE 'DELETE FROM vault.secrets WHERE id IN (SELECT secret_id FROM public.fs_clickmassa_senders)';
    END IF;
  END IF;
  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND (p.proname LIKE 'fs\_%' ESCAPE '\' OR p.proname IN (
      'init_profile','is_master','has_tenant','can_manage','create_establishment',
      'update_integration_credentials','grant_membership_by_email','verify_tenant_references'))
  LOOP EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE',fn.signature); END LOOP;
  FOREACH table_name IN ARRAY ARRAY[
    'fs_report_previews','fs_feedback','fs_alert_settings','fs_avec_records','fs_professionals',
    'fs_events','fs_jobs','fs_rules','fs_appointments','fs_services','fs_contacts','fs_templates','fs_channels',
    'fs_credentials','fs_memberships','fs_sessions','fs_users','fs_units','fs_runtime',
    'fs_clickmassa_senders','fs_integration_settings','avec_report_snapshots','integration_logs',
    'message_jobs','automation_services','automations','appointments','customers','services','templates','channels',
    'integration_status','integration_secrets','memberships','establishments','profiles']
  LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE',table_name); END LOOP;
END;
$reset$;

CREATE TABLE public.fs_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK(email=lower(email)),
 name text NOT NULL,
 password_hash text NOT NULL,
 master boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 must_change_password boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fs_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_hash text NOT NULL UNIQUE,
 user_id uuid NOT NULL REFERENCES public.fs_users ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.fs_sessions(expires_at);
CREATE TABLE public.fs_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
 active boolean NOT NULL DEFAULT true,
 catalog_tenant text,
 sync_state text NOT NULL DEFAULT 'unconfigured',
 sync_error text,
 synced_at timestamptz,
 avec_state text NOT NULL DEFAULT 'unconfigured',
 avec_error text,
 avec_checked_at timestamptz,
 avec_sample jsonb,
 avec_mapping jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fs_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.fs_users ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('manager','operator','viewer')),
 UNIQUE(unit_id,user_id)
);
CREATE TABLE public.fs_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 kind text NOT NULL,
 encrypted text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(unit_id,kind)
);
CREATE TABLE public.fs_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 external_id text NOT NULL,
 name text NOT NULL,
 type text NOT NULL CHECK(type IN ('waba','whatsapp')),
 active boolean NOT NULL DEFAULT false,
 enabled boolean NOT NULL DEFAULT false,
 configured boolean NOT NULL DEFAULT false,
 UNIQUE(unit_id,external_id),
 UNIQUE(unit_id,id)
);
CREATE TABLE public.fs_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL,
 channel_id uuid NOT NULL,
 external_id text NOT NULL,
 provider_id text NOT NULL,
 name text NOT NULL,
 body text NOT NULL,
 variables jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(variables)='array'),
 active boolean NOT NULL DEFAULT false,
 supported boolean NOT NULL DEFAULT false,
 FOREIGN KEY(unit_id,channel_id) REFERENCES public.fs_channels(unit_id,id) ON DELETE CASCADE,
 UNIQUE(unit_id,external_id),
 UNIQUE(unit_id,id)
);
CREATE TABLE public.fs_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 external_id text,
 name text NOT NULL,
 phone text NOT NULL,
 email text,
 birthday date,
 consent boolean NOT NULL DEFAULT false,
 UNIQUE(unit_id,phone),
 UNIQUE(unit_id,id)
);
CREATE TABLE public.fs_services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 name text NOT NULL,
 return_days integer CHECK(return_days BETWEEN 1 AND 3650),
 UNIQUE(unit_id,id)
);
CREATE TABLE public.fs_appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL,
 contact_id uuid NOT NULL,
 service_id uuid NOT NULL,
 scheduled_at timestamptz NOT NULL,
 completed_at timestamptz,
 canceled boolean NOT NULL DEFAULT false,
 FOREIGN KEY(unit_id,contact_id) REFERENCES public.fs_contacts(unit_id,id) ON DELETE CASCADE,
 FOREIGN KEY(unit_id,service_id) REFERENCES public.fs_services(unit_id,id) ON DELETE CASCADE,
 UNIQUE(unit_id,id)
);
CREATE INDEX ON public.fs_appointments(unit_id,contact_id,completed_at DESC);
CREATE TABLE public.fs_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL,
 name text NOT NULL,
 type text NOT NULL CHECK(type IN ('post_service','csat','return','birthday','inactive','cross_sell')),
 channel_id uuid NOT NULL,
 template_id uuid NOT NULL,
 service_id uuid,
 target_service_id uuid,
 delay_days integer NOT NULL DEFAULT 0 CHECK(delay_days BETWEEN 0 AND 3650),
 cooldown_days integer NOT NULL DEFAULT 7 CHECK(cooldown_days BETWEEN 0 AND 3650),
 send_time time NOT NULL DEFAULT '09:00',
 appointment_statuses jsonb NOT NULL DEFAULT '["finalized","paid"]'::jsonb CHECK(jsonb_typeof(appointment_statuses)='array'),
 mapping jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(mapping)='object'),
 enabled boolean NOT NULL DEFAULT false,
 armed_at timestamptz,
 FOREIGN KEY(unit_id,channel_id) REFERENCES public.fs_channels(unit_id,id),
 FOREIGN KEY(unit_id,template_id) REFERENCES public.fs_templates(unit_id,id),
 FOREIGN KEY(unit_id,service_id) REFERENCES public.fs_services(unit_id,id),
 FOREIGN KEY(unit_id,target_service_id) REFERENCES public.fs_services(unit_id,id),
 UNIQUE(unit_id,id)
);
CREATE TABLE public.fs_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL,
 channel_id uuid NOT NULL,
 template_id uuid,
 contact_id uuid,
 rule_id uuid,
 phone text NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 kind text NOT NULL CHECK(kind IN ('test','manual','automatic')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','accepted','sent','delivered','read','failed','skipped')),
 idempotency_key text NOT NULL,
 external_id text,
 error text,
 attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 scheduled_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 FOREIGN KEY(unit_id,channel_id) REFERENCES public.fs_channels(unit_id,id),
 FOREIGN KEY(unit_id,template_id) REFERENCES public.fs_templates(unit_id,id),
 FOREIGN KEY(unit_id,contact_id) REFERENCES public.fs_contacts(unit_id,id),
 FOREIGN KEY(unit_id,rule_id) REFERENCES public.fs_rules(unit_id,id),
 UNIQUE(unit_id,idempotency_key)
);
CREATE INDEX ON public.fs_jobs(unit_id,created_at DESC);
CREATE INDEX ON public.fs_jobs(scheduled_at) WHERE status='queued';
CREATE INDEX ON public.fs_jobs(rule_id,contact_id,created_at DESC);
CREATE TABLE public.fs_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid REFERENCES public.fs_units ON DELETE CASCADE,
 event text NOT NULL,
 state text NOT NULL,
 detail text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.fs_events(unit_id,created_at DESC);
CREATE TABLE public.fs_runtime (
 id text PRIMARY KEY,
 version text NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT now()
);

-- O servidor é o ponto de acesso aos dados. Cada rota valida identidade,
-- unidade e perfil antes de usar a credencial privada do Supabase.
DO $permissions$
DECLARE item record;
BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'fs\_%' ESCAPE '\'
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item.tablename);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',item.tablename);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',item.tablename);
 END LOOP;
END;
$permissions$;

CREATE FUNCTION public.fs_bootstrap(p_email text,p_name text,p_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(80422001);
 IF EXISTS(SELECT 1 FROM public.fs_users WHERE master) THEN RETURN false; END IF;
 INSERT INTO public.fs_users(email,name,password_hash,master) VALUES(lower(p_email),p_name,p_hash,true);
 RETURN true;
END;
$$;

CREATE FUNCTION public.fs_catalog_commit(p_unit uuid,p_channels jsonb,p_templates jsonb,p_tenant text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c jsonb; t jsonb; channel uuid;
BEGIN
 PERFORM 1 FROM public.fs_units WHERE id=p_unit AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unidade indisponível'; END IF;
 IF EXISTS(SELECT 1 FROM public.fs_units WHERE id=p_unit AND catalog_tenant IS NOT NULL AND catalog_tenant<>p_tenant)
 THEN RAISE EXCEPTION 'Empresa Clickmassa diferente da cadastrada'; END IF;
 UPDATE public.fs_channels SET active=false WHERE unit_id=p_unit;
 UPDATE public.fs_templates SET active=false WHERE unit_id=p_unit;
 FOR c IN SELECT * FROM jsonb_array_elements(p_channels) LOOP
  INSERT INTO public.fs_channels(unit_id,external_id,name,type,active)
  VALUES(p_unit,c->>'external_id',c->>'name',c->>'type',(c->>'active')::boolean)
  ON CONFLICT(unit_id,external_id) DO UPDATE SET name=excluded.name,type=excluded.type,active=excluded.active;
 END LOOP;
 FOR t IN SELECT * FROM jsonb_array_elements(p_templates) LOOP
  SELECT id INTO channel FROM public.fs_channels WHERE unit_id=p_unit AND external_id=t->>'channel_external_id';
  INSERT INTO public.fs_templates(unit_id,channel_id,external_id,provider_id,name,body,variables,active,supported)
  VALUES(p_unit,channel,t->>'external_id',t->>'provider_template_id',t->>'name',t->>'body',t->'variables',true,t->>'status'='active')
  ON CONFLICT(unit_id,external_id) DO UPDATE SET name=excluded.name,body=excluded.body,variables=excluded.variables,
   active=true,supported=excluded.supported,provider_id=excluded.provider_id,channel_id=excluded.channel_id;
 END LOOP;
 UPDATE public.fs_units SET catalog_tenant=p_tenant,sync_state='ready',sync_error=NULL,synced_at=now() WHERE id=p_unit;
END;
$$;

CREATE FUNCTION public.fs_enqueue(p_unit uuid,p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE added integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_unit::text,80422));
 IF NOT EXISTS(SELECT 1 FROM public.fs_units WHERE id=p_unit AND active) THEN RAISE EXCEPTION 'Unidade indisponível'; END IF;
 INSERT INTO public.fs_jobs(unit_id,channel_id,template_id,contact_id,rule_id,phone,payload,kind,idempotency_key,scheduled_at)
 SELECT p_unit,r.channel_id,r.template_id,r.contact_id,r.rule_id,r.phone,r.payload,r.kind,r.idempotency_key,coalesce(r.scheduled_at,now())
 FROM jsonb_to_recordset(p_rows) AS r(channel_id uuid,template_id uuid,contact_id uuid,rule_id uuid,phone text,payload jsonb,kind text,idempotency_key text,scheduled_at timestamptz)
 WHERE r.rule_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.fs_jobs old JOIN public.fs_rules rule ON rule.id=r.rule_id AND rule.unit_id=p_unit
  WHERE old.rule_id=r.rule_id AND old.contact_id=r.contact_id AND old.unit_id=p_unit
   AND old.status IN ('queued','processing','accepted','sent','delivered','read')
   AND old.created_at>now()-make_interval(days=>rule.cooldown_days)
 )
 ON CONFLICT(unit_id,idempotency_key) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN added;
END;
$$;

CREATE FUNCTION public.fs_claim() RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE claimed public.fs_jobs%ROWTYPE;
BEGIN
 SELECT j.* INTO claimed FROM public.fs_jobs j WHERE j.status='queued' AND j.scheduled_at<=now()
 ORDER BY j.scheduled_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.fs_jobs SET status='processing',attempts=attempts+1,
  error='Envio reservado. Se o processo parar, confira o protocolo no Clickmassa antes de repetir.' WHERE id=claimed.id;
 RETURN to_jsonb(claimed);
END;
$$;

REVOKE ALL ON FUNCTION public.fs_bootstrap(text,text,text),public.fs_catalog_commit(uuid,jsonb,jsonb,text),
 public.fs_enqueue(uuid,jsonb),public.fs_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fs_bootstrap(text,text,text),public.fs_catalog_commit(uuid,jsonb,jsonb,text),
 public.fs_enqueue(uuid,jsonb),public.fs_claim() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
