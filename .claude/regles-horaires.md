# Règles horaires — numérotation, sections, grilles

Ouvre ce fichier si tu t'apprêtes à calculer ou déplacer une heure, à limiter
un terminus, à retirer ou ajouter une desserte, à numéroter ou nommer un
train, ou à choisir la grille qui s'applique à une journée.

Voisins : `.claude/regles-affichage.md` (ce que l'écran en fait),
`.claude/regles-courses-libres.md` (spéciaux, libellé libre, accès).

## Où vivent les grilles

- Les grilles horaires vivent EN BASE (table `grilles`), chargées par
  l'exploitation depuis l'Excel exploitation dans la Supervision → onglet
  Horaires (`docs/import-grilles.md` ; contrat de format :
  `docs/format-excel-horaires.md`). `docs/grilles-historique/` = référence
  été 2026 (oracle des tests, grilles de la démo), jamais modifiée à la main
- Une grille enregistrée se CORRIGE aussi sans repasser par l'Excel
  (Supervision → Horaires → « Corriger », ou « Dupliquer ») : les gestes sont
  dans `src/core/edition-grille.ts` (PUR, testé), l'enchaînement dans
  `src/pages/correction-grille.ts`, le rendu dans `src/pages/onglet-horaires.ts`.
  N'écris JAMAIS une deuxième règle de validation : `validationEdition()`
  réutilise `valideTrains()` de l'import, et c'est le point
- Le document d'exploitation se REFAIT depuis une grille
  (`src/core/export-grille.ts` → cellules, `src/core/ecriture-xlsx.ts` → .xlsx) :
  la boucle export → réimport est verte, et c'est ce test qui tient le format.
  Corriger dans l'application impose de REDIFFUSER le document imprimé, sinon
  l'affichage et le papier divergent

## Règles qui piègent (ne pas improviser)

- **Trains numérotés** 1–25 impairs = montées, 2–26 pairs = descentes.
  Libellé canonique, partout : « TRAIN 9 » (majuscules, sans « n° ») —
  `libelleTrain()`, seule source pour la supervision et la grille du jour.
  SEULE exception, voulue par l'exploitant : le badge rouge devant le nom de
  la gare de destination sur l'écran de gare, qui porte l'écriture compacte
  « T9 » / « SUP 2 » (`libelleTrainCourt()`, même calcul de rang). Cette
  divergence est délibérée, ce n'est pas un oubli à « corriger ».
- **Rames appariées** : la rame se choisit sur la montée UNIQUEMENT ; la
  descente de la même rotation hérite automatiquement (non modifiable).
  En supervision, montée et descente d'une rotation sont affichées l'une
  sous l'autre.
- **Section exploitée** (`jours.gare_debut` / `gare_fin`, bornes incluses) :
  « une partie seulement de la ligne est exploitée » est UN concept, pas deux.
  « Terminus Bellevue » n'en est qu'un cas particulier — il n'existe donc
  qu'une seule troncature dans le moteur, `tronqueTrain()`, et les bornes se
  lisent TOUJOURS par `sectionDuJour()` (un instantané en cache d'avant le
  déploiement n'a pas les colonnes ; un index -1 viderait tous les écrans).
  INVARIANT : la section est la borne EXTÉRIEURE, la colonne `terminus` d'une
  circulation ne peut que réduire davantage, jamais dépasser. Les heures ne
  sont jamais recalculées : la grille est simplement TRONQUÉE. Une gare hors
  section affiche « Ligne fermée » (message saisi, sinon défaut bilingue
  construit sur la section) et JAMAIS « service terminé ». La section se
  REPORTE sur la journée suivante à sa création (`sectionReportee()`) : un
  chantier dure des semaines, et une journée oubliée annoncerait des trains
  qui ne circulent pas.
- **Départ RÉEL d'un train supplémentaire** (`circulations.depart_reel`) :
  le temps de stationnement au terminus est ESTIMÉ à la création (battement),
  et les horaires de la descente en découlent. Sur la ligne de DESCENTE, un
  bouton « Le train est reparti » ouvre une confirmation (heure pré-remplie à
  l'heure courante, récapitulatif gare par gare recalculé en direct), puis
  « Corriger l'heure de départ » — une heure constatée reste rectifiable.
  `recalculeDescenteSup()` relit la desserte dans les passages EXISTANTS et ne
  la réinvente jamais : l'agent l'a choisie à la création. Refus si l'heure
  précède l'arrivée de la montée, ou dépasse l'heure courante de plus de
  2 min (on CONSTATE un départ, on ne le programme pas) ; avertissement
  non bloquant au-delà de 30 min d'écart avec l'estimation.
  EXCEPTION ASSUMÉE, à ne pas « corriger » : cette écriture est IMMÉDIATE
  alors que tout l'onglet Circulations passe par le brouillon et « Publier ».
  La correction a lieu au moment où le train s'en va, avec des voyageurs qui
  attendent en bas ; un clic de publication supplémentaire laisserait une
  heure fausse à l'écran pendant ce temps. En contrepartie, l'échec est dit
  franchement — message PERSISTANT, anciennes heures conservées. L'écran de
  gare l'annonce en couleur NEUTRE (« Horaire confirmé / Departure
  confirmed ») : ce train n'est pas en retard, son heure n'était pas ferme.
- **Terminus par train** : chaque montée (hors express) peut être limitée à
  Bellevue individuellement (colonne Terminus) ; sa descente appariée part
  alors de Bellevue. La bascule « Terminus Bellevue » s'exprime « à partir
  du TRAIN N » (N = montée, impair ; pair normalisé vers N−1) et PRÉ-REMPLIT
  la colonne des rotations dont la montée porte un numéro ≥ N — la colonne
  reste prioritaire et ajustable ; journée entière = à partir du T1.
- **Express** : passages absents à col-de-voza et bellevue (rien à afficher
  dans ces gares) ; GRAND picto motrice à droite du nom de la destination +
  ligne « EXPRESS — sans arrêt / non-stop : Col de Voza & Bellevue ». Un
  express n'est JAMAIS tronqué à Bellevue : dans une plage limitée, il
  circule normalement et est signalé « à traiter » (suppression ou
  requalification manuelle en supervision) ; sa descente appariée non
  express part, elle, de Bellevue.
- **Facultatif** : n'apparaît sur AUCUN écran tant qu'il n'est pas activé en
  supervision ; une fois activé, il s'affiche normalement.
- **Terminus Bellevue** (fermeture imprévue, météo : à partir du TRAIN N) :
  montées ≥ N → destination « Bellevue — terminus exceptionnel », express
  signalés « à traiter » (jamais retirés automatiquement), écran du Nid
  d'Aigle → état « tronçon fermé » bilingue avec logo dès qu'il n'a plus
  aucun passage à afficher. En HIVER, Bellevue est le terminus NORMAL : la
  grille d'hiver n'a simplement aucun passage au Nid d'Aigle (ce n'est pas
  la bascule « à partir du T1 » qui fait le régime hiver).
- **Grilles** (table `grilles`) : une grille ne s'applique qu'à ses périodes
  (bornes incluses) ; seules les grilles ACTIVES comptent ; si deux grilles
  actives couvrent une date, la plus récemment chargée l'emporte
  (`serviceActif()`) ; désactiver une grille redonne la main à la précédente
  (retour arrière) ; hors de toute période = AUCUN service, jamais de repli ;
  une version n'est jamais réécrite (recharger crée « …-v2 » et désactive
  la précédente, réactivable). Les écrans affichent une journée avec la
  grille qui l'a générée, sinon celle en vigueur à sa date
  (`grillePourJour()`), jamais « la première de la liste ».
- **Corriger une grille suit la MÊME règle qu'un rechargement** : une
  correction à l'écran crée elle aussi « …-v2 » et désactive la précédente.
  SEULES les métadonnées (nom, dates de validité, commentaire) se modifient
  EN PLACE, par « Modifier » — prolonger une saison d'une semaine ne change
  aucune heure, et créer une version pour ça brouillerait l'historique
- **Rotation** : la rame d'une montée assure la descente suivante (ex.
  T1 07:00 → arrivée 08:05:30 → repart T2 08:13:30).
