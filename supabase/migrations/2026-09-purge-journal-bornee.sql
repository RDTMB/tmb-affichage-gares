-- =============================================================================
-- Purge du journal d'exploitation : PARAMÈTRE BORNÉ (constat F-01)
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase.
-- Rejouable. Déjà recopié dans supabase/schema.sql pour les nouvelles
-- installations ; src/data/purge-journal.test.ts compare les deux copies.
--
-- CE QUE CE SCRIPT CORRIGE, ET CE QU'IL NE CORRIGE PAS.
--
-- Le constat F-01 annonçait deux choses. La première — « n'importe quel compte
-- connecté peut effacer le journal » — n'est plus vraie : le contrôle de rôle
-- existe dans le corps de la fonction depuis le commit 034b798 (rôles
-- multiples, 05/09/2026), et le schéma `private` n'est de toute façon PAS
-- exposé par PostgREST, donc la fonction n'est appelable ni par la caisse ni
-- par personne depuis le front. Rien n'est donc ajouté de ce côté : un second
-- contrôle de rôle ferait doublon avec le premier.
--
-- La seconde moitié, elle, était bien ouverte : le paramètre n'était borné
-- NULLE PART. `make_interval(months => 0)` donne un intervalle nul, donc
-- `quand < now()` efface le journal ENTIER — la trace de toutes les écritures
-- depuis l'installation, sans retour possible. Une valeur négative emporte en
-- plus les lignes postdatées. Un zéro se tape d'un doigt qui glisse, et `-12`
-- au lieu de `12` est l'erreur de frappe la plus banale du monde.
--
-- La fonction refuse désormais tout nombre de mois nul, négatif ou `null`.
-- Elle ne l'interprète pas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONTRÔLE PRÉALABLE — LECTURE SEULE. Ce que la purge protège, en chiffres :
--    l'étendue du journal et ce qu'un appel à 12 mois retirerait réellement.
--    À relire après l'étape 2 : les nombres doivent être identiques, ce script
--    ne supprime rien.
-- -----------------------------------------------------------------------------
select
  count(*) as lignes_au_total,
  min(quand)::date as plus_ancienne,
  max(quand)::date as plus_recente,
  count(*) filter (where quand < now() - make_interval(months => 12)) as retirees_a_12_mois
from journal_exploitation;

-- -----------------------------------------------------------------------------
-- 2. LA FONCTION, avec sa borne. Rejouable (create or replace).
-- -----------------------------------------------------------------------------
create or replace function private.purge_journal_exploitation(mois int default 12)
returns bigint language plpgsql security definer set search_path = '' as $fn$
declare
  supprimees bigint;
begin
  if auth.uid() is not null and not private.a_le_role('technique') then
    raise exception 'La purge du journal est réservée au rôle technique.'
      using errcode = 'insufficient_privilege';
  end if;
  -- PARAMÈTRE BORNÉ (F-01, seconde moitié). `make_interval(months => 0)` donne
  -- un intervalle NUL : `quand < now()` efface alors le journal ENTIER, c'est-
  -- à-dire la trace de toutes les écritures depuis l'installation, sans retour
  -- possible. Une valeur négative fait pire, elle emporte aussi les lignes
  -- postdatées. Un zéro se tape d'un doigt qui glisse, et `-12` au lieu de
  -- `12` est l'erreur de frappe la plus banale du monde : on refuse, on
  -- n'interprète pas. `null` est refusé aussi — il ne supprimait rien, mais en
  -- silence, et un appel qui ne fait rien sans le dire se rejoue.
  if mois is null or mois < 1 then
    raise exception 'Purge refusée : le nombre de mois doit valoir au moins 1 (reçu : %).', mois
      using errcode = 'invalid_parameter_value',
            hint = 'Rétention normale : select private.purge_journal_exploitation(12);';
  end if;
  delete from public.journal_exploitation
    where quand < now() - make_interval(months => mois);
  get diagnostics supprimees = row_count;
  return supprimees;
end $fn$;

revoke all on function private.purge_journal_exploitation(int) from public;
grant execute on function private.purge_journal_exploitation(int) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. VÉRIFICATION APRÈS — les trois refus, en lecture seule.
--
--    Les trois lignes doivent LEVER une erreur « Purge refusée ». Lancez-les
--    UNE PAR UNE : l'éditeur s'arrête à la première erreur, c'est le
--    comportement attendu et non un problème.
-- -----------------------------------------------------------------------------
-- select private.purge_journal_exploitation(0);      -- doit être REFUSÉ
-- select private.purge_journal_exploitation(-12);    -- doit être REFUSÉ
-- select private.purge_journal_exploitation(null);   -- doit être REFUSÉ

-- -----------------------------------------------------------------------------
-- 4. LA PURGE ELLE-MÊME — à ne lancer que délibérément, une fois par an.
--    Elle retourne le nombre de lignes supprimées, celui que l'étape 1
--    annonçait dans `retirees_a_12_mois`.
-- -----------------------------------------------------------------------------
-- select private.purge_journal_exploitation(12);
