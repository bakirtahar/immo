-- =============================================================================
-- immo – CTB – Cabinet Tahar Bakir
-- Schéma Supabase : données, règles d'accès (RLS), journaux.
-- À exécuter UNE FOIS dans « SQL Editor » du projet Supabase (Run).
-- Le script peut être relancé sans perte de données (idempotent).
--
-- Principes :
--   * aucun accès sans connexion (rôle anon : aucune donnée) ;
--   * aucun accès tant que l'adresse e-mail n'est pas validée ;
--   * chaque connexion exige DEUX étapes, vérifiées par la base elle-même :
--     le mot de passe, PUIS un code à 6 chiffres reçu par e-mail ;
--   * l'administrateur (e-mail ci-dessous) voit tout ; il peut en plus être
--     obligé d'utiliser une application d'authentification (réglage ci-dessous) ;
--   * un client ne voit que sa société, et seulement si son accès est actif ;
--   * un client qui a activé la double authentification doit l'utiliser ;
--   * toute modification est journalisée.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Adresse de l'administrateur  (à modifier ici si besoin, puis relancer)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;

create table if not exists private.settings (
  id boolean primary key default true check (id),
  admin_email text not null
);
alter table private.settings add column if not exists admin_totp_required boolean not null default false;
alter table private.settings add column if not exists email_code_window interval not null default interval '10 minutes';
-- admin_totp_required : true = l'administrateur doit AUSSI saisir le code de
-- son application d'authentification (Google/Microsoft Authenticator).
insert into private.settings (id, admin_email, admin_totp_required) values (true, 't.bakir@tb.tn', false)
  on conflict (id) do update set admin_email = excluded.admin_email,
                                 admin_totp_required = excluded.admin_totp_required;
revoke all on private.settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
-- Profils : qui est administrateur, quel client appartient à quelle société.
-- Lecture seule pour les utilisateurs ; écrit uniquement par la fonction
-- « invite-client » (clé de service) et par le déclencheur ci-dessous.
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('admin', 'client')),
  tenant_id  text check (tenant_id is null or tenant_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  created_at timestamptz not null default now(),
  constraint profiles_client_tenant check (role = 'admin' or tenant_id is not null)
);
create unique index if not exists profiles_email_uk on public.profiles (lower(email));
create index if not exists profiles_tenant_ix on public.profiles (tenant_id);

-- Documents de l'application (paramétrage, registre des clients,
-- environnements, immobilisations, inventaires).
create table if not exists public.docs (
  path       text primary key,
  parent     text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
  tenant_id  text generated always as (
               case when path ~ '^(tenants|clients)/' then split_part(path, '/', 2) end) stored,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint docs_path_ok check (path ~ '^(app/config|clients/[A-Za-z0-9_-]{1,40}|tenants/[A-Za-z0-9_-]{1,40}(/(assets|inventories)/[A-Za-z0-9_-]{1,40})?)$'),
  constraint docs_size_ok check (octet_length(data::text) < 8000000),
  constraint docs_object check (jsonb_typeof(data) = 'object')
);
create index if not exists docs_parent_ix on public.docs (parent);
create index if not exists docs_tenant_ix on public.docs (tenant_id);

-- Journal des modifications (alimenté automatiquement, lecture administrateur).
create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  user_id  uuid,
  email    text,
  action   text not null,
  path     text,
  detail   text
);
create index if not exists audit_log_at_ix on public.audit_log (at desc);

-- Journal des connexions (lecture administrateur).
create table if not exists public.auth_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  email      text,
  event      text not null,
  detail     text,
  user_agent text
);
create index if not exists auth_log_at_ix on public.auth_log (at desc);

-- Étapes de connexion : heure de chaque mot de passe validé (privé).
create table if not exists private.login_steps (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  pwd_at  timestamptz not null,
  created timestamptz not null default now()
);
create index if not exists login_steps_user_ix on private.login_steps (user_id, pwd_at desc);
revoke all on private.login_steps from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fonctions de contrôle (schéma privé, non exposé par l'API)
-- ---------------------------------------------------------------------------
-- Adresse validée, compte non banni, non supprimé.
create or replace function private.email_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until < now()));
$$;

-- Niveau de connexion : si l'utilisateur a activé la double authentification,
-- la session doit être de niveau aal2.
create or replace function private.aal_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f
                     where f.user_id = auth.uid() and f.status = 'verified');
$$;

-- Connexion en deux étapes : la session doit avoir été ouverte par le code
-- reçu par e-mail (méthode « otp » du jeton), et le mot de passe du même
-- utilisateur doit avoir été validé dans les 10 minutes qui précèdent.
-- Un mot de passe seul, ou un code e-mail seul, ne donne accès à rien.
create or replace function private.login_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    join private.login_steps st on st.user_id = auth.uid()
    where a ->> 'method' = 'otp'
      and st.pwd_at <= to_timestamp((a ->> 'timestamp')::double precision)
      and st.pwd_at >= to_timestamp((a ->> 'timestamp')::double precision)
                       - (select s.email_code_window from private.settings s));
$$;

-- Administrateur : profil admin + e-mail validé + connexion en deux étapes
-- (+ application d'authentification si admin_totp_required ou si activée).
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.email_ok() and private.login_ok() and private.aal_ok()
     and (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
          or not (select s.admin_totp_required from private.settings s))
     and exists (select 1 from public.profiles p
                 where p.user_id = auth.uid() and p.role = 'admin');
$$;

-- Société du client connecté (null si pas client, adresse non validée,
-- second facteur manquant ou accès désactivé par le cabinet).
create or replace function private.my_tenant() returns text
language sql stable security definer set search_path = '' as $$
  select p.tenant_id from public.profiles p
  where p.user_id = auth.uid() and p.role = 'client'
    and private.email_ok() and private.login_ok() and private.aal_ok()
    and exists (select 1 from public.docs d
                where d.path = 'clients/' || p.tenant_id
                  and coalesce(d.data ->> 'actif', 'true') <> 'false');
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.email_ok(), private.aal_ok(), private.login_ok(), private.is_admin(), private.my_tenant()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Règles d'accès (Row Level Security)
-- ---------------------------------------------------------------------------
alter table public.profiles  enable row level security;
alter table public.docs      enable row level security;
alter table public.audit_log enable row level security;
alter table public.auth_log  enable row level security;
alter table public.profiles  force row level security;
alter table public.docs      force row level security;
alter table public.audit_log force row level security;
alter table public.auth_log  force row level security;

revoke all on public.profiles, public.docs, public.audit_log, public.auth_log from anon, authenticated, public;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select on public.audit_log, public.auth_log to authenticated;
grant all on public.profiles, public.docs, public.audit_log, public.auth_log to service_role;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated
  using ((select private.is_admin())
         or (tenant_id is not null and tenant_id = (select private.my_tenant()))
         or (path = 'app/config' and (select private.my_tenant()) is not null));

drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated
  with check ((select private.is_admin())
              or (path like 'tenants/%' and tenant_id = (select private.my_tenant())));

drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using ((select private.is_admin())
         or (path like 'tenants/%' and tenant_id = (select private.my_tenant())))
  with check ((select private.is_admin())
              or (path like 'tenants/%' and tenant_id = (select private.my_tenant())));

drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated
  using ((select private.is_admin())
         or (path ~ '^tenants/[^/]+/(assets|inventories)/' and tenant_id = (select private.my_tenant())));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using ((select private.is_admin()));
drop policy if exists authlog_read on public.auth_log;
create policy authlog_read on public.auth_log for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Déclencheurs
-- ---------------------------------------------------------------------------
-- Un client ne peut pas changer le code société de son environnement
-- (il fonde la codification) ; les empreintes de mots de passe héritées de
-- la version de démonstration ne sont jamais conservées.
create or replace function private.docs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.path ~ '^tenants/[^/]+$' then
    new.data := new.data - 'auth';
    if tg_op = 'UPDATE' and not private.is_admin()
       and (new.data ->> 'codeSociete') is distinct from (old.data ->> 'codeSociete') then
      raise exception 'Le code société ne peut être modifié que par le cabinet.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before insert or update on public.docs
  for each row execute function private.docs_guard();

create or replace function private.docs_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := case when tg_op = 'DELETE' then old.data else new.data end;
begin
  insert into public.audit_log (user_id, email, action, path, detail)
  values (auth.uid(),
          (select u.email from auth.users u where u.id = auth.uid()),
          case tg_op when 'INSERT' then 'création' when 'UPDATE' then 'modification' else 'suppression' end,
          coalesce(new.path, old.path),
          left(coalesce(d ->> 'code', '') || ' ' || coalesce(d ->> 'designation', d ->> 'raison', d ->> 'libelle', ''), 200));
  return null;
end $$;
drop trigger if exists docs_audit on public.docs;
create trigger docs_audit after insert or update or delete on public.docs
  for each row execute function private.docs_audit();

-- Création automatique du profil administrateur lorsque l'adresse de
-- private.settings est invitée ; synchronisation des changements d'adresse.
create or replace function private.on_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if lower(new.email) = (select lower(s.admin_email) from private.settings s) then
      insert into public.profiles (user_id, email, role) values (new.id, lower(new.email), 'admin')
      on conflict (user_id) do nothing;
    end if;
  elsif new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = lower(new.email) where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists immo_on_auth_user on auth.users;
create trigger immo_on_auth_user after insert or update of email on auth.users
  for each row execute function private.on_auth_user();

-- Si l'administrateur existe déjà dans Authentication > Users, créer son profil.
insert into public.profiles (user_id, email, role)
select u.id, lower(u.email), 'admin' from auth.users u
where lower(u.email) = (select lower(admin_email) from private.settings)
on conflict (user_id) do update set role = 'admin';

-- ---------------------------------------------------------------------------
-- 5. Fonctions appelées par l'application (API)
-- ---------------------------------------------------------------------------
-- Habillage de l'écran de connexion (nom, couleurs, logo) : seules données
-- lisibles sans connexion. Aucune donnée client.
create or replace function public.public_branding() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
      'appName', d.data -> 'appName', 'tagline', d.data -> 'tagline',
      'colors', d.data -> 'colors', 'logo', d.data -> 'logo',
      'loginMessage', d.data -> 'loginMessage')
    from public.docs d where d.path = 'app/config'), '{}'::jsonb);
$$;

-- Qui suis-je ? (rôle, société, état de la validation et du second facteur)
create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = auth.uid()),
    'role', p.role,
    'tenant_id', p.tenant_id,
    'email_ok', private.email_ok(),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'admin_ok', private.is_admin(),
    'login_ok', private.login_ok(),
    'totp_required', p.role = 'admin' and (select s.admin_totp_required from private.settings s),
    'tenant_ok', private.my_tenant() is not null,
    'active', case when p.role = 'client' then exists (
                select 1 from public.docs d where d.path = 'clients/' || p.tenant_id
                  and coalesce(d.data ->> 'actif', 'true') <> 'false') else true end)
  from (select 1) x left join public.profiles p on p.user_id = auth.uid();
$$;

-- État des accès clients (administrateur uniquement).
create or replace function public.admin_access_list() returns table (
  tenant_id text, email text, invited_at timestamptz, confirmed_at timestamptz,
  last_sign_in_at timestamptz, mfa boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Accès réservé à l''administrateur.' using errcode = '42501';
  end if;
  return query
    select p.tenant_id, p.email, u.invited_at, u.email_confirmed_at, u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified')
    from public.profiles p join auth.users u on u.id = p.user_id
    where p.role = 'client';
end $$;

-- Journal des connexions. Sans session, seul un échec de connexion peut être
-- noté, avec une limite anti-abus.
create or replace function public.log_auth_event(p_event text, p_email text default null, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_ua text := left(coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', ''), 300);
begin
  if p_event is null or p_event !~ '^[a-z_]{3,40}$' then return; end if;
  if v_uid is null then
    if p_event not in ('echec_connexion', 'echec_code_email') then return; end if;
    if (select count(*) from public.auth_log where at > now() - interval '1 minute' and user_id is null) > 60 then return; end if;
    v_email := left(lower(coalesce(p_email, '')), 120);
  else
    v_email := (select u.email from auth.users u where u.id = v_uid);
  end if;
  insert into public.auth_log (user_id, email, event, detail, user_agent)
  values (v_uid, v_email, p_event, left(p_detail, 300), v_ua);
end $$;

-- Supabase accorde par défaut l'exécution à anon et authenticated : on repart de zéro.
-- Étape 1 de la connexion : le mot de passe vient d'être validé par Supabase
-- Auth (méthode « password » du jeton, il y a moins de 2 minutes).
create or replace function public.mark_password_step() returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ts double precision;
begin
  select max((a ->> 'timestamp')::double precision) into v_ts
  from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
  where a ->> 'method' = 'password';
  if auth.uid() is null or v_ts is null or to_timestamp(v_ts) < now() - interval '2 minutes' then
    return false;
  end if;
  delete from private.login_steps where user_id = auth.uid() and pwd_at < now() - interval '30 days';
  insert into private.login_steps (user_id, pwd_at) values (auth.uid(), to_timestamp(v_ts));
  return true;
end $$;

revoke all on function public.mark_password_step() from public, anon, authenticated;
grant execute on function public.mark_password_step() to authenticated;

revoke all on function public.public_branding(), public.whoami(), public.admin_access_list(),
  public.log_auth_event(text, text, text) from public, anon, authenticated;
grant execute on function public.public_branding() to anon, authenticated;
grant execute on function public.log_auth_event(text, text, text) to anon, authenticated;
grant execute on function public.whoami(), public.admin_access_list() to authenticated;

-- Fin du schéma.
