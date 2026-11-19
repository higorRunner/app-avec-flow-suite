-- Atualização aditiva para seleção e revisão de destinatários dos relatórios.
BEGIN;
ALTER TABLE public.fs_contacts ADD COLUMN IF NOT EXISTS avec_global_id text;
CREATE INDEX IF NOT EXISTS fs_contacts_global_lookup ON public.fs_contacts(unit_id,avec_global_id);
CREATE TABLE IF NOT EXISTS public.fs_report_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_id uuid NOT NULL REFERENCES public.fs_units ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.fs_users ON DELETE CASCADE,
 report_code text NOT NULL,
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fs_report_previews_expiry ON public.fs_report_previews(expires_at);
ALTER TABLE public.fs_report_previews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fs_report_previews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.fs_report_previews TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
