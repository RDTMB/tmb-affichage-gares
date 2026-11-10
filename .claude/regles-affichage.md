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
- **Où est un train sur la grille du jour** (`positionsTrains`, rond ou flèche
  couleur rame, 05/11/2026) : à QUAI (arrivée ≤ maintenant < départ de la gare,
  retard compris) → le ROND, seul, SUR la ligne de la gare ; EN ROUTE (parti de
  g1, pas arrivé à la gare SUIVANTE DE SES PASSAGES g2) → la FLÈCHE, seule, À
  MI-CHEMIN entre les lignes de g1 et g2, dans la colonne du train — jamais
  interpolé à l'heure. Jamais les deux ensemble (lot E, 05/11/2026 : rond ET
  flèche superposés, Thomas n'en veut pas). Le calcul se
  fait sur les lignes AFFICHÉES (`ancrePosition`, `grille-logique.ts`) : en
  descente le tableau est inversé ; un express traverse les lignes sautées ;
  une gare sans ligne (hors section, non desservie) ne fait RIEN inventer — le
  train retombe à quai (rond) sur la ligne affichée la plus proche. Inchangé : en
  ligne dès le départ THÉORIQUE de l'origine (un train retardé y est à quai),
  disparu après l'arrivée au terminus, supprimé = pas de rond. CSS : `--saut`
  lignes sous la cellule de g1 (la flèche seule ; le rond n'a plus d'état « en
  route »), `top` en % de la cellule (aucune unité de
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
  (1,3 corps ; mesurée 1,29 AVEC Lato chargée, 1,19 avec la police de repli :
  une mesure sans Lato est fausse), pas sur le `em` d'une cellule `td.saute`.
  En PORTRAIT une cellule de 75 px ne laisse que 9 px de chaque côté de l'heure :
  le rond y passe à 1,3 u (au lieu de 1,7) et déborde sa cellule de 6,8 px ; il
  ne touche pas son heure (3,4 px) mais n'est qu'à ~0,5 px de l'heure voisine
  (mesuré à 12 colonnes ; à 13 colonnes, 69 px, NON mesuré). Décision à faire
  confirmer par l'exploitation : un rond collé au bord de la colonne éclairée
  peut se lire comme celui de la colonne voisine. **La flèche** est le train ENTRE
  DEUX GARES (seule : jamais à quai, jamais avec le rond) et pointe TOUJOURS
  vers le bas, en montée comme en descente : les lignes se lisent de haut en
  bas et la gare suivante est la ligne du dessous. Élément à part
  (`<svg class="train-fleche">`), pas un pseudo-élément : sur `grille.html` le
  rond pulse et un enfant hériterait de son opacité. Même voie que le rond,
  hauteur par `--saut` ; calée à 0,5 px par ligne comptée près de la bordure
  de la cellule (grille.html : mesuré -0,5 px pour un saut, -1,5 px pour
  l'express de trois lignes avant correction).
  **La TRANSFORMATION** (lot E) : le passage de l'un à l'autre est ANIMÉ, dans
  les deux sens — le rond devient la flèche en descendant de la ligne de la
  gare jusqu'à mi-chemin (départ), la flèche devient le rond en rejoignant la
  ligne de la gare suivante (arrivée). Les deux pages reconstruisent leur
  tableau par `innerHTML` : une transition CSS ne se jouerait jamais ; le
  passage est joué APRÈS chaque rendu par-dessus le tableau neuf
  (`grille-transition.ts`, FLIP) : fondu croisé avec échelle de l'ancienne forme
  (un clone, le « fantôme ») et de la nouvelle, `transform` et `opacity`
  seulement, 0,6 s, sans rebond, sans `will-change`. Jouée UNIQUEMENT quand un
  train change d'UN état entre deux rendus consécutifs à moins de 2,5 fois
  l'intervalle de rendu (`mouvement`) : jamais au premier affichage, jamais
  quand la position est inchangée, jamais quand l'heure saute (`?simule=`,
  rechargement, retour d'onglet : `oublie()`), jamais sur plusieurs états d'un
  coup (position finale posée directement), jamais avec
  `prefers-reduced-motion: reduce`. Pendant le passage le pulse du rond est
  coupé (`[data-transition]`) et repart de l'opacité 1 à la fin. `grille.html`
  ne RÉÉCRIT plus un tableau inchangé (`poseTableau`) : avant, le rond était
  recréé chaque seconde et son pulse repartait de zéro à chaque tick (mesuré).
  Légende « en ligne / running » : un rond ; voir la PR pour la question de la
  flèche.
- **Profil de la ligne** (bandeau de l'écran de gare et de la grille du jour,
  10/11/2026 ; `profil-ligne.ts`). Quatre décisions de l'exploitant, du même
  jour :
  - **La ligne DU JOUR, rien de plus.** Au-dessus du sommet de la grille
    (`sommetDeLaGrille`), rien n'est dessiné : en hiver le profil va du Fayet
    à Bellevue et s'étire sur toute sa boîte. Pas de tronçon « éteint » — un
    tracé pâle se lisait encore comme une ligne où l'on peut aller.
  - **Un sigle par gare**, au-dessus de son point : FAY, STG, MOT, CDV, BLV,
    NDA (`SIGLES_GARES`). Une gare qui n'y figure pas reçoit ses initiales.
  - **La machine dit son sens** : un rond prolongé d'un nez tourné dans le sens
    de la marche, à quai comme en route. À quai, le nez regarde le tronçon
    qu'elle va prendre.
  - **La machine AVANCE le long de la voie**, d'une gare à la suivante de ses
    passages, au prorata du temps (`avancementsTrains`) — express compris, qui
    suit le tracé par les gares qu'il saute. C'est une position ESTIMÉE d'après
    la grille et le retard DÉCLARÉ, pas une mesure : un train arrêté en pleine
    voie sans retard saisi continue d'avancer à l'écran. **Pour ce dessin
    seulement** : la grille du jour garde sa règle du 05/11 (ci-dessus — à
    mi-chemin, jamais interpolé), et l'avancement ne doit JAMAIS porter une
    heure, un compte à rebours ni un état de quai.

  Le reste : un train supprimé n'y est pas ; la gare du poste (`?gare=`) est
  un ANNEAU rouge autour du point, pas un point rouge — une machine à quai s'y
  pose dedans et reste visible ; une gare absente du profil ne fait rien
  inventer, la machine n'est pas dessinée. **Croisement** : deux machines au
  même endroit (voie unique, croisement en gare tous les jours) reculent
  chacune le long de sa marche, nez à nez de part et d'autre de la gare —
  recul progressif, nul à 20 unités d'écart, pour qu'aucune ne saute. Retiré
  sous 4/3 (écran) et en portrait (grille) : il n'y a plus la place de le lire.
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
