-- =============================================================================
-- TMB — Horodatage du signal de vie côté SERVEUR
-- À exécuter dans l'éditeur SQL. Rejouable. Intégré à supabase/schema.sql
-- pour les nouvelles installations.
--
-- POURQUOI. Le signal de vie reste anonyme (voir la policy « signal de vie »
-- dans schema.sql) : sa portée est bornée par des GRANT de colonnes et
-- l'INSERT est interdit, mais la fraîcheur d'un écran ne doit pas dépendre de
-- l'horloge d'un Raspberry — ni d'un tiers muni de la clé publique.
--
-- LIMITE CONNUE : derniere_vue ne peut plus être remise à NULL par un UPDATE
-- (elle serait horodatée à now()). Un poste repart de NULL à sa déclaration
-- (INSERT, non concerné par le déclencheur) ; aucun usage d'exploitation n'a
-- besoin de cette remise à zéro.
-- =============================================================================

-- Le serveur horodate le signal de vie : ni l'horloge d'un Raspberry, ni un
-- tiers muni de la clé publique ne décident plus de la fraîcheur d'un écran.
create or replace function private.horodate_signal_de_vie()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  -- Ne s'applique QU'aux écritures qui touchent ces colonnes : une action de
  -- supervision (veille, ordre de rechargement) ne fausse pas la dernière vue.
  if new.derniere_vue is distinct from old.derniere_vue then
    new.derniere_vue := now();
  end if;
  -- La dernière synchro réussie peut être ANTÉRIEURE (réseau coupé) mais
  -- jamais postérieure à maintenant.
  if new.donnees_maj is distinct from old.donnees_maj and new.donnees_maj is not null then
    new.donnees_maj := least(new.donnees_maj, now());
  end if;
  return new;
end;
$fn$;

revoke all on function private.horodate_signal_de_vie() from public;

drop trigger if exists trg_signal_de_vie on public.ecrans;
create trigger trg_signal_de_vie
  before update on public.ecrans
  for each row execute function private.horodate_signal_de_vie();

-- =============================================================================
-- VÉRIFICATION — à exécuter APRÈS le script.
-- =============================================================================
--
-- (a) Une date lointaine envoyée par un client est remplacée par now() :
--     update ecrans set derniere_vue = '2099-01-01' where id = 'le-fayet-ecran-1';
--     select derniere_vue from ecrans where id = 'le-fayet-ecran-1';  -- ≈ now()
--
-- (b) Une action de supervision ne touche PAS la dernière vue :
--     select derniere_vue as avant from ecrans where id = 'le-fayet-ecran-1';
--     update ecrans set veille_debut = '19:00' where id = 'le-fayet-ecran-1';
--     select derniere_vue as apres from ecrans where id = 'le-fayet-ecran-1';
--     -> identique : un écran MORT ne doit pas passer pour vivant.
--
-- (c) donnees_maj est BORNÉE, pas forcée : une valeur passée est conservée,
--     une valeur future est ramenée à maintenant.
--     update ecrans set donnees_maj = now() - interval '10 min'
--       where id = 'le-fayet-ecran-1';                       -- conservée
--     update ecrans set donnees_maj = now() + interval '1 day'
--       where id = 'le-fayet-ecran-1';                       -- ramenée à now()
