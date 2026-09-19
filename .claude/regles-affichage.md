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
- **Compte à rebours** : cases (« chips ») toutes de la même taille.
- **Messages** : modifiables après création ; traduction anglaise générée
  automatiquement (service de traduction) puis éditable.

## Ailleurs

Le GRAND picto motrice et la ligne « EXPRESS — sans arrêt / non-stop » sont
de l'affichage, mais ils sont indissociables de la règle express — celle qui
décide quand un express circule et quand il est « à traiter ». Ils vivent
donc avec elle, dans `.claude/regles-horaires.md` : une seule copie, jamais
deux.
