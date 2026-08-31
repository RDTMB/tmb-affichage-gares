-- =============================================================================
-- Contrainte de FORME sur la table `params` (correctif C-01)
--
-- À EXÉCUTER À LA MAIN par l'exploitant, dans l'éditeur SQL Supabase.
-- Rejouable. À recopier dans supabase/schema.sql pour les nouvelles
-- installations une fois validée.
--
-- POURQUOI. `params.valeur` est du jsonb : la base n'impose aucune forme. Le
-- rôle `caisse` — le moins privilégié — peut écrire les clés `meteo_sommet`
-- et `vitesse_ticker_px_s` via l'API REST (politique « affichage tous roles »,
-- schema.sql). Une chaîne contenant du HTML placée dans `meteo_sommet.t` était
-- interpolée telle quelle dans les écrans de gare.
--
-- CETTE CONTRAINTE EST UNE SECONDE BARRIÈRE. Le front ne s'y fie jamais : il
-- valide déjà tout ce qu'il lit (src/core/params.ts, `paramsValides`). Elle
-- empêche la valeur aberrante d'ENTRER, ce que le front ne peut pas faire.
--
-- PÉRIMÈTRE. Seules les 7 clés de `params` sont du jsonb. L'interface `Params`
-- du front compte dix champs : les trois autres — `machines`, `motifs`,
-- `ciels` — viennent de TABLES à colonnes typées et ne sont pas concernées.
--
-- ⚠ RECETTE DEVENUE CADUQUE. Le bloc VÉRIFICATION de
-- supabase/ajout-journal-exploitation.sql propose
--     update params set valeur = '{"t": 12}'::jsonb where cle = 'meteo_sommet';
-- qui écrase la météo SANS ciel : cette contrainte le refuse désormais. Le
-- remplacer par un objet complet :
--     update params set valeur =
--       '{"t":12,"ciel_fr":"Dégagé","ciel_en":"Clear"}'::jsonb
--       where cle = 'meteo_sommet';
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. VÉRIFICATION PRÉALABLE — à lancer AVANT l'étape 2.
--    0 ligne attendue. Toute ligne renvoyée doit être corrigée d'abord, sinon
--    l'ajout de la contrainte échouera sur les données existantes.
--
--    Le `case when` n'est pas une coquetterie : c'est le seul construit dont
--    PostgreSQL garantisse l'ordre d'évaluation. Un cast écrit en clair
--    (`(valeur ->> 't')::numeric`) peut être évalué AVANT le test de type et
--    faire échouer la requête de diagnostic elle-même.
-- -----------------------------------------------------------------------------
select cle, jsonb_typeof(valeur) as type_json, valeur
  from params
 where cle = 'meteo_sommet'
   and not (
     jsonb_typeof(valeur) = 'object'
     and (valeur ? 't') and jsonb_typeof(valeur -> 't') = 'number'
     and (case when jsonb_typeof(valeur -> 't') = 'number'
               then (valeur ->> 't')::numeric end) between -50 and 50
     and (valeur ? 'ciel_fr') and jsonb_typeof(valeur -> 'ciel_fr') = 'string'
     and (valeur ? 'ciel_en') and jsonb_typeof(valeur -> 'ciel_en') = 'string'
     and (not (valeur ? 'heure_releve')
          or (jsonb_typeof(valeur -> 'heure_releve') = 'string'
              and (valeur ->> 'heure_releve') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
   );

-- -----------------------------------------------------------------------------
-- 2. LA CONTRAINTE (obligatoire) — forme de `meteo_sommet`.
--
--    La contrainte porte sur TOUTES les lignes de la table, or chaque ligne
--    est une clé différente : d'où la forme « cle <> 'meteo_sommet' or (…) »,
--    qui laisse passer les six autres clés sans les contraindre.
--
--    L'opérateur `?` teste la PRÉSENCE d'une clé. Sans lui, une clé absente
--    donnerait `jsonb_typeof(NULL)` = NULL, donc un CHECK ni vrai ni faux —
--    et PostgreSQL ACCEPTE une contrainte qui vaut NULL. Un objet vide `{}`
--    passerait. ⚠ Certains clients SQL interprètent `?` comme un paramètre ;
--    dans l'éditeur Supabase il passe tel quel.
-- -----------------------------------------------------------------------------
begin;

alter table params drop constraint if exists params_meteo_sommet_forme;
alter table params add constraint params_meteo_sommet_forme check (
  cle <> 'meteo_sommet' or (
    jsonb_typeof(valeur) = 'object'
    -- température : présente, numérique, et plausible au sommet.
    -- Négative acceptée : il gèle au Nid d'Aigle.
    and (valeur ? 't') and jsonb_typeof(valeur -> 't') = 'number'
    and (case when jsonb_typeof(valeur -> 't') = 'number'
              then (valeur ->> 't')::numeric end) between -50 and 50
    -- état du ciel : les deux langues, en texte
    and (valeur ? 'ciel_fr') and jsonb_typeof(valeur -> 'ciel_fr') = 'string'
    and (valeur ? 'ciel_en') and jsonb_typeof(valeur -> 'ciel_en') = 'string'
    -- heure du relevé : facultative, mais « HH:MM » si présente
    and (not (valeur ? 'heure_releve')
         or (jsonb_typeof(valeur -> 'heure_releve') = 'string'
             and (valeur ->> 'heure_releve') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
  )
);

commit;

-- -----------------------------------------------------------------------------
-- 3. CONTRAINTES FACULTATIVES — les autres clés jsonb.
--    À n'appliquer qu'après avoir passé la vérification 3.0 ci-dessous.
--
--    Bornes retenues, alignées sur src/core/params.ts :
--      veille_nuit          deux heures « HH:MM » ; AUCUN ordre imposé entre
--                           debut et fin (la veille franchit minuit).
--      mode_medias          'alterne' | 'serie'
--      duree_cache_min      3..60   (défaut 15) — gouverne l'écran neutre.
--                           0 est EXCLU : il rendrait tout écran définitivement
--                           neutre. Pour tester l'écran neutre en gare, le
--                           paramètre d'URL `?cache=` est prévu pour cela.
--      a_quai_origine_s     0..1800 (défaut 300)
--      vitesse_ticker_px_s  20..400 (défaut 90)
--
--    `duree_horaires_s` est VOLONTAIREMENT absente : la supervision l'écrit
--    aujourd'hui sans bornage, et une contrainte ici ferait remonter à l'agent
--    une erreur PostgreSQL brute au lieu d'un message clair. À traiter côté
--    interface d'abord.
-- -----------------------------------------------------------------------------

-- 3.0 VÉRIFICATION PRÉALABLE DU BLOC 3 — 0 ligne attendue.
select cle, jsonb_typeof(valeur) as type_json, valeur
  from params
 where (cle = 'veille_nuit' and not (
          jsonb_typeof(valeur) = 'object'
          and (valeur ? 'debut') and (valeur ? 'fin')
          and (valeur ->> 'debut') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and (valeur ->> 'fin')   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
    or (cle = 'mode_medias' and not (
          jsonb_typeof(valeur) = 'string'
          and (valeur #>> '{}') in ('alterne', 'serie')))
    or (cle = 'duree_cache_min' and not (
          jsonb_typeof(valeur) = 'number'
          and (case when jsonb_typeof(valeur) = 'number'
                    then (valeur #>> '{}')::numeric end) between 3 and 60))
    or (cle = 'a_quai_origine_s' and not (
          jsonb_typeof(valeur) = 'number'
          and (case when jsonb_typeof(valeur) = 'number'
                    then (valeur #>> '{}')::numeric end) between 0 and 1800))
    or (cle = 'vitesse_ticker_px_s' and not (
          jsonb_typeof(valeur) = 'number'
          and (case when jsonb_typeof(valeur) = 'number'
                    then (valeur #>> '{}')::numeric end) between 20 and 400))
 order by cle;

-- 3.1 Les contraintes elles-mêmes.
begin;

alter table params drop constraint if exists params_veille_nuit_forme;
alter table params add constraint params_veille_nuit_forme check (
  cle <> 'veille_nuit' or (
    jsonb_typeof(valeur) = 'object'
    and (valeur ? 'debut') and (valeur ? 'fin')
    and (valeur ->> 'debut') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and (valeur ->> 'fin')   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  )
);

alter table params drop constraint if exists params_mode_medias_forme;
alter table params add constraint params_mode_medias_forme check (
  cle <> 'mode_medias' or (
    jsonb_typeof(valeur) = 'string' and (valeur #>> '{}') in ('alterne', 'serie')
  )
);

alter table params drop constraint if exists params_duree_cache_min_forme;
alter table params add constraint params_duree_cache_min_forme check (
  cle <> 'duree_cache_min' or (
    jsonb_typeof(valeur) = 'number'
    and (case when jsonb_typeof(valeur) = 'number'
              then (valeur #>> '{}')::numeric end) between 3 and 60
  )
);

alter table params drop constraint if exists params_a_quai_origine_s_forme;
alter table params add constraint params_a_quai_origine_s_forme check (
  cle <> 'a_quai_origine_s' or (
    jsonb_typeof(valeur) = 'number'
    and (case when jsonb_typeof(valeur) = 'number'
              then (valeur #>> '{}')::numeric end) between 0 and 1800
  )
);

alter table params drop constraint if exists params_vitesse_ticker_forme;
alter table params add constraint params_vitesse_ticker_forme check (
  cle <> 'vitesse_ticker_px_s' or (
    jsonb_typeof(valeur) = 'number'
    and (case when jsonb_typeof(valeur) = 'number'
              then (valeur #>> '{}')::numeric end) between 20 and 400
  )
);

commit;

-- -----------------------------------------------------------------------------
-- 4. TEST D'ACCEPTATION — la charge d'attaque doit être REFUSÉE.
--    Attendu : « new row for relation "params" violates check constraint
--    "params_meteo_sommet_forme" ». Si cette commande RÉUSSIT, la contrainte
--    n'est pas en place.
-- -----------------------------------------------------------------------------
-- update params
--    set valeur = '{"t":"<img src=x onerror=alert(1)>","ciel_fr":"Beau","ciel_en":"Fine"}'::jsonb
--  where cle = 'meteo_sommet';

-- Contrôle de présence des contraintes :
-- select conname from pg_constraint
--  where conrelid = 'params'::regclass and contype = 'c' order by conname;
