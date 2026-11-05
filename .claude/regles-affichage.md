# Règles d'affichage — ce que l'écran montre, et ce qu'il refuse de montrer

Ouvre ce fichier si tu t'apprêtes à changer ce qu'un écran de gare ou la
grille du jour MONTRE : colonnes, pastilles de remplissage, compte à rebours,
train barré, mode dégradé, messages voyageurs.

Voisins : `.claude/regles-horaires.md` (le calcul derrière les heures),
`.claude/charte-graphique.md` (couleurs, polices, logos).

## Règles qui piègent (ne pas improviser)

- **Affluence ≠ statut** : « Complet » / « Dernières places » (table
  `affluence`, docs/01 §2.8) est un axe INDÉPENDANT de la ponctualité — un
  train à l'heure peut être complet, un train en retard peut être vide. D'où
  une table à part, et non une colonne de `circulations` : ce n'est pas la
  même donnée, et surtout pas la même main (la caisse écrit ici, jamais dans
  `circulations`). La donnée est (date, numéro) : un TRAIN 9 complet l'est
  dans TOUTES les gares qu'il doit encore desservir.
  L'ABSENCE de ligne vaut « places disponibles » — pas de troisième niveau,
  remettre un train à la normale est une SUPPRESSION.
  Tout se déclare dans l'onglet « Places », qui porte la MÊME barre de date
  que Circulations (même `allerDate`, même `dateSel`) : la caisse n'a pas
  l'onglet Circulations et doit pouvoir préparer le lendemain. Le jour même
  la liste ne garde que les DÉPARTS RESTANTS ; les autres dates listent TOUS
  les trains — il n'y a pas d'heure courante à laquelle se comparer. Une date
  PASSÉE est en lecture seule pour tout le monde, supervision comprise, et
  une journée pas encore OUVERTE l'est pour la caisse (RLS réserve `jours` à
  la supervision) : la liste reste affichée, les sélecteurs sont éteints, un
  bandeau dit qui l'ouvre, et le signal temps réel rend la main dès que c'est
  fait. Le refus est calculé UNE fois (`saisieAffluence`) et sert au rendu
  comme à l'écriture — `disabled` se retire dans l'inspecteur.
  Le remplissage se déclare dans l'onglet **Places** UNIQUEMENT (droit
  `affluence`, ouvert à admin, supervision et caisse) : un seul endroit pour
  les deux rôles. Circulations n'en garde que le filet de rangée, qui est une
  information et non une commande.
  EXCEPTION ASSUMÉE, à ne pas « corriger » : l'écriture est IMMÉDIATE, hors
  brouillon et hors « Publier », pour la même raison que `depart_reel` — on
  constate au guichet qu'on ne vend plus, avec des voyageurs sur le quai. En
  contrepartie l'échec est dit franchement (message persistant) et l'écran de
  saisie garde son état précédent.
- **Arrivée + départ** affichés pour chaque passage ; les arrivées sont les
  heures RÉELLES du document d'exploitation (dans les grilles) ;
  `arret_intermediaire_s` (60 s) n'est qu'un REPLI si une arrivée manque ;
  « — » au point d'origine.
- **Suppression** : le train reste affiché barré avec motif jusqu'à son
  heure théorique, puis disparaît.
- **Mode dégradé** : cache ≤ 15 min avec badge « données de HH:MM », puis
  ÉCRAN NEUTRE (logo + horloge + message bilingue) — jamais d'horaires
  potentiellement faux.
- **Hors saison** (aucune grille active ne couvre la date) : l'écran de gare
  passe en VEILLE permanente, message de fermeture bilingue sous l'horloge,
  bandeau de messages arrêté ; la grille du jour montre le même message en
  pleine page et GARDE son bandeau (annonce de réouverture). Automatique,
  sans interrupteur. La décision est `vueJournee()` / `etatSaison()`
  (`src/core/horaires.ts`), consultée AVANT toute sortie sur `!grille` —
  c'est `grille === null` qui définit le hors-saison. Un TROU de ≤ 31 jours
  ENTRE deux périodes est une faute de saisie probable : écran NEUTRE,
  jamais « fermé » — une fermeture fausse est pire qu'un écran vide. Jamais
  de fermeture annoncée sur des données périmées ou une horloge de poste
  fantaisiste (la date elle-même n'est plus sûre).
- **Où est un train sur la grille du jour** (`positionsTrains`, rond couleur
  rame, 05/11/2026) : à QUAI (arrivée ≤ maintenant < départ de la gare, retard
  compris) → rond SUR la ligne de la gare ; EN ROUTE (parti de g1, pas arrivé à
  la gare SUIVANTE DE SES PASSAGES g2) → rond À MI-CHEMIN entre les lignes de
  g1 et g2, dans la colonne du train — jamais interpolé à l'heure. Le calcul se
  fait sur les lignes AFFICHÉES (`ancrePosition`, `grille-logique.ts`) : en
  descente le tableau est inversé ; un express traverse les lignes sautées ;
  une gare sans ligne (hors section, non desservie) ne fait RIEN inventer — le
  rond retombe à quai sur la ligne affichée la plus proche. Inchangé : en
  ligne dès le départ THÉORIQUE de l'origine (un train retardé y est à quai),
  disparu après l'arrivée au terminus, supprimé = pas de rond. CSS : `--saut`
  lignes sous la cellule de g1, `top` en % de la cellule (aucune unité de
  plus : l'échelle vh / --u de `grille.html` reste la sienne), `z-index` 2
  (les cellules voisines sont `position: relative` et le couvriraient), sous
  la colonne collante de l'embed (3). Exact tant que les lignes ont la même
  hauteur — mesuré égales le 05/11/2026 ; à re-mesurer si une ligne peut
  grandir.
  **UNE voie pour le rond** (lot C, 05/11/2026) : l'HEURE ne bouge JAMAIS (le
  rond est hors flux, jamais dans le flux d'une cellule) et le rond a UNE
  abscisse, à DROITE de l'heure, la même à quai et en route — seule sa hauteur
  change. La voie (`--voie-rond`) est définie une fois par feuille de style ;
  `.train-pos.en-route` ne pose que `top`, jamais un axe horizontal (garde-fou
  `grille-vivante.test.ts`). Elle se compte sur la demi-largeur de l'heure
  (1,3 corps, mesurée 1,19 à 1,29), pas sur le `em` d'une cellule `td.saute`.
  En PORTRAIT une cellule de 75 px ne laisse que 9 px de chaque côté de l'heure :
  le rond y passe à 1,3 u (au lieu de 1,7) et déborde sa cellule de ~7 px, sans
  toucher ni l'heure ni la voisine. **La flèche** accompagne le rond ENTRE DEUX
  GARES seulement (jamais à quai) et pointe TOUJOURS vers le bas, en montée
  comme en descente : les lignes se lisent de haut en bas et la gare suivante
  est la ligne du dessous. Élément à part (`<svg class="train-fleche">`, posé
  avant le rond), pas un pseudo-élément : sur `grille.html` le rond pulse et un
  enfant hériterait de son opacité. Même voie, même hauteur (`--saut`).
- **Colonne éclairée (« prochain départ »)** : `grille.html` seulement. L'embed
  ne l'éclaire JAMAIS (`sansProchain`, même sans `?gare=`) ; le prochain
  départ y est l'affaire de la vue des départs d'une gare.
- **Sens** : « Montée / Ascent », « Descente / Descent » partout où un voyageur
  lit — jamais « Uphill / Downhill ». Titre de grille : le trajet en grand,
  le sens à côté en plus petit (`titresDesSens`, une seule source pour
  `grille.html` et l'embed). Embed par gare : « Vers X / To X » puis le sens.
- **Compte à rebours** : cases (« chips ») toutes de la même taille.
- **Messages** : modifiables après création ; traduction anglaise générée
  automatiquement (service de traduction) puis éditable.

## Ailleurs

Le GRAND picto motrice et la ligne « EXPRESS — sans arrêt / non-stop » sont
de l'affichage, mais ils sont indissociables de la règle express — celle qui
décide quand un express circule et quand il est « à traiter ». Ils vivent
donc avec elle, dans `.claude/regles-horaires.md` : une seule copie, jamais
deux.
