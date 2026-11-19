-- Clientes com telefone normalizado válido ficam disponíveis por padrão.
-- Os registros antigos não distinguiam pendência de bloqueio manual.
-- Esta atualização libera a base válida e preserva os bloqueios explícitos
-- registrados no novo campo send_blocked. Pode ser executada novamente.
BEGIN;
ALTER TABLE public.fs_contacts ADD COLUMN IF NOT EXISTS send_blocked boolean NOT NULL DEFAULT false;
UPDATE public.fs_contacts SET consent=(NOT send_blocked AND coalesce(phone ~ '^\+[1-9][0-9]{10,14}$',false));
NOTIFY pgrst,'reload schema';
COMMIT;
