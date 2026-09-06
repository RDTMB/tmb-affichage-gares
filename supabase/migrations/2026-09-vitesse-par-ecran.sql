-- VITESSE DU BANDEAU PROPRE À UN POSTE (`ecrans.vitesse_ticker_px_s`).
--
-- La bonne vitesse de défilement n'est pas la même partout : taille de
-- l'écran, distance de lecture et quantité d'information diffusée diffèrent
-- d'une gare à l'autre. Le réglage global reste la règle ; cette colonne
-- n'est qu'une SURCHARGE par poste, sur le modèle exact de la veille de nuit
-- (`veille_debut` / `veille_fin`). NULL = le poste suit le global.
--
-- Les bornes reprennent celles du moteur (src/core/ticker.ts, 20–400 px/s) :
-- au-delà l'affichage devient illisible, et une valeur aberrante posée
-- directement en base ne doit jamais figer ni emballer un bandeau.
--
-- L'écran la reçoit par son SIGNAL DE VIE, comme la veille : elle s'applique
-- sans rechargement, au plus tard au cycle suivant. Aucun GRANT à ajouter —
-- anon lit déjà `ecrans`, et n'écrit que les colonnes du signal de vie.
--
-- Le bloc est IDEMPOTENT : rejouable tel quel sur une base qui l'a déjà.

alter table ecrans add column if not exists vitesse_ticker_px_s int;

alter table ecrans drop constraint if exists ecrans_vitesse_ticker_valide;
alter table ecrans add constraint ecrans_vitesse_ticker_valide
  check (vitesse_ticker_px_s is null or vitesse_ticker_px_s between 20 and 400);

-- Le journal d'exploitation trace aussi cette colonne.
drop trigger if exists trg_journal_ecrans on ecrans;
create trigger trg_journal_ecrans
  after insert or delete or
    update of veille_debut, veille_fin, vitesse_ticker_px_s, gare, type,
      recharger_demande_at
  on ecrans
  for each row execute function private.tracer_ecriture(
    'id', '', 'veille_debut', 'veille_fin', 'vitesse_ticker_px_s', 'gare', 'type',
    'recharger_demande_at'
  );
