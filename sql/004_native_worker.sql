BEGIN;

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS managed_by_clickmassa boolean NOT NULL DEFAULT false;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS dispatch_ready boolean NOT NULL DEFAULT false;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS clickmassa_channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL;
ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS provider_template_id text;
ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS last_avec_snapshot timestamptz;

CREATE OR REPLACE FUNCTION public.fs_sync_clickmassa_catalog(p_est uuid, p_channels jsonb, p_templates jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_synced_at timestamptz := statement_timestamp();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_est::text, 104));
 IF NOT EXISTS (SELECT 1 FROM public.establishments WHERE id=p_est AND active) THEN
  RAISE EXCEPTION 'Estabelecimento indisponível.';
 END IF;

 INSERT INTO public.channels(establishment_id,external_id,name,type,active,managed_by_clickmassa,dispatch_ready,synced_at)
 SELECT p_est,c.external_id,c.name,c.type,c.active,true,c.dispatch_ready,v_synced_at
 FROM jsonb_to_recordset(p_channels) AS c(external_id text,name text,type text,active boolean,dispatch_ready boolean)
 ON CONFLICT(establishment_id,external_id) DO UPDATE SET name=excluded.name,type=excluded.type,
  active=excluded.active,managed_by_clickmassa=true,dispatch_ready=excluded.dispatch_ready,synced_at=excluded.synced_at;
 UPDATE public.channels c SET active=false,dispatch_ready=false
 WHERE c.establishment_id=p_est AND c.managed_by_clickmassa AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_channels) x WHERE x->>'external_id'=c.external_id
 );

 INSERT INTO public.templates(establishment_id,external_id,name,body,variables,status,clickmassa_channel_id,provider_template_id,synced_at)
 SELECT p_est,t.external_id,t.name,t.body,t.variables,t.status,c.id,t.provider_template_id,v_synced_at
 FROM jsonb_to_recordset(p_templates) AS t(channel_external_id text,external_id text,name text,body text,variables jsonb,status text,provider_template_id text)
 JOIN public.channels c ON c.establishment_id=p_est AND c.external_id=t.channel_external_id AND c.managed_by_clickmassa AND c.type='waba'
 ON CONFLICT(establishment_id,external_id) DO UPDATE SET name=excluded.name,body=excluded.body,variables=excluded.variables,
  status=excluded.status,clickmassa_channel_id=excluded.clickmassa_channel_id,provider_template_id=excluded.provider_template_id,synced_at=excluded.synced_at;
 UPDATE public.templates t SET status='inactive'
 WHERE t.establishment_id=p_est AND t.clickmassa_channel_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(p_templates) x WHERE x->>'external_id'=t.external_id
 );
 INSERT INTO public.integration_status(establishment_id,clickmassa_configured,last_clickmassa_sync)
 VALUES (p_est,true,v_synced_at)
 ON CONFLICT(establishment_id) DO UPDATE SET clickmassa_configured=true,last_clickmassa_sync=excluded.last_clickmassa_sync;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_check_manual_job() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE requested_service uuid; route public.channels%ROWTYPE;
BEGIN
 IF NEW.source <> 'manual' THEN RETURN NEW; END IF;
 SELECT * INTO route FROM public.channels WHERE id=NEW.channel_id AND establishment_id=NEW.establishment_id AND active;
 IF NOT FOUND OR route.type NOT IN ('waba','whatsapp')
 OR NOT EXISTS (SELECT 1 FROM public.establishments WHERE id=NEW.establishment_id AND active)
 OR NOT EXISTS (SELECT 1 FROM public.customers WHERE id=NEW.customer_id AND establishment_id=NEW.establishment_id
                AND marketing_opt_in AND opted_out_at IS NULL AND length(btrim(phone))>0) THEN
  RAISE EXCEPTION 'Confira o canal e a elegibilidade dos destinatários.' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object'
 OR (NEW.payload ? 'variable_mapping' AND jsonb_typeof(NEW.payload->'variable_mapping') IS DISTINCT FROM 'object') THEN
  RAISE EXCEPTION 'Dados de personalização inválidos.' USING ERRCODE='23514';
 END IF;

 IF NEW.payload->>'transport'='clickmassa' THEN
  IF NOT route.dispatch_ready THEN RAISE EXCEPTION 'O envio deste canal está desativado.' USING ERRCODE='23514'; END IF;
  IF route.type='whatsapp' THEN
   IF NEW.template_id IS NOT NULL OR jsonb_typeof(NEW.payload->'body') IS DISTINCT FROM 'string'
      OR length(btrim(NEW.payload->>'body')) NOT BETWEEN 1 AND 4096
      OR (NEW.payload ? 'note' AND (jsonb_typeof(NEW.payload->'note') IS DISTINCT FROM 'string' OR length(NEW.payload->>'note')>1000)) THEN
    RAISE EXCEPTION 'Confira o texto e a nota interna do envio.' USING ERRCODE='23514';
   END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.templates WHERE id=NEW.template_id AND establishment_id=NEW.establishment_id
                    AND status='active' AND clickmassa_channel_id=route.id AND provider_template_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Escolha um modelo aprovado deste canal.' USING ERRCODE='23514';
  END IF;
 ELSIF NOT EXISTS (SELECT 1 FROM public.templates WHERE id=NEW.template_id AND establishment_id=NEW.establishment_id AND status='active') THEN
  RAISE EXCEPTION 'Confira o modelo de mensagem.' USING ERRCODE='23514';
 END IF;

 requested_service := nullif(NEW.payload->>'service_id','')::uuid;
 IF requested_service IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.appointments a JOIN public.services s ON s.id=a.service_id AND s.establishment_id=a.establishment_id
  WHERE a.establishment_id=NEW.establishment_id AND a.customer_id=NEW.customer_id
    AND s.id=requested_service AND (a.completed_at IS NOT NULL OR a.status='completed')
 ) THEN
  RAISE EXCEPTION 'Há destinatários sem atendimento concluído para o serviço escolhido.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_claim_clickmassa_job(p_est uuid, p_channel_ids text[])
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE job public.message_jobs%ROWTYPE; route public.channels%ROWTYPE;
 customer public.customers%ROWTYPE; model public.templates%ROWTYPE;
 business_name text; service_name text;
BEGIN
 SELECT j.* INTO job FROM public.message_jobs j
 JOIN public.channels c ON c.id=j.channel_id AND c.establishment_id=j.establishment_id
 WHERE j.establishment_id=p_est AND j.status='queued' AND j.source='manual'
  AND j.payload->>'transport'='clickmassa' AND j.scheduled_for<=now()
  AND c.external_id=ANY(p_channel_ids) AND c.active AND c.dispatch_ready
 ORDER BY j.scheduled_for,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;

 SELECT * INTO route FROM public.channels WHERE id=job.channel_id AND establishment_id=p_est;
 SELECT * INTO customer FROM public.customers WHERE id=job.customer_id AND establishment_id=p_est;
 SELECT name INTO business_name FROM public.establishments WHERE id=p_est AND active;
 SELECT * INTO model FROM public.templates WHERE id=job.template_id AND establishment_id=p_est AND clickmassa_channel_id=route.id
  AND status='active' AND provider_template_id IS NOT NULL;
 SELECT name INTO service_name FROM public.services s WHERE s.establishment_id=p_est AND s.id::text=job.payload->>'service_id'
  AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.establishment_id=p_est AND a.customer_id=job.customer_id
              AND a.service_id=s.id AND (a.completed_at IS NOT NULL OR a.status='completed'));
 IF business_name IS NULL OR NOT coalesce(customer.marketing_opt_in,false) OR customer.opted_out_at IS NOT NULL
    OR nullif(btrim(customer.phone),'') IS NULL OR NOT route.active OR NOT route.dispatch_ready
    OR route.type NOT IN ('waba','whatsapp') OR (route.type='waba' AND model.id IS NULL)
    OR (job.payload->>'service_id' IS NOT NULL AND service_name IS NULL) THEN
  UPDATE public.message_jobs SET status='skipped',error_message='O destinatário ou o canal deixou de atender aos requisitos.'
  WHERE id=job.id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 UPDATE public.message_jobs SET status='processing',attempts=attempts+1,
  error_message='Envio reservado. Se o resultado não chegar, confira a mensagem no Clickmassa antes de reenviar.'
 WHERE id=job.id;
 RETURN jsonb_build_object(
  'id',job.id,'phone',customer.phone,'channel_external_id',route.external_id,'channel_type',route.type,
  'provider_template_id',model.provider_template_id,'variable_keys',model.variables,'payload',job.payload,
  'fields',jsonb_build_object('customer.name',customer.name,'customer.phone',customer.phone,
    'customer.email',customer.email,'customer.birthday',to_char(customer.birthday,'DD/MM'),
    'establishment.name',business_name,'service.name',service_name)
 );
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_finish_clickmassa_job(p_est uuid,p_job uuid,p_status text,p_external_id text,p_error text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF p_status NOT IN ('processing','sent','delivered','read','failed')
    OR (p_status IN ('sent','delivered','read') AND nullif(p_external_id,'') IS NULL) THEN
  RAISE EXCEPTION 'Resultado de envio inválido.';
 END IF;
 UPDATE public.message_jobs SET status=p_status,external_message_id=p_external_id,error_message=p_error,
  sent_at=CASE WHEN p_status IN ('sent','delivered','read') THEN now() ELSE NULL END
 WHERE id=p_job AND establishment_id=p_est AND status='processing' AND attempts=1
   AND payload->>'transport'='clickmassa' AND external_message_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_worker_avec_token(p_est uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT s.avec_token FROM public.integration_secrets s JOIN public.establishments e ON e.id=s.establishment_id
 WHERE e.id=p_est AND e.active
$$;

CREATE OR REPLACE FUNCTION public.fs_set_avec_token(p_est uuid,p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_master() THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_token),'') IS NULL THEN RAISE EXCEPTION 'Informe o token AVEC.'; END IF;
 INSERT INTO public.integration_secrets(establishment_id,avec_token) VALUES(p_est,btrim(p_token))
 ON CONFLICT(establishment_id) DO UPDATE SET avec_token=excluded.avec_token,updated_at=now();
 INSERT INTO public.integration_status(establishment_id,avec_configured) VALUES(p_est,true)
 ON CONFLICT(establishment_id) DO UPDATE SET avec_configured=true,updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_save_avec_sample(p_est uuid,p_code text,p_payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.establishments WHERE id=p_est AND active) THEN
  RAISE EXCEPTION 'Estabelecimento indisponível.';
 END IF;
 INSERT INTO public.avec_report_snapshots(establishment_id,report_code,page,payload)
 VALUES(p_est,p_code,1,p_payload)
 ON CONFLICT(establishment_id,report_code,page) DO UPDATE SET payload=excluded.payload,fetched_at=now();
 INSERT INTO public.integration_status(establishment_id,last_avec_snapshot) VALUES(p_est,now())
 ON CONFLICT(establishment_id) DO UPDATE SET last_avec_snapshot=excluded.last_avec_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.fs_sync_clickmassa_catalog(uuid,jsonb,jsonb),public.fs_claim_clickmassa_job(uuid,text[]),
 public.fs_finish_clickmassa_job(uuid,uuid,text,text,text),public.fs_worker_avec_token(uuid),
 public.fs_save_avec_sample(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fs_sync_clickmassa_catalog(uuid,jsonb,jsonb),public.fs_claim_clickmassa_job(uuid,text[]),
 public.fs_finish_clickmassa_job(uuid,uuid,text,text,text),public.fs_worker_avec_token(uuid),
 public.fs_save_avec_sample(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fs_set_avec_token(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fs_set_avec_token(uuid,text) TO authenticated;
GRANT SELECT ON public.establishments,public.customers,public.services,public.appointments,public.integration_secrets TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.channels,public.templates,public.integration_status,public.avec_report_snapshots TO service_role;
GRANT SELECT,UPDATE ON public.message_jobs TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
