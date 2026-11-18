BEGIN;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS clickmassa_revision uuid;
ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS clickmassa_sync_state text;
ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS clickmassa_worker_seen_at timestamptz;
ALTER TABLE public.integration_status ADD COLUMN IF NOT EXISTS clickmassa_account_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.fs_integration_settings (
 establishment_id uuid PRIMARY KEY REFERENCES public.establishments(id) ON DELETE CASCADE,
 catalog_email text,
 catalog_tenant text,
 catalog_password_id uuid,
 avec_token_id uuid
);
CREATE TABLE IF NOT EXISTS public.fs_clickmassa_senders (
 channel_id uuid PRIMARY KEY REFERENCES public.channels(id) ON DELETE CASCADE,
 secret_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT false
);

ALTER TABLE public.fs_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fs_clickmassa_senders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fs_integration_settings,public.fs_clickmassa_senders FROM PUBLIC,anon,authenticated;
REVOKE ALL ON vault.decrypted_secrets FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.fs_update_vault_secret(p_id uuid,p_value text)
RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_id IS NULL THEN RETURN vault.create_secret(p_value); END IF;
 PERFORM vault.update_secret(p_id,p_value);
 RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_request_clickmassa_sync(p_est uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_master() THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.fs_integration_settings WHERE establishment_id=p_est AND catalog_password_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Cadastre primeiro o login de catálogo.';
 END IF;
 INSERT INTO public.integration_status(establishment_id,clickmassa_revision,clickmassa_sync_state)
 VALUES(p_est,gen_random_uuid(),'pending')
 ON CONFLICT(establishment_id) DO UPDATE SET clickmassa_revision=excluded.clickmassa_revision,
  clickmassa_sync_state=excluded.clickmassa_sync_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_save_clickmassa_account(p_est uuid,p_tenant text,p_email text,p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE settings public.fs_integration_settings%ROWTYPE;
BEGIN
 IF NOT public.is_master() THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 IF p_tenant IS NULL OR p_tenant !~ '^[1-9][0-9]{0,19}$' OR p_email IS NULL OR btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN
  RAISE EXCEPTION 'Informe o identificador da empresa e o e-mail do Clickmassa.';
 END IF;
 INSERT INTO public.integration_status(establishment_id) VALUES(p_est) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.integration_status WHERE establishment_id=p_est FOR UPDATE;
 INSERT INTO public.fs_integration_settings(establishment_id) VALUES(p_est) ON CONFLICT DO NOTHING;
 SELECT * INTO settings FROM public.fs_integration_settings WHERE establishment_id=p_est FOR UPDATE;
 IF nullif(p_password,'') IS NULL THEN
  IF settings.catalog_password_id IS NULL OR settings.catalog_email IS DISTINCT FROM btrim(p_email)
     OR settings.catalog_tenant IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'Informe a senha para cadastrar ou trocar a conta.';
  END IF;
 ELSE
  settings.catalog_password_id := public.fs_update_vault_secret(settings.catalog_password_id,p_password);
 END IF;
 -- A troca de empresa invalida os vínculos locais de canais com os tokens anteriores.
 IF settings.catalog_tenant<>p_tenant AND EXISTS (
    SELECT 1 FROM public.integration_status WHERE establishment_id=p_est AND clickmassa_account_verified) THEN
  RAISE EXCEPTION 'O identificador da empresa desta unidade já foi vinculado. Use um estabelecimento separado para outra empresa.';
 END IF;
 UPDATE public.fs_integration_settings SET catalog_email=btrim(p_email),catalog_tenant=p_tenant,
  catalog_password_id=settings.catalog_password_id WHERE establishment_id=p_est;
 PERFORM public.fs_request_clickmassa_sync(p_est);
 UPDATE public.channels SET dispatch_ready=false WHERE establishment_id=p_est AND managed_by_clickmassa;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_save_clickmassa_sender(p_est uuid,p_channel uuid,p_url text,p_token text,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sender public.fs_clickmassa_senders%ROWTYPE;
BEGIN
 IF NOT public.is_master() THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id=p_channel AND establishment_id=p_est
                AND managed_by_clickmassa AND type IN ('waba','whatsapp')) THEN
  RAISE EXCEPTION 'Selecione um canal Clickmassa deste estabelecimento.';
 END IF;
 -- A revisão serializa mudanças de configuração de envio e invalida sincronizações em andamento.
 PERFORM public.fs_request_clickmassa_sync(p_est);
 SELECT * INTO sender FROM public.fs_clickmassa_senders WHERE channel_id=p_channel FOR UPDATE;
 IF nullif(btrim(p_url),'') IS NOT NULL OR nullif(btrim(p_token),'') IS NOT NULL THEN
  IF p_url IS NULL OR btrim(p_url) !~* '^https://suporteapi\.clickmassa\.com\.br/v1/api/external/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/?$'
     OR p_token IS NULL OR btrim(p_token) !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' THEN
   RAISE EXCEPTION 'Informe a URL sem parâmetros e o token de envio do canal.';
  END IF;
  sender.secret_id:=public.fs_update_vault_secret(sender.secret_id,jsonb_build_object('url',btrim(p_url),'token',btrim(p_token))::text);
 ELSIF sender.secret_id IS NULL THEN
  RAISE EXCEPTION 'Informe a URL e o token para cadastrar este canal.';
 END IF;
 INSERT INTO public.fs_clickmassa_senders(channel_id,secret_id,enabled)
 VALUES(p_channel,sender.secret_id,coalesce(p_enabled,false))
 ON CONFLICT(channel_id) DO UPDATE SET secret_id=excluded.secret_id,enabled=excluded.enabled;
 UPDATE public.channels SET dispatch_ready=false WHERE id=p_channel;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_integration_setup(p_est uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_master() THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'catalog_email',(SELECT catalog_email FROM public.fs_integration_settings WHERE establishment_id=p_est),
  'catalog_tenant',(SELECT catalog_tenant FROM public.fs_integration_settings WHERE establishment_id=p_est),
  'catalog_verified',(SELECT clickmassa_account_verified FROM public.integration_status WHERE establishment_id=p_est),
  'status',(SELECT jsonb_build_object('avec',s.avec_configured,'worker',s.clickmassa_worker_seen_at,
    'sync',s.clickmassa_sync_state,'last_sync',s.last_clickmassa_sync) FROM public.integration_status s WHERE s.establishment_id=p_est),
  'channels',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'external_id',c.external_id,'type',c.type,
    'active',c.active,'ready',c.dispatch_ready,'configured',x.secret_id IS NOT NULL,'enabled',coalesce(x.enabled,false)) ORDER BY c.name)
    FROM public.channels c LEFT JOIN public.fs_clickmassa_senders x ON x.channel_id=c.id
    WHERE c.establishment_id=p_est AND c.managed_by_clickmassa),'[]'::jsonb)
 );
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_clickmassa_worker_state(p_est uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.establishments WHERE id=p_est AND active) THEN RETURN NULL; END IF;
 INSERT INTO public.integration_status(establishment_id,clickmassa_worker_seen_at)
 VALUES(p_est,now()) ON CONFLICT(establishment_id) DO UPDATE SET clickmassa_worker_seen_at=excluded.clickmassa_worker_seen_at
 WHERE public.integration_status.clickmassa_worker_seen_at IS NULL
 OR public.integration_status.clickmassa_worker_seen_at<now()-interval '45 seconds';
 SELECT clickmassa_revision INTO revision FROM public.integration_status WHERE establishment_id=p_est;
 RETURN jsonb_build_object('revision',revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_clickmassa_worker_settings(p_est uuid,p_revision uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('email',i.catalog_email,'tenantId',i.catalog_tenant,'password',v.decrypted_secret,
  'senders',coalesce((SELECT jsonb_object_agg(c.external_id,s.decrypted_secret::jsonb) FROM public.fs_clickmassa_senders x
   JOIN public.channels c ON c.id=x.channel_id
   JOIN vault.decrypted_secrets s ON s.id=x.secret_id
   WHERE c.establishment_id=p_est AND x.enabled),'{}'::jsonb))
 FROM public.fs_integration_settings i JOIN public.establishments e ON e.id=i.establishment_id AND e.active
 JOIN public.integration_status st ON st.establishment_id=i.establishment_id AND st.clickmassa_revision=p_revision
 JOIN vault.decrypted_secrets v ON v.id=i.catalog_password_id
 WHERE i.establishment_id=p_est
$$;

CREATE OR REPLACE FUNCTION public.fs_commit_clickmassa_sync(p_est uuid,p_revision uuid,p_channels jsonb,p_templates jsonb,p_state text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_revision uuid;
BEGIN
 SELECT clickmassa_revision INTO current_revision FROM public.integration_status WHERE establishment_id=p_est FOR UPDATE;
 IF NOT FOUND OR current_revision IS DISTINCT FROM p_revision THEN RETURN false; END IF;
 IF p_state IN ('ready','sender_error') THEN
  PERFORM public.fs_sync_clickmassa_catalog(p_est,p_channels,p_templates);
 ELSIF p_state IN ('auth_error','sync_error') THEN
  UPDATE public.channels SET dispatch_ready=false WHERE establishment_id=p_est AND managed_by_clickmassa;
 ELSE
  RAISE EXCEPTION 'Estado de sincronização inválido.';
 END IF;
 UPDATE public.integration_status SET clickmassa_sync_state=p_state,
  clickmassa_account_verified=clickmassa_account_verified OR (p_revision IS NOT NULL AND p_state IN ('ready','sender_error'))
 WHERE establishment_id=p_est;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_set_avec_token(p_est uuid,p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token_id uuid;
BEGIN
 IF NOT public.is_master() THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_token),'') IS NULL THEN RAISE EXCEPTION 'Informe o token AVEC.'; END IF;
 INSERT INTO public.integration_status(establishment_id) VALUES(p_est) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.integration_status WHERE establishment_id=p_est FOR UPDATE;
 INSERT INTO public.fs_integration_settings(establishment_id) VALUES(p_est) ON CONFLICT DO NOTHING;
 SELECT avec_token_id INTO token_id FROM public.fs_integration_settings WHERE establishment_id=p_est FOR UPDATE;
 UPDATE public.fs_integration_settings SET avec_token_id=public.fs_update_vault_secret(token_id,btrim(p_token))
 WHERE establishment_id=p_est;
 UPDATE public.integration_secrets SET avec_token=NULL,updated_at=now()
 WHERE establishment_id=p_est AND avec_token IS NOT NULL;
 INSERT INTO public.integration_status(establishment_id,avec_configured) VALUES(p_est,true)
 ON CONFLICT(establishment_id) DO UPDATE SET avec_configured=true,updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_worker_avec_token(p_est uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(v.decrypted_secret,s.avec_token)
 FROM public.establishments e LEFT JOIN public.fs_integration_settings i ON e.id=i.establishment_id
 LEFT JOIN vault.decrypted_secrets v ON v.id=i.avec_token_id
 LEFT JOIN public.integration_secrets s ON s.establishment_id=e.id
 WHERE e.id=p_est AND e.active
$$;

REVOKE ALL ON FUNCTION public.fs_update_vault_secret(uuid,text),
 public.fs_clickmassa_worker_state(uuid),public.fs_clickmassa_worker_settings(uuid,uuid),
 public.fs_commit_clickmassa_sync(uuid,uuid,jsonb,jsonb,text),public.fs_worker_avec_token(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fs_clickmassa_worker_state(uuid),public.fs_clickmassa_worker_settings(uuid,uuid),
 public.fs_commit_clickmassa_sync(uuid,uuid,jsonb,jsonb,text),public.fs_worker_avec_token(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fs_request_clickmassa_sync(uuid),public.fs_save_clickmassa_account(uuid,text,text,text),
 public.fs_save_clickmassa_sender(uuid,uuid,text,text,boolean),public.fs_integration_setup(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fs_request_clickmassa_sync(uuid),public.fs_save_clickmassa_account(uuid,text,text,text),
 public.fs_save_clickmassa_sender(uuid,uuid,text,text,boolean),public.fs_integration_setup(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
