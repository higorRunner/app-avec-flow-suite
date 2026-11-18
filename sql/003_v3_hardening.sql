-- FlowSuite v3 / executar DEPOIS de 001_schema.sql. Faça backup antes.
BEGIN;

-- Vinculações multi-tenant são verificadas pelo banco, não pelo frontend.
CREATE OR REPLACE FUNCTION public.fs_check_tenant_relations() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE field_name text; relation_id uuid; actual_est uuid;
BEGIN
  FOREACH field_name IN ARRAY ARRAY['customer_id','appointment_id','channel_id','template_id','automation_id'] LOOP
    relation_id := null;
    IF field_name = 'customer_id' THEN
      IF TG_TABLE_NAME <> 'message_jobs' THEN CONTINUE; END IF;
      relation_id := NEW.customer_id;
    ELSIF field_name = 'appointment_id' THEN
      IF TG_TABLE_NAME <> 'message_jobs' THEN CONTINUE; END IF;
      relation_id := NEW.appointment_id;
    ELSIF field_name = 'channel_id' THEN relation_id := NEW.channel_id;
    ELSIF field_name = 'template_id' THEN relation_id := NEW.template_id;
    ELSIF field_name = 'automation_id' THEN
      IF TG_TABLE_NAME <> 'message_jobs' THEN CONTINUE; END IF;
      relation_id := NEW.automation_id;
    END IF;
    IF relation_id IS NULL THEN CONTINUE; END IF;
    CASE field_name
      WHEN 'customer_id' THEN SELECT establishment_id INTO actual_est FROM public.customers WHERE id=relation_id;
      WHEN 'appointment_id' THEN SELECT establishment_id INTO actual_est FROM public.appointments WHERE id=relation_id;
      WHEN 'channel_id' THEN SELECT establishment_id INTO actual_est FROM public.channels WHERE id=relation_id;
      WHEN 'template_id' THEN SELECT establishment_id INTO actual_est FROM public.templates WHERE id=relation_id;
      WHEN 'automation_id' THEN SELECT establishment_id INTO actual_est FROM public.automations WHERE id=relation_id;
    END CASE;
    IF actual_est IS DISTINCT FROM NEW.establishment_id THEN
      RAISE EXCEPTION 'Vínculo inválido para o estabelecimento: %', field_name USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF TG_TABLE_NAME = 'automations' THEN
    IF TG_OP = 'INSERT' OR NEW.establishment_id IS DISTINCT FROM OLD.establishment_id
       OR NEW.rules->'service_ids' IS DISTINCT FROM OLD.rules->'service_ids'
       OR NEW.rules->'cross_sell_target_service_id' IS DISTINCT FROM OLD.rules->'cross_sell_target_service_id' THEN
      IF NEW.rules ? 'service_ids' AND jsonb_typeof(NEW.rules->'service_ids') NOT IN ('array','null') THEN
        RAISE EXCEPTION 'Seleção de serviços inválida.' USING ERRCODE='23514';
      END IF;
      IF jsonb_typeof(NEW.rules->'service_ids') = 'array' THEN
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(NEW.rules->'service_ids') AS selected(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.id=selected.id::uuid AND s.establishment_id=NEW.establishment_id)
        ) THEN
          RAISE EXCEPTION 'Há serviços indisponíveis para este estabelecimento.' USING ERRCODE='23514';
        END IF;
      END IF;
      relation_id := nullif(NEW.rules->>'cross_sell_target_service_id','')::uuid;
      IF relation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.services s WHERE s.id=relation_id AND s.establishment_id=NEW.establishment_id
      ) THEN
        RAISE EXCEPTION 'O serviço recomendado precisa pertencer ao estabelecimento.' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP='UPDATE' AND OLD.enabled AND
       ((OLD.channel_id IS NOT NULL AND NEW.channel_id IS NULL) OR
        (OLD.template_id IS NOT NULL AND NEW.template_id IS NULL)) THEN
      NEW.enabled := false;
    END IF;
    IF NEW.enabled AND (TG_OP='INSERT' OR NOT OLD.enabled OR NEW.channel_id IS DISTINCT FROM OLD.channel_id
       OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.establishment_id IS DISTINCT FROM OLD.establishment_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id=NEW.channel_id AND active AND type IN ('whatsapp','waba'))
      OR NOT EXISTS (SELECT 1 FROM public.templates WHERE id=NEW.template_id AND status='active') THEN
        RAISE EXCEPTION 'Ative a automação com um canal de WhatsApp e um modelo ativos.' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS verify_job_tenant ON public.message_jobs;
DROP TRIGGER IF EXISTS verify_automation_tenant ON public.automations;
DROP TRIGGER IF EXISTS fs_check_jobs_tenant ON public.message_jobs;
CREATE TRIGGER fs_check_jobs_tenant BEFORE INSERT OR UPDATE ON public.message_jobs
FOR EACH ROW EXECUTE FUNCTION public.fs_check_tenant_relations();
DROP TRIGGER IF EXISTS fs_check_automations_tenant ON public.automations;
CREATE TRIGGER fs_check_automations_tenant BEFORE INSERT OR UPDATE ON public.automations
FOR EACH ROW EXECUTE FUNCTION public.fs_check_tenant_relations();

CREATE OR REPLACE FUNCTION public.fs_check_manual_job() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE requested_service uuid;
BEGIN
 IF NEW.source <> 'manual' THEN RETURN NEW; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.establishments WHERE id=NEW.establishment_id AND active)
 OR NOT EXISTS (SELECT 1 FROM public.customers WHERE id=NEW.customer_id AND establishment_id=NEW.establishment_id
                AND marketing_opt_in AND opted_out_at IS NULL AND length(btrim(phone))>0)
 OR NOT EXISTS (SELECT 1 FROM public.channels WHERE id=NEW.channel_id AND establishment_id=NEW.establishment_id
                AND active AND type IN ('whatsapp','waba'))
 OR NOT EXISTS (SELECT 1 FROM public.templates WHERE id=NEW.template_id AND establishment_id=NEW.establishment_id
                AND status='active') THEN
  RAISE EXCEPTION 'Confira o estabelecimento, o canal, o modelo e a elegibilidade dos clientes.' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object'
 OR (NEW.payload ? 'variable_mapping' AND jsonb_typeof(NEW.payload->'variable_mapping') IS DISTINCT FROM 'object') THEN
  RAISE EXCEPTION 'Dados de personalização inválidos.' USING ERRCODE='23514';
 END IF;
 requested_service := nullif(NEW.payload->>'service_id','')::uuid;
 IF requested_service IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.appointments a
  JOIN public.services s ON s.id=a.service_id AND s.establishment_id=a.establishment_id
  WHERE a.establishment_id=NEW.establishment_id AND a.customer_id=NEW.customer_id
    AND s.id=requested_service AND (a.completed_at IS NOT NULL OR a.status='completed')
 ) THEN
  RAISE EXCEPTION 'Há destinatários sem atendimento concluído para o serviço escolhido.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS fs_validate_manual_job ON public.message_jobs;
CREATE TRIGGER fs_validate_manual_job BEFORE INSERT ON public.message_jobs
FOR EACH ROW EXECUTE FUNCTION public.fs_check_manual_job();

DROP POLICY IF EXISTS "jobs manual insert" ON public.message_jobs;
CREATE POLICY "jobs manual insert" ON public.message_jobs FOR INSERT TO authenticated WITH CHECK (
 public.has_tenant(establishment_id,ARRAY['owner','manager','operator'])
 AND source='manual' AND status='queued' AND automation_id IS NULL AND appointment_id IS NULL
 AND attempts=0 AND sent_at IS NULL AND external_message_id IS NULL AND error_message IS NULL
 AND (payload->>'requested_by')=(SELECT auth.uid())::text
);
CREATE INDEX IF NOT EXISTS ix_appointments_tenant_service_customer_done
 ON public.appointments(establishment_id,service_id,customer_id)
 WHERE completed_at IS NOT NULL OR status='completed';
CREATE INDEX IF NOT EXISTS ix_appointments_tenant_customer_date
 ON public.appointments(establishment_id,customer_id,scheduled_at DESC);
CREATE INDEX IF NOT EXISTS ix_jobs_tenant_customer_date
 ON public.message_jobs(establishment_id,customer_id,created_at DESC);

-- Nunca permita a navegadores ler tokens AVEC/Clickmassa.
REVOKE ALL ON public.integration_secrets FROM anon, authenticated;
-- Sem política SELECT: dados não podem ser lidos pelo papel authenticated.
-- A RPC update_integration_credentials continua gravando como definer.
REVOKE ALL ON FUNCTION public.fs_check_tenant_relations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_check_manual_job() FROM PUBLIC, anon, authenticated;
-- Matéria-prima de relatórios AVEC para inspeção sem assumir formato de resposta.
CREATE TABLE IF NOT EXISTS public.avec_report_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 establishment_id uuid NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
 report_code text NOT NULL CHECK (report_code ~ '^[0-9]{4}$'),
 page integer NOT NULL CHECK(page BETWEEN 1 AND 100000),
 payload jsonb NOT NULL,
 fetched_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(establishment_id,report_code,page)
);
CREATE INDEX IF NOT EXISTS ix_avec_snapshot_est_report ON public.avec_report_snapshots(establishment_id,report_code,fetched_at DESC);
ALTER TABLE public.avec_report_snapshots ENABLE ROW LEVEL SECURITY;
-- Sem SELECT pelo navegador: relatórios brutos podem conter dados sensíveis.
REVOKE ALL ON public.avec_report_snapshots FROM anon, authenticated;
-- Revisão adicional: bloqueia edição por membros que não sejam master.
REVOKE ALL ON FUNCTION public.create_establishment(text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_integration_credentials(uuid,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.grant_membership_by_email(uuid,text,text) FROM PUBLIC,anon;
COMMIT;
