-- Atualização aditiva: preserva contas, unidades, credenciais, regras e envios.
-- Execute no SQL Editor do Supabase antes de publicar esta versão do FlowSuite.
BEGIN;

ALTER TABLE public.fs_units ADD COLUMN IF NOT EXISTS avec_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.fs_units ADD COLUMN IF NOT EXISTS avec_summary jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.fs_services ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.fs_services ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.fs_services ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.fs_services ADD COLUMN IF NOT EXISTS return_source text NOT NULL DEFAULT 'avec';
ALTER TABLE public.fs_services ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.fs_appointments ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.fs_appointments ADD COLUMN IF NOT EXISTS professional_id text;
ALTER TABLE public.fs_appointments ADD COLUMN IF NOT EXISTS professional_name text;
ALTER TABLE public.fs_appointments ADD COLUMN IF NOT EXISTS arrived_at timestamptz;
ALTER TABLE public.fs_appointments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.fs_appointments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled';
ALTER TABLE public.fs_contacts ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
-- Clientes sem telefone continuam disponíveis no histórico; o envio exige número válido.
ALTER TABLE public.fs_contacts ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.fs_contacts ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.fs_contacts ADD COLUMN IF NOT EXISTS birthday_month_day text CHECK(birthday_month_day ~ '^[0-1][0-9]-[0-3][0-9]$');
CREATE UNIQUE INDEX IF NOT EXISTS fs_contacts_external_unique ON public.fs_contacts(unit_id,external_id);
CREATE UNIQUE INDEX IF NOT EXISTS fs_services_external_unique ON public.fs_services(unit_id,external_id);
CREATE UNIQUE INDEX IF NOT EXISTS fs_appointments_external_unique ON public.fs_appointments(unit_id,external_id);

CREATE TABLE IF NOT EXISTS public.fs_avec_records (
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 report_code text NOT NULL,
 external_key text NOT NULL,
 payload jsonb NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(unit_id,report_code,external_key)
);
CREATE INDEX IF NOT EXISTS fs_avec_records_observed ON public.fs_avec_records(unit_id,report_code,observed_at DESC);

CREATE TABLE IF NOT EXISTS public.fs_professionals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 external_id text NOT NULL,
 name text NOT NULL,
 phone text,
 enabled boolean NOT NULL DEFAULT false,
 channel_id uuid,
 template_id uuid,
 UNIQUE(unit_id,external_id),
 UNIQUE(unit_id,id),
 FOREIGN KEY(unit_id,channel_id) REFERENCES public.fs_channels(unit_id,id),
 FOREIGN KEY(unit_id,template_id) REFERENCES public.fs_templates(unit_id,id)
);

CREATE TABLE IF NOT EXISTS public.fs_alert_settings (
 unit_id uuid PRIMARY KEY REFERENCES public.fs_units ON DELETE CASCADE,
 arrival_enabled boolean NOT NULL DEFAULT false,
 stock_enabled boolean NOT NULL DEFAULT false,
 arrival_channel_id uuid,
 arrival_template_id uuid,
 stock_channel_id uuid,
 stock_template_id uuid,
 config jsonb NOT NULL DEFAULT '{}',
 FOREIGN KEY(unit_id,arrival_channel_id) REFERENCES public.fs_channels(unit_id,id),
 FOREIGN KEY(unit_id,arrival_template_id) REFERENCES public.fs_templates(unit_id,id),
 FOREIGN KEY(unit_id,stock_channel_id) REFERENCES public.fs_channels(unit_id,id),
 FOREIGN KEY(unit_id,stock_template_id) REFERENCES public.fs_templates(unit_id,id)
);

CREATE TABLE IF NOT EXISTS public.fs_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 contact_id uuid NOT NULL,
 appointment_id uuid,
 event_key text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 score smallint CHECK(score BETWEEN 1 AND 5),
 comment text CHECK(length(comment)<=1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 answered_at timestamptz,
 UNIQUE(unit_id,event_key),
 FOREIGN KEY(unit_id,contact_id) REFERENCES public.fs_contacts(unit_id,id) ON DELETE CASCADE,
 FOREIGN KEY(unit_id,appointment_id) REFERENCES public.fs_appointments(unit_id,id) ON DELETE SET NULL (appointment_id)
);
CREATE INDEX IF NOT EXISTS fs_feedback_recent ON public.fs_feedback(unit_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.fs_feedback_issue(p_unit uuid,p_contact uuid,p_appointment uuid,p_event text,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result public.fs_feedback%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.fs_units WHERE id=p_unit AND active) THEN RAISE EXCEPTION 'Unidade indisponível'; END IF;
 INSERT INTO public.fs_feedback(unit_id,contact_id,appointment_id,event_key,token_hash)
 VALUES(p_unit,p_contact,p_appointment,p_event,p_token_hash)
 ON CONFLICT(unit_id,event_key) DO NOTHING;
 SELECT * INTO result FROM public.fs_feedback WHERE unit_id=p_unit AND event_key=p_event;
 RETURN to_jsonb(result);
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_feedback_answer(p_token_hash text,p_score integer,p_comment text)
RETURNS text LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result public.fs_feedback%ROWTYPE;
BEGIN
 IF p_score IS NULL OR p_score<1 OR p_score>5 OR length(coalesce(p_comment,''))>1000 THEN RAISE EXCEPTION 'Avaliação inválida'; END IF;
 SELECT * INTO result FROM public.fs_feedback WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 IF result.expires_at<=now() THEN RETURN 'expired'; END IF;
 IF result.score IS NOT NULL THEN RETURN 'answered'; END IF;
 UPDATE public.fs_feedback SET score=p_score,comment=coalesce(p_comment,''),answered_at=now() WHERE id=result.id;
 RETURN 'saved';
END;
$$;

DO $permissions$
DECLARE item text;
BEGIN
 FOREACH item IN ARRAY ARRAY['fs_avec_records','fs_professionals','fs_alert_settings','fs_feedback'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',item);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',item);
 END LOOP;
END;
$permissions$;
REVOKE ALL ON FUNCTION public.fs_feedback_issue(uuid,uuid,uuid,text,text),public.fs_feedback_answer(text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fs_feedback_issue(uuid,uuid,uuid,text,text),public.fs_feedback_answer(text,integer,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
