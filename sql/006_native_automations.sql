BEGIN;

ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS native_armed_at timestamptz;
ALTER TABLE public.message_jobs ADD COLUMN IF NOT EXISTS test_run boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_appointments_tenant_customer_completed
 ON public.appointments(establishment_id,customer_id,completed_at DESC) WHERE completed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fs_native_rule_state() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT NEW.enabled THEN
  NEW.native_armed_at:=NULL;
  RETURN NEW;
 END IF;
 IF NEW.channel_id IS NULL OR NEW.template_id IS NULL THEN
  IF TG_OP='UPDATE' AND OLD.enabled AND (NEW.channel_id IS DISTINCT FROM OLD.channel_id OR NEW.template_id IS DISTINCT FROM OLD.template_id) THEN
   NEW.enabled:=false;
   NEW.native_armed_at:=NULL;
   RETURN NEW;
  END IF;
 END IF;
 -- Preserve old enabled rules until an explicit activation or edit in the new panel.
 IF TG_OP='UPDATE' AND OLD.enabled AND OLD.native_armed_at IS NULL AND NEW.native_armed_at IS NULL THEN RETURN NEW; END IF;
 IF NEW.type NOT IN ('csat','post_service','return','cross_sell','birthday','inactive')
    OR (NEW.type IN ('inactive','return') AND NEW.rules->>'date_basis'='next_appointment') THEN
  RAISE EXCEPTION 'Este gatilho ainda aguarda uma fonte de eventos validada.' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.channels c JOIN public.templates t ON t.clickmassa_channel_id=c.id
      WHERE c.id=NEW.channel_id AND c.establishment_id=NEW.establishment_id AND c.type='waba'
       AND t.id=NEW.template_id AND t.establishment_id=NEW.establishment_id AND t.status='active') THEN
  RAISE EXCEPTION 'Selecione um modelo aprovado do canal Oficial.' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' OR NOT OLD.enabled OR OLD.native_armed_at IS NULL
    OR (NEW.type,NEW.rules,NEW.variable_mapping,NEW.channel_id,NEW.template_id,NEW.send_time,NEW.delay_days)
    IS DISTINCT FROM (OLD.type,OLD.rules,OLD.variable_mapping,OLD.channel_id,OLD.template_id,OLD.send_time,OLD.delay_days) THEN
  NEW.native_armed_at:=statement_timestamp();
 ELSE
  NEW.native_armed_at:=OLD.native_armed_at;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS fs_arm_automation ON public.automations;
CREATE TRIGGER fs_arm_automation BEFORE INSERT OR UPDATE ON public.automations
FOR EACH ROW EXECUTE FUNCTION public.fs_native_rule_state();

CREATE OR REPLACE FUNCTION public.fs_automation_candidates(p_est uuid,p_rule uuid,p_now timestamptz,p_preview boolean)
RETURNS TABLE(rule_id uuid,recipient_id uuid,appointment_id uuid,channel_id uuid,template_id uuid,
 scheduled_for timestamptz,event_key text,variable_mapping jsonb)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH rules AS (
  SELECT a.*,coalesce(z.name,'UTC') AS tz,(p_now AT TIME ZONE coalesce(z.name,'UTC'))::date AS local_day
  FROM public.automations a
  JOIN public.establishments e ON e.id=a.establishment_id AND e.active
  LEFT JOIN pg_timezone_names z ON z.name=e.timezone
  JOIN public.channels c ON c.id=a.channel_id AND c.establishment_id=p_est AND c.type='waba' AND c.active AND c.dispatch_ready
  JOIN public.templates t ON t.id=a.template_id AND t.establishment_id=p_est AND t.status='active' AND t.clickmassa_channel_id=c.id
  WHERE a.establishment_id=p_est AND (p_rule IS NULL OR a.id=p_rule)
   AND (p_preview OR (a.enabled AND a.native_armed_at IS NOT NULL))
 ), events AS (
  SELECT r.id AS rule_id,a.customer_id AS recipient_id,a.id AS appointment_id,
   (CASE WHEN r.type='return' AND r.rules->>'date_basis'='last_appointment'
     THEN a.scheduled_at ELSE a.completed_at END AT TIME ZONE r.tz)::date
      + CASE WHEN r.type='return' THEN coalesce(s.default_return_days,r.delay_days) ELSE r.delay_days END AS due_day,
   coalesce(a.completed_at,a.scheduled_at) AS occurred_at,'appointment:'||a.id::text AS key
  FROM rules r JOIN public.appointments a ON a.establishment_id=p_est AND a.completed_at IS NOT NULL AND a.completed_at<=p_now
  LEFT JOIN public.services s ON s.id=a.service_id AND s.establishment_id=p_est
  WHERE r.type IN ('csat','post_service','return','cross_sell')
   AND (coalesce(r.rules->'service_ids','[]'::jsonb)='[]'::jsonb OR (r.rules->'service_ids') ? a.service_id::text)
   AND (r.type<>'return' OR NOT EXISTS (
    SELECT 1 FROM public.appointments later WHERE later.establishment_id=p_est AND later.customer_id=a.customer_id
     AND later.service_id=a.service_id AND (later.completed_at>a.completed_at OR
      (later.scheduled_at>p_now AND later.completed_at IS NULL AND later.status NOT IN ('canceled','cancelled','no_show')))
   ))
   AND (r.type<>'cross_sell' OR EXISTS (SELECT 1 FROM public.services target WHERE target.establishment_id=p_est
    AND target.id::text=r.rules->>'cross_sell_target_service_id' AND target.active
    AND target.id IS DISTINCT FROM a.service_id))
  UNION ALL
  SELECT r.id,c.id,NULL::uuid,r.local_day - d.n,NULL::timestamptz,'birthday:'||(r.local_day-d.n-r.delay_days)::text
  FROM rules r JOIN public.customers c ON c.establishment_id=p_est AND c.birthday IS NOT NULL
  CROSS JOIN (VALUES (0),(1)) AS d(n)
  WHERE r.type='birthday'
   AND to_char(c.birthday,'MM-DD')=to_char(r.local_day-d.n-r.delay_days,'MM-DD')
  UNION ALL
  SELECT r.id,last_event.customer_id,last_event.id,
   (last_event.event_time AT TIME ZONE r.tz)::date+r.delay_days,last_event.event_time,'inactive:'||last_event.id::text
  FROM rules r CROSS JOIN LATERAL (
   SELECT DISTINCT ON (a.customer_id) a.id,a.customer_id,a.service_id,
    CASE WHEN r.rules->>'date_basis'='last_appointment' THEN a.scheduled_at ELSE a.completed_at END AS event_time
   FROM public.appointments a
   WHERE a.establishment_id=p_est AND a.customer_id IS NOT NULL
    AND a.status NOT IN ('canceled','cancelled','no_show')
    AND (CASE WHEN r.rules->>'date_basis'='last_appointment' THEN a.scheduled_at ELSE a.completed_at END)<=p_now
   ORDER BY a.customer_id,event_time DESC,a.id DESC
  ) last_event
  WHERE r.type='inactive'
   AND (coalesce(r.rules->'service_ids','[]'::jsonb)='[]'::jsonb OR (r.rules->'service_ids') ? last_event.service_id::text)
   AND NOT EXISTS (
   SELECT 1 FROM public.appointments future WHERE future.establishment_id=p_est AND future.customer_id=last_event.customer_id
    AND future.scheduled_at>p_now AND future.completed_at IS NULL AND future.status NOT IN ('canceled','cancelled','no_show')
  )
 ), due AS (
  SELECT r.id AS rule_id,c.id AS recipient_id,e.appointment_id,r.channel_id,r.template_id,
   greatest((e.due_day+r.send_time) AT TIME ZONE r.tz,e.occurred_at) AS due_at,
   'auto:'||r.id::text||':'||c.id::text||':'||e.key AS event_key,r.variable_mapping,
   r.native_armed_at,
   CASE WHEN r.rules->>'cooldown_days' ~ '^[0-9]{1,4}$' THEN (r.rules->>'cooldown_days')::int ELSE 7 END AS cooldown
  FROM events e JOIN rules r ON r.id=e.rule_id
  JOIN public.customers c ON c.id=e.recipient_id AND c.establishment_id=p_est
   AND c.marketing_opt_in AND c.opted_out_at IS NULL AND nullif(btrim(c.phone),'') IS NOT NULL
  WHERE e.due_day >= r.local_day-1
 ), eligible AS (
  SELECT d.*,
   row_number() OVER(PARTITION BY d.rule_id,d.recipient_id ORDER BY d.due_at DESC,d.event_key) AS event_order
  FROM due d WHERE d.due_at>p_now-interval '24 hours' AND d.due_at<=p_now AND (p_preview OR d.due_at>=d.native_armed_at)
   AND NOT EXISTS (SELECT 1 FROM public.message_jobs j WHERE j.establishment_id=p_est AND j.idempotency_key=d.event_key)
   AND (d.cooldown=0 OR NOT EXISTS (SELECT 1 FROM public.message_jobs j WHERE j.establishment_id=p_est
    AND j.automation_id=d.rule_id AND j.customer_id=d.recipient_id AND j.created_at>p_now-make_interval(days=>d.cooldown)
    AND j.status IN ('queued','processing','sent','delivered','read')))
 )
 SELECT x.rule_id,x.recipient_id,x.appointment_id,x.channel_id,x.template_id,x.due_at,x.event_key,x.variable_mapping
 FROM eligible x WHERE x.cooldown=0 OR x.event_order=1 ORDER BY x.due_at,x.event_key LIMIT 100
$$;

CREATE OR REPLACE FUNCTION public.fs_schedule_automations(p_est uuid) RETURNS integer
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE total integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_est::text,106)) THEN RETURN 0; END IF;
 INSERT INTO public.message_jobs(establishment_id,automation_id,customer_id,appointment_id,channel_id,template_id,source,
  scheduled_for,idempotency_key,payload)
 SELECT p_est,c.rule_id,c.recipient_id,c.appointment_id,c.channel_id,c.template_id,'automatic',
  c.scheduled_for,c.event_key,jsonb_build_object('transport','clickmassa','variable_mapping',c.variable_mapping)
 FROM public.fs_automation_candidates(p_est,NULL,statement_timestamp(),false) c
 ON CONFLICT(establishment_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
 GET DIAGNOSTICS total=ROW_COUNT;
 RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_preview_automation(p_est uuid,p_rule uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE eligible integer;
BEGIN
 IF NOT public.can_manage(p_est) THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO eligible FROM public.fs_automation_candidates(p_est,p_rule,statement_timestamp(),true);
 RETURN eligible;
END;
$$;

REVOKE ALL ON FUNCTION public.fs_native_rule_state(),public.fs_automation_candidates(uuid,uuid,timestamptz,boolean),
 public.fs_schedule_automations(uuid),public.fs_preview_automation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fs_preview_automation(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fs_schedule_automations(uuid),public.fs_automation_candidates(uuid,uuid,timestamptz,boolean)
 TO service_role;
GRANT SELECT ON public.automations TO service_role;
GRANT INSERT ON public.message_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.fs_check_manual_job() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE requested_service uuid; route public.channels%ROWTYPE;
BEGIN
 IF NEW.source <> 'manual' THEN RETURN NEW; END IF;
 SELECT * INTO route FROM public.channels WHERE id=NEW.channel_id AND establishment_id=NEW.establishment_id AND active;
 IF NOT FOUND OR route.type NOT IN ('waba','whatsapp')
 OR NOT EXISTS (SELECT 1 FROM public.establishments WHERE id=NEW.establishment_id AND active)
 OR (NOT NEW.test_run AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id=NEW.customer_id AND establishment_id=NEW.establishment_id
                AND marketing_opt_in AND opted_out_at IS NULL AND length(btrim(phone))>0)) THEN
  RAISE EXCEPTION 'Confira o canal e a elegibilidade dos destinatários.' USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object'
 OR (NEW.payload ? 'variable_mapping' AND jsonb_typeof(NEW.payload->'variable_mapping') IS DISTINCT FROM 'object') THEN
  RAISE EXCEPTION 'Dados de personalização inválidos.' USING ERRCODE='23514';
 END IF;

 IF NEW.test_run AND (NEW.customer_id IS NOT NULL OR NEW.payload->>'test_phone' IS NULL
   OR NEW.payload->>'test_phone' !~ '^\+[1-9][0-9]{10,14}$'
   OR NEW.payload->'test_consent' IS DISTINCT FROM 'true'::jsonb) THEN
  RAISE EXCEPTION 'Confirme um número de teste autorizado com DDI.' USING ERRCODE='23514';
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

 IF NEW.test_run AND route.type='waba' THEN
  IF jsonb_typeof(NEW.payload->'test_params') IS DISTINCT FROM 'array' OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(NEW.payload->'test_params') AS arg(value)
      WHERE jsonb_typeof(arg.value)<>'string' OR length(btrim(arg.value#>>'{}')) NOT BETWEEN 1 AND 1024
  ) OR jsonb_array_length(NEW.payload->'test_params') IS DISTINCT FROM (
    SELECT jsonb_array_length(t.variables) FROM public.templates t WHERE t.id=NEW.template_id
  ) THEN RAISE EXCEPTION 'Preencha todos os campos de teste do modelo.' USING ERRCODE='23514'; END IF;
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

DROP POLICY IF EXISTS "jobs manual insert" ON public.message_jobs;
CREATE POLICY "jobs manual insert" ON public.message_jobs FOR INSERT TO authenticated WITH CHECK (
 public.has_tenant(establishment_id,ARRAY['owner','manager','operator'])
 AND source='manual' AND status='queued' AND automation_id IS NULL AND appointment_id IS NULL
 AND attempts=0 AND sent_at IS NULL AND external_message_id IS NULL AND error_message IS NULL
 AND NOT test_run AND (payload->>'requested_by')=(SELECT auth.uid())::text
);

CREATE OR REPLACE FUNCTION public.fs_queue_clickmassa_test(
 p_est uuid,p_channel uuid,p_template uuid,p_phone text,p_confirm boolean,p_content jsonb,p_request uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job_id uuid; request_key text;
BEGIN
 IF NOT public.has_tenant(p_est,ARRAY['owner','manager','operator']) OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501';
 END IF;
 IF p_confirm IS DISTINCT FROM true OR p_request IS NULL THEN
  RAISE EXCEPTION 'Confirme a autorização do contato de teste.';
 END IF;
 request_key:='test:'||auth.uid()::text||':'||p_request::text;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_est::text||request_key,107));
 SELECT id INTO job_id FROM public.message_jobs WHERE establishment_id=p_est AND idempotency_key=request_key;
 IF FOUND THEN RETURN job_id; END IF;
 INSERT INTO public.message_jobs(establishment_id,channel_id,template_id,source,test_run,idempotency_key,payload)
 VALUES(p_est,p_channel,p_template,'manual',true,request_key,jsonb_build_object(
  'transport','clickmassa','requested_by',auth.uid(),'test_phone',p_phone,'test_consent',true
 )||jsonb_strip_nulls(jsonb_build_object('test_params',p_content->'params','body',p_content->'body','note',p_content->'note')))
 RETURNING id INTO job_id;
 RETURN job_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fs_queue_clickmassa_test(uuid,uuid,uuid,text,boolean,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fs_queue_clickmassa_test(uuid,uuid,uuid,text,boolean,jsonb,uuid) TO authenticated;

ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS avec_test_id uuid;
ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS avec_test_state text;
ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS avec_test_records integer;

CREATE OR REPLACE FUNCTION public.fs_request_avec_test(p_est uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_master() THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 UPDATE public.integration_status SET avec_test_id=gen_random_uuid(),avec_test_state='pending',avec_test_records=NULL
 WHERE establishment_id=p_est AND avec_configured
  AND EXISTS (SELECT 1 FROM public.establishments WHERE id=p_est AND active);
 IF NOT FOUND THEN RAISE EXCEPTION 'Ative a unidade e confira se o token AVEC está cadastrado.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_pending_avec_test(p_est uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT avec_test_id FROM public.integration_status s
 JOIN public.establishments e ON e.id=s.establishment_id AND e.active
 WHERE s.establishment_id=p_est AND s.avec_test_state='pending'
$$;

CREATE OR REPLACE FUNCTION public.fs_complete_avec_test(p_est uuid,p_request uuid,p_records integer,p_payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 UPDATE public.integration_status
 SET avec_test_state=CASE WHEN p_records IS NULL THEN 'error' ELSE 'ready' END,avec_test_records=p_records
 WHERE establishment_id=p_est AND avec_test_id=p_request AND avec_test_state='pending';
 IF FOUND AND p_records IS NOT NULL THEN
  PERFORM public.fs_save_avec_sample(p_est,'0004',p_payload);
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fs_request_avec_test(uuid),public.fs_pending_avec_test(uuid),
 public.fs_complete_avec_test(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fs_request_avec_test(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fs_pending_avec_test(uuid),public.fs_complete_avec_test(uuid,uuid,integer,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fs_claim_clickmassa_job(p_est uuid, p_channel_ids text[])
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE job public.message_jobs%ROWTYPE; route public.channels%ROWTYPE;
 customer public.customers%ROWTYPE; model public.templates%ROWTYPE;
 business_name text; business_tz text; service_name text; destination_phone text;
 rule public.automations%ROWTYPE; appointment public.appointments%ROWTYPE;
BEGIN
 SELECT j.* INTO job FROM public.message_jobs j
 JOIN public.channels c ON c.id=j.channel_id AND c.establishment_id=j.establishment_id
 WHERE j.establishment_id=p_est AND j.status='queued'
  AND j.payload->>'transport'='clickmassa' AND j.scheduled_for<=now()
  AND c.external_id=ANY(p_channel_ids) AND c.active AND c.dispatch_ready
 ORDER BY j.scheduled_for,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;

 SELECT * INTO route FROM public.channels WHERE id=job.channel_id AND establishment_id=p_est;
 SELECT * INTO customer FROM public.customers WHERE id=job.customer_id AND establishment_id=p_est;
 SELECT name,timezone INTO business_name,business_tz FROM public.establishments WHERE id=p_est AND active;
 IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=business_tz) THEN business_tz:='UTC'; END IF;
 SELECT * INTO model FROM public.templates WHERE id=job.template_id AND establishment_id=p_est AND clickmassa_channel_id=route.id
  AND status='active' AND provider_template_id IS NOT NULL;
 IF job.source='automatic' THEN
  SELECT * INTO rule FROM public.automations WHERE id=job.automation_id AND establishment_id=p_est;
  SELECT * INTO appointment FROM public.appointments WHERE id=job.appointment_id AND establishment_id=p_est;
  SELECT name INTO service_name FROM public.services s WHERE s.establishment_id=p_est AND
   s.id::text=CASE WHEN rule.type='cross_sell' THEN rule.rules->>'cross_sell_target_service_id' ELSE appointment.service_id::text END;
 ELSE
  SELECT name INTO service_name FROM public.services s WHERE s.establishment_id=p_est AND s.id::text=job.payload->>'service_id'
   AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.establishment_id=p_est AND a.customer_id=job.customer_id
               AND a.service_id=s.id AND (a.completed_at IS NOT NULL OR a.status='completed'));
 END IF;
 destination_phone:=CASE WHEN job.test_run THEN job.payload->>'test_phone' ELSE customer.phone END;
 IF business_name IS NULL OR (NOT job.test_run AND (NOT coalesce(customer.marketing_opt_in,false) OR customer.opted_out_at IS NOT NULL))
    OR nullif(btrim(destination_phone),'') IS NULL OR NOT route.active OR NOT route.dispatch_ready
    OR route.type NOT IN ('waba','whatsapp') OR (route.type='waba' AND model.id IS NULL)
    OR (job.payload->>'service_id' IS NOT NULL AND service_name IS NULL)
    OR (job.source='automatic' AND (rule.id IS NULL OR NOT rule.enabled OR rule.native_armed_at IS NULL
     OR rule.native_armed_at>job.scheduled_for OR rule.channel_id IS DISTINCT FROM job.channel_id
     OR rule.template_id IS DISTINCT FROM job.template_id OR route.type<>'waba'
     OR (rule.type<>'birthday' AND (appointment.id IS NULL OR appointment.status IN ('canceled','cancelled','no_show')))
     OR (rule.type='cross_sell' AND service_name IS NULL))) THEN
  UPDATE public.message_jobs SET status='skipped',error_message='O destinatário ou o canal deixou de atender aos requisitos.'
  WHERE id=job.id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 UPDATE public.message_jobs SET status='processing',attempts=attempts+1,
  error_message='Envio reservado. Se o resultado não chegar, confira a mensagem no Clickmassa antes de reenviar.'
 WHERE id=job.id;
 RETURN jsonb_build_object(
  'id',job.id,'phone',destination_phone,'test_run',job.test_run,'channel_external_id',route.external_id,'channel_type',route.type,
  'provider_template_id',model.provider_template_id,'variable_keys',model.variables,'payload',job.payload,
  'fields',jsonb_build_object('customer.name',customer.name,'customer.phone',customer.phone,
    'customer.email',customer.email,'customer.birthday',to_char(customer.birthday,'DD/MM'),
    'establishment.name',business_name,'service.name',service_name,
    'appointment.scheduled_at',to_char(appointment.scheduled_at AT TIME ZONE business_tz,'DD/MM/YYYY HH24:MI'),
    'appointment.completed_at',to_char(appointment.completed_at AT TIME ZONE business_tz,'DD/MM/YYYY HH24:MI'))
 );
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
