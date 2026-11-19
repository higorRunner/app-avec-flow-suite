-- Atualização aditiva: permite escolher os estados AVEC aceitos por cada automação.
-- Preserva regras, filas e históricos existentes.
BEGIN;

ALTER TABLE public.fs_rules
  ADD COLUMN IF NOT EXISTS appointment_statuses jsonb NOT NULL
  DEFAULT '["finalized","paid"]'::jsonb;

ALTER TABLE public.fs_rules
  DROP CONSTRAINT IF EXISTS fs_rules_appointment_statuses_check;
ALTER TABLE public.fs_rules
  ADD CONSTRAINT fs_rules_appointment_statuses_check
  CHECK (
    jsonb_typeof(appointment_statuses)='array'
    AND appointment_statuses <@ '["scheduled","confirmed","waiting","in_progress","finalized","paid","canceled","missed"]'::jsonb
  );

-- O estado técnico antigo representava uma conclusão confirmada pelo relatório 0186.
UPDATE public.fs_appointments SET status='finalized' WHERE status='completed';

NOTIFY pgrst, 'reload schema';
COMMIT;
