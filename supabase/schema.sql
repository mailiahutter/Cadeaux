-- =====================================================================
--  Wishlist familiale — schéma de base de données (Supabase / PostgreSQL)
--
--  À copier-coller UNE FOIS dans Supabase > SQL Editor > New query > Run.
--  Le script est ré-exécutable sans risque (il ne supprime aucune donnée).
--
--  Confidentialité : toutes les colonnes "enc" contiennent des données
--  chiffrées côté téléphone (AES-256-GCM). La clé n'est jamais envoyée
--  ici : elle ne circule que dans le lien d'invitation. L'hébergeur ne
--  voit que des identifiants aléatoires et du texte illisible.
-- =====================================================================

create table if not exists groups (
  id          uuid primary key,
  enc         text not null,                      -- nom du groupe (chiffré)
  created_at  timestamptz not null default now()
);

create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  enc         text not null,                      -- prénom, code, anniversaire (chiffré)
  version     int  not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists members_group_idx on members(group_id);

-- Une édition par année : 2026, 2027, ...
create table if not exists editions (
  group_id    uuid not null references groups(id) on delete cascade,
  year        int  not null,
  created_at  timestamptz not null default now(),
  primary key (group_id, year)
);

create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups(id) on delete cascade,
  year        int  not null,
  owner_id    uuid not null references members(id) on delete cascade,  -- à qui est destiné le cadeau
  created_by  uuid not null references members(id) on delete cascade,  -- qui l'a ajouté
  hidden      boolean not null default false,     -- true = cadeau "hors liste", invisible pour owner
  enc         text not null,                      -- titre, lien, prix, note, priorité (chiffré)
  received    boolean not null default false,     -- le destinataire indique l'avoir reçu
  deleted     boolean not null default false,     -- retiré de la liste (conservé si déjà réservé)
  from_item   uuid,                               -- reporté depuis l'édition précédente
  version     int  not null default 1,            -- contrôle des modifications simultanées
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists items_group_idx on items(group_id, year);

-- Réservations : "solo" (je le prends seul), "lead" (cadeau commun, initiateur),
-- "join" (je participe au cadeau commun)
create table if not exists reservations (
  item_id     uuid not null references items(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  group_id    uuid not null references groups(id) on delete cascade,
  kind        text not null check (kind in ('solo', 'lead', 'join')),
  given       boolean not null default false,     -- le cadeau a été offert
  created_at  timestamptz not null default now(),
  primary key (item_id, member_id)
);
create index if not exists reservations_group_idx on reservations(group_id);

-- Qui a déjà fait son report de liste pour une année donnée
create table if not exists transfers (
  group_id    uuid not null references groups(id) on delete cascade,
  year        int  not null,
  member_id   uuid not null references members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (group_id, year, member_id)
);

-- Horodatage automatique des modifications
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists items_touch on items;
create trigger items_touch before update on items
  for each row execute function touch_updated_at();
drop trigger if exists members_touch on members;
create trigger members_touch before update on members
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
--  Réserver un cadeau — opération atomique (gestion des conflits).
--  Si deux personnes cliquent en même temps, la ligne du cadeau est
--  verrouillée : la première réussit, la seconde reçoit 'taken'.
--  p_mode : 'solo' | 'shared' (lancer un cadeau commun) | 'join'
--  Retour : ok | taken | shared | changed | already | own | missing
-- ---------------------------------------------------------------------
create or replace function reserve_item(p_item uuid, p_member uuid, p_mode text)
returns text language plpgsql as $$
declare
  it        items%rowtype;
  has_solo  boolean;
  has_lead  boolean;
begin
  select * into it from items where id = p_item for update;
  if not found or it.deleted then
    return 'missing';
  end if;
  if not exists (select 1 from members where id = p_member and group_id = it.group_id) then
    return 'missing';
  end if;
  if it.owner_id = p_member then
    return 'own';
  end if;
  if exists (select 1 from reservations where item_id = p_item and member_id = p_member) then
    return 'already';
  end if;

  select coalesce(bool_or(kind = 'solo'), false), coalesce(bool_or(kind = 'lead'), false)
    into has_solo, has_lead
    from reservations where item_id = p_item;

  if has_solo then
    return 'taken';
  end if;
  if has_lead then
    if p_mode = 'join' then
      insert into reservations(item_id, member_id, group_id, kind) values (p_item, p_member, it.group_id, 'join');
      return 'ok';
    end if;
    return 'shared';
  end if;
  if p_mode = 'join' then
    return 'changed';   -- le cadeau commun a été annulé entre-temps
  end if;

  insert into reservations(item_id, member_id, group_id, kind)
    values (p_item, p_member, it.group_id, case when p_mode = 'shared' then 'lead' else 'solo' end);
  return 'ok';
end $$;

-- Annuler sa réservation. Si l'initiateur d'un cadeau commun se retire,
-- le plus ancien participant devient initiateur.
create or replace function cancel_reservation(p_item uuid, p_member uuid)
returns text language plpgsql as $$
declare
  old_kind text;
  next_member uuid;
begin
  perform 1 from items where id = p_item for update;
  delete from reservations where item_id = p_item and member_id = p_member
    returning kind into old_kind;
  if old_kind is null then
    return 'missing';
  end if;
  if old_kind = 'lead' then
    select member_id into next_member from reservations
      where item_id = p_item and kind = 'join'
      order by created_at, member_id limit 1;
    if next_member is not null then
      update reservations set kind = 'lead' where item_id = p_item and member_id = next_member;
    end if;
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------
--  Accès : l'application n'utilise pas de comptes Supabase. La
--  confidentialité repose sur le chiffrement (clé dans le lien) et sur
--  des identifiants de groupe aléatoires impossibles à deviner.
-- ---------------------------------------------------------------------
alter table groups       enable row level security;
alter table members      enable row level security;
alter table editions     enable row level security;
alter table items        enable row level security;
alter table reservations enable row level security;
alter table transfers    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['groups','members','editions','items','reservations','transfers'] loop
    execute format('drop policy if exists app_access on %I', t);
    execute format('create policy app_access on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Pas de suppression de groupe ni de liste depuis l'application
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon, authenticated;
    grant select, insert, update on groups, members, editions, items, transfers to anon, authenticated;
    grant select, insert, update, delete on reservations to anon, authenticated;
    grant delete on members to anon, authenticated;
    grant execute on function reserve_item(uuid, uuid, text), cancel_reservation(uuid, uuid) to anon, authenticated;
  end if;
end $$;

-- Temps réel : diffuser les changements aux téléphones connectés
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups','members','editions','items','reservations','transfers'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table %I', t);
      end if;
    end loop;
  end if;
end $$;
