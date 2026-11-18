-- APÓS o primeiro usuário se cadastrar e confirmar o e-mail, substitua o endereço abaixo.
-- Execute no SQL Editor (role postgres), nunca no navegador.
update public.profiles p set master_admin = true
from auth.users u
where p.id = u.id and lower(u.email) = lower('SEU_EMAIL_ADMIN@DOMINIO.COM')
  and u.email_confirmed_at is not null;
-- Confirme resultado:
select u.email,p.master_admin from public.profiles p join auth.users u on u.id=p.id where p.master_admin=true;
