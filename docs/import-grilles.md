# Charger une nouvelle grille horaire — guide de l'exploitation

Depuis la Supervision, onglet **Horaires**. Aucune intervention informatique :
le fichier Excel d'exploitation suffit. Premier cas réel : la grille
hiver 2026-2027. Le format attendu du fichier est décrit dans
`docs/format-excel-horaires.md` ; le fichier été 2026 sert de modèle.

## Charger la grille hiver en 6 étapes

1. **Préparer le fichier.** Le classeur `.xlsx` de l'exploitation, une feuille
   par grille (« Hiver »), construit comme le document été 2026 : titre avec
   les dates en ligne 1, « HORAIRES DES MONTEES », la ligne des « Train N »,
   la ligne des lettres (R facultatif, b vélos, ÿ express), les gares en
   colonne A avec A / D en colonne B, puis « HORAIRES DES DESCENTES ». En
   hiver, le Nid d'Aigle n'a pas d'heure (ligne absente ou tirets) : Bellevue
   est le terminus normal.
2. **Ouvrir la Supervision**, se connecter avec un compte portant le rôle
   supervision, administrateur ou technique (les grilles sont partagées :
   un horaire corrigé un matin de service ne doit attendre personne),
   onglet **Horaires**, bouton **Charger un fichier Excel…**,
   choisir le fichier. La lecture prend une seconde.
3. **Vérifier chaque feuille** dans l'aperçu :
   - le **nom** de la grille est proposé (« Hiver 2026-2027 »), modifiable ;
   - les **dates de validité** sont lues dans le titre du fichier : les
     confirmer ou les corriger (du → au ; « + Ajouter une période » pour une
     deuxième plage ; ✕ pour en retirer une). Tant qu'aucune date n'est
     renseignée, le bouton reste gris ;
   - les **erreurs** en rouge : le fichier doit être corrigé dans Excel, puis
     rechargé. Le message donne la feuille, la ligne et la colonne ;
   - les **avertissements** en orange : à lire, puis cocher « J'ai lu ces
     avertissements » ;
   - les **écarts** avec la grille en service sur ces dates (heures modifiées
     surlignées en jaune dans le tableau, trains ajoutés en bleu) : c'est le
     contrôle final que le fichier dit bien ce qu'on croit ;
   - les cases **Facultatif** et **Vélos** au-dessus de chaque train sont
     pré-cochées d'après le fichier et modifiables ; « EXPRESS » vient du
     fichier et ne se change pas ici ;
   - une case par feuille permet d'exclure une feuille qui n'a pas changé.
4. **Journées déjà préparées.** Si des journées de ces dates existent déjà
   (préparées en Supervision, peut-être retouchées à la main), elles sont
   listées, décochées. Cocher celles à **réinitialiser depuis la nouvelle
   grille** ; les autres gardent leurs modifications. Par défaut, on ne touche
   à rien.
5. **Enregistrer et mettre en service.** Un récapitulatif demande
   confirmation : ce qui est chargé, quelle ancienne grille est remplacée,
   quelles journées sont réinitialisées. Après validation, la nouvelle grille
   apparaît « Active » dans la liste ; l'ancienne grille couvrant les mêmes
   dates est désactivée automatiquement (elle reste dans la liste, prête à
   être réactivée). **Rien ne change sur les écrans avant la première date de
   validité.** Tout est consigné dans l'historique des publications et le
   journal d'exploitation.
6. **Contrôler sur un écran.** Ouvrir un écran de gare avec une date de la
   nouvelle période, par exemple
   `ecran.html?gare=saint-gervais&simule=10:18` le jour venu, ou dès
   maintenant en Supervision → Circulations en naviguant à une date de la
   période : la journée se prépare depuis la nouvelle grille.

## Corriger une heure sans repasser par Excel

Une heure fausse repérée un matin de service se corrige dans l'application.

1. Onglet **Horaires**, ligne de la grille, bouton **Corriger** (ou **Voir**
   puis **Corriger cette grille**). Le tableau qui s'ouvre est celui du
   document : trains en colonnes, gares en lignes, A et D, montées puis
   descentes.
2. **Cliquer la case** et taper l'heure — `7:26`, `07:26:30` ou `7h26`, les
   mêmes formats qu'à l'import. Une saisie qui n'est pas une heure reste
   affichée telle quelle, en rouge, avec sa raison : rien n'est deviné à
   votre place.
3. Le contrôle est **permanent**, et c'est celui de l'import : les erreurs
   s'affichent sous la cellule ou sous la colonne du train et bloquent
   l'enregistrement ; les avertissements (arrêt inhabituel, rotation serrée)
   se lisent puis se cochent. En haut, la liste des **écarts** avec la version
   d'origine dit, en français, tout ce qui a changé.
4. Les journées **déjà préparées** sur les dates de la grille sont listées,
   décochées : corriger la grille ne réécrit pas ce qu'un agent a retouché
   pour un jour précis. **Pour modifier les trains d'aujourd'hui, c'est
   l'onglet Circulations, pas celui-ci.**
5. **Enregistrer la correction.** Une **nouvelle version** de la grille est
   créée et mise en service ; la précédente est désactivée et reste dans la
   liste. Revenir en arrière, c'est la **Réactiver**. Une version n'est jamais
   réécrite : l'historique des corrections reste lisible dans la liste et au
   journal.

Autres gestes disponibles dans le même tableau : cocher ou décocher
**Express** (le train perd ses arrêts de Col de Voza et Bellevue ; décoché,
les cases réapparaissent vides et le contrôle les réclame), **Facultatif**,
**Vélos** ; **✕** au-dessus d'une montée retire la rotation entière (montée et
descente appariée) ; **+ Ajouter une rotation** en crée une, pré-remplie par
décalage d'une heure depuis la précédente.

> Après toute correction, **rediffusez le document imprimé** : voir
> « Rediffuser le document officiel » ci-dessous.

## Prolonger une saison

Les dates de validité ne se corrigent pas dans l'éditeur de contenu : elles se
modifient **en place**, sans créer de version.

1. Onglet **Horaires**, bouton **Modifier** sur la ligne de la grille.
2. Corriger le `du` / `au`, ou **+ Ajouter une période** pour une deuxième
   plage.
3. L'**effet des dates saisies** s'affiche avant d'enregistrer, plage par
   plage : les dates ajoutées (et quelle grille elles remplacent, ou quelle
   grille plus récente reste prioritaire), les dates retirées (et qui reprend
   la main, ou qu'il n'y aura plus de service).
4. Les journées déjà préparées **dans les dates gagnées** sont listées,
   décochées.
5. **Enregistrer les modifications.** Le nom, les dates et le commentaire sont
   modifiés en place, avec trace au journal ; les heures, elles, n'ont pas
   bougé.

## Préparer la grille hiver par duplication

Tant que l'Excel hiver n'existe pas, la grille d'hiver se fabrique depuis
celle d'été.

1. Onglet **Horaires**, bouton **Dupliquer** sur la grille d'été à copier.
2. Saisir le **nom** (« Hiver 2026-2027 ») et les **dates de validité** : ils
   sont volontairement vides, ce sont eux qui distinguent la nouvelle grille
   de l'ancienne.
3. **Retirer le Nid d'Aigle (grille d'hiver)** : tout passage au Nid d'Aigle
   disparaît, Bellevue devient le terminus. Les trains **express**, qui
   n'existent que pour sauter Col de Voza et Bellevue en allant au Nid
   d'Aigle, sont alors signalés en erreur : décocher leur case Express (ils
   redeviennent des trains ordinaires — il faut alors leur saisir les heures
   de Col de Voza et Bellevue) ou retirer la rotation.
4. **Retirer les rotations** inutiles avec le **✕** au-dessus de chaque
   montée, **ajouter** celles qui manquent, corriger les heures.
5. **Enregistrer la nouvelle grille.** Elle est active dès sa première date de
   validité ; aucune autre grille n'est désactivée — c'est une grille de plus,
   pas une correction.
6. Contrôler sur un écran : `ecran.html?gare=bellevue&simule=10:18` à une date
   de la période, ou Supervision → Circulations à cette date.

## Rediffuser le document officiel après une correction

**À lire une fois, et à appliquer chaque fois.** Corriger une grille dans
l'application change ce que les écrans de gare affichent — et **rien d'autre**.
Le dépliant imprimé, l'affiche en gare et le fichier envoyé aux partenaires
continuent d'annoncer l'ancienne heure. C'est le papier que le voyageur a en
main : tant qu'il n'est pas refait, l'affichage et le papier se contredisent,
et c'est le papier qui gagne aux yeux du public.

1. Onglet **Horaires**, bouton **Télécharger** sur la ligne de la grille.
   Le fichier `horaires-<référence>.xlsx` reprend le format du document
   d'exploitation : mêmes blocs montées / descentes, mêmes « Train N », mêmes
   lettres de légende (R, b, ÿ), mêmes libellés de gares.
2. Ouvrir le fichier dans Excel, **refaire la mise en forme d'impression**
   (polices, bordures, fusions, logo, en-têtes) : l'export porte les
   **valeurs**, pas la maquette. Le document de l'été 2026 sert de modèle.
3. Réimprimer, réafficher en gare, renvoyer aux partenaires.

Deux points à connaître sur le fichier exporté :

- **Mont Lachat n'y figure pas.** C'est une halte de **service**, que l'import
  ignore volontairement : ses heures n'existent nulle part dans l'application
  et ne peuvent donc pas être réécrites. Une note en bas de feuille le dit.
- **Il se recharge tel quel**, par « Charger un fichier Excel… » : c'est aussi
  le chemin pour corriger une grille dans Excel plutôt qu'à l'écran. Les
  heures y sont de vraies heures Excel (format `h:mm` à l'affichage, secondes
  conservées dans la valeur). Si un train a une origine ou un terminus
  différent de ses voisins, le format du document ne sait pas l'écrire :
  l'application l'annonce **avant** le téléchargement, et le fichier reste
  bon pour l'impression.

## Revenir en arrière

Dans la liste, **Désactiver** la grille chargée : la confirmation dit, plage
par plage, quelle grille reprend la main, ou qu'il n'y aura plus de service,
et quelle grille **réactiver** pour retrouver l'état précédent. Une grille
désactivée n'est jamais supprimée : « Réactiver » la remet en service en
quelques secondes. Si deux grilles actives couvrent la même date, la plus
récemment chargée l'emporte.

## Si l'import refuse le fichier

Le message indique toujours la feuille, la ligne et la colonne. Les cas les
plus fréquents :

| Message                                                            | Cause                                                     | Remède                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| « Ce fichier est un ancien classeur .xls »                         | Format Excel 97-2003                                      | Excel → Enregistrer sous → Classeur Excel (.xlsx)                         |
| « Aucune feuille ne contient les titres HORAIRES DES MONTEES… »    | Titres absents ou réécrits en colonne A                   | Rétablir « HORAIRES DES MONTEES » et « HORAIRES DES DESCENTES » en col. A |
| « Heure manquante : TRAIN 9, Motivon, arrivée (…ligne 9, col. G) » | Cellule vide                                              | Saisir l'heure, ou un tiret sur les lignes A **et** D si le train saute   |
| « … n'est pas une heure — formats acceptés : 7:26, 07:26:30, 7h26 » | Texte libre, nombre qui n'est pas une heure               | Retaper l'heure au format heure d'Excel                                   |
| « TRAIN 9 : passages absents à Col de Voza et Bellevue sans ÿ »    | Tirets sans le symbole express                            | Ajouter ÿ (Wingdings) sur la ligne des lettres, ou saisir les heures      |
| « TRAIN 3 : symbole express (ÿ) mais des heures à Col de Voza »    | Symbole express sur un train qui s'arrête                 | Retirer le ÿ, ou mettre des tirets à Col de Voza et Bellevue              |
| « TRAIN 1 apparaît deux fois »                                     | Même numéro sur deux colonnes                             | Corriger les numéros (montées impaires, descentes paires)                 |
| « TRAIN 4 : descente sans montée appariée (TRAIN 3 absent) »       | Rotation incomplète                                       | Ajouter la montée, ou renuméroter la descente                             |
| « Gare inconnue « … » »                                            | Nom de gare non reconnu                                   | Utiliser Le Fayet, St Gervais, Motivon, Col de Voza, Bellevue, Nid d'Aigle |
| « Les dates de « A » et de « B » se chevauchent »                  | Deux feuilles valides le même jour                        | Corriger les dates de validité de l'une des deux feuilles                 |

Une **erreur** bloque l'enregistrement : rien n'est écrit à moitié. Un
**avertissement** (arrêt inhabituel, rotation serrée, train disparu depuis la
grille précédente, indicateur différent du fichier) s'acquitte d'une case et
n'empêche pas l'enregistrement.

## Côté base de données (une fois, par l'administrateur)

Avant la première utilisation, exécuter `supabase/ajout-grilles.sql` dans
l'éditeur SQL du projet Supabase (voir `docs/mise-en-service.md` §B, étape 13,
et §I pour l'ordre en production). Le script est rejouable et insère les deux
grilles été 2026 telles qu'elles étaient dans le dépôt.
