# Format du fichier Excel des horaires — contrat d'import

Version 1.0 — 2 septembre 2026 (décisions de l'exploitant intégrées).
Ce document décrit ce que la Supervision attend d'un classeur Excel
d'horaires pour pouvoir le charger sans intervention d'un développeur.
Il a été écrit à partir du document d'exploitation été 2026
(`2026-05-29-JMC-1-Horairesété2026-exploit-v1.xlsx`), qui sert de modèle :
**un fichier construit comme lui sera accepté**. Le mode d'emploi côté
Supervision est dans `docs/import-grilles.md`.

## 1. En un coup d'œil

Une feuille = une grille d'horaires (par exemple « Petit service »,
« Grand service », « Hiver »). Chaque feuille est bâtie ainsi :

```
Ligne 1   HORAIRES PETIT SERVICE DU 13 JUIN AU 3 JUILLET 2026 …      Mise à jour du 05/06/2026
Ligne 2   LE FAYET <> LE NID D'AIGLE                                   LEGENDE (à droite)
Ligne 3   HORAIRES DES MONTEES
Ligne 4              Train 1   Train 5   Train 7   Train 11  …         <- numéros des trains
Ligne 5              b                   R                   …         <- lettres : R, b, ÿ
Ligne 6   Le Fayet        D    07:00     09:00     10:00     11:00
Ligne 7   St Gervais      A    07:10     09:10     10:10     11:10
Ligne 8                   D    07:15     09:15     10:15     11:15
   …      Motivon / Col de Voza / Bellevue / Mont Lachat   (A puis D)
Ligne 17  Le Nid d'Aigle  A    08:05     10:05     11:05     12:05
Ligne 18  HORAIRES DES DESCENTES
Ligne 19             Train 2   Train 6   Train 8   Train 12  …
Ligne 20                                 R         …
Ligne 21  Le Nid d'Aigle  D    08:13     10:13     11:13     12:13
   …      Mont Lachat / Bellevue / Col de Voza / Motivon / St Gervais
Ligne 32  Le Fayet        A    09:24     11:24     12:24     13:24
```

Les numéros de lignes ci-dessus sont ceux du fichier été 2026 : l'import ne
s'y fie **pas**. Il se repère aux **titres** « HORAIRES DES MONTEES » et
« HORAIRES DES DESCENTES » et aux **noms de gares** de la colonne A. On peut
donc ajouter ou retirer une ligne de note sans rien casser.

## 2. Les feuilles

- L'import parcourt toutes les feuilles du classeur et retient celles qui
  contiennent les deux titres « HORAIRES DES MONTEES » et « HORAIRES DES
  DESCENTES » en colonne A. Les autres feuilles (notes, brouillons) sont
  ignorées.
- **Toutes les feuilles d'horaires sont importées**, une grille par
  feuille, chacune avec ses propres dates de validité. L'aperçu se fait
  feuille par feuille ; une case permet d'**exclure** une feuille quand une
  seule a changé.
- Le **nom de la feuille** (« Grand service ») sert à proposer le nom de la
  grille, complété par la saison et l'année (« Grand service — été 2026 »).
  Ce nom reste modifiable avant validation.
- Un classeur sans aucune feuille d'horaires est refusé : « Aucune feuille
  ne contient les titres HORAIRES DES MONTEES et HORAIRES DES DESCENTES ».
- Deux feuilles du même classeur ne peuvent pas avoir de dates de validité
  qui se chevauchent : la validation est bloquée tant que c'est le cas.

## 3. Le tableau des montées et des descentes

Chaque bloc (montées, puis descentes) se lit ainsi :

1. **La ligne des trains** : juste sous le titre. Chaque colonne porte
   « Train 1 », « Train 3 », … (la casse et les espaces n'ont pas
   d'importance ; « Train n°1 » n'est PAS reconnu). Les montées portent des
   numéros **impairs**, les descentes des numéros **pairs** ; la descente
   d'une rotation porte le numéro de sa montée + 1 (TRAIN 1 → TRAIN 2).
2. **La ligne des lettres** (facultative) : juste sous les trains, elle
   contient les indicateurs R / b / ÿ (voir §5). L'import la reconnaît
   parce qu'elle n'a ni nom de gare en colonne A, ni « A »/« D » en
   colonne B. Si aucun train n'a d'indicateur, la ligne peut être vide ou
   absente.
3. **Les lignes de gares** : colonne A = nom de la gare (écrit une fois,
   sur la première des deux lignes ; les cellules fusionnées sont
   acceptées), colonne B = **A** (arrivée) ou **D** (départ), puis une
   heure par train.
   - La gare de **départ** n'a qu'une ligne D (Le Fayet en montée, Nid
     d'Aigle en descente) ; la gare **terminus** n'a qu'une ligne A.
   - Les gares intermédiaires ont une ligne A puis une ligne D.
   - **Mont Lachat** (halte de service) est **lu puis ignoré** : ses heures
     n'apparaissent jamais sur les écrans.
   - Les noms de gares sont reconnus par mot-clé, ce qui tolère les
     variantes du document (« St Gervais (village) », « Le Nid d'Aigle
     2380m », « Le Nid d'Aigle (fin juin 2026) ») :

     | Gare de l'application | Mot-clé recherché dans la colonne A |
     | --------------------- | ----------------------------------- |
     | Le Fayet              | `fayet`                             |
     | Saint-Gervais         | `gervais`                           |
     | Motivon               | `motivon`                           |
     | Col de Voza           | `voza`                              |
     | Bellevue              | `bellevue`                          |
     | Nid d'Aigle           | `aigle`                             |
     | (ignorée)             | `lachat`                            |

   - Une gare dont le nom ne contient aucun de ces mots-clés fait refuser le
     fichier (« Gare inconnue « … » à la ligne N »).
4. Le bloc s'arrête à la première ligne qui n'est ni une gare ni un titre
   (les notes « ATTENTION : … » en bas du tableau sont donc sans effet).

Montées et descentes se distinguent **uniquement** par le titre du bloc.
L'import vérifie ensuite que l'ordre des gares correspond au sens (Le Fayet
en premier pour une montée, en dernier pour une descente).

**Grille d'hiver.** Quand le Nid d'Aigle est fermé, Bellevue est le
terminus **normal** : la feuille ne porte simplement aucune heure au Nid
d'Aigle (ligne absente, ou tirets sur toute la ligne). Les écrans affichent
alors « Bellevue » comme destination, sans mention « terminus
exceptionnel ». La bascule « Terminus Bellevue à partir du TRAIN N » de la
Supervision reste réservée aux fermetures imprévues.

## 4. Les heures

- Une heure Excel « normale » (cellule au format heure, affichée `7:26`)
  est lue **avec ses secondes** : le document affiche `7:26` mais contient
  bien 07:26:30, et c'est 07:26:30 qui est conservé pour les calculs (les
  écrans n'affichent que `07:26`).
- Une heure tapée en texte est acceptée aux formats `7:26`, `07:26`,
  `07:26:30` et `7h26`.
- Un **tiret** `-` signifie « ce train ne s'arrête pas ici » (c'est ainsi
  que le document marque les express à Col de Voza et Bellevue). Le tiret
  doit être présent sur la ligne A **et** sur la ligne D de la gare.
- Une cellule **vide** là où une heure est attendue fait refuser le fichier
  (« Heure manquante : TRAIN 9, Motivon, arrivée (feuille Grand service,
  ligne 9, colonne G) »). Une heure oubliée ne doit jamais devenir un train
  à moitié lu.
- Toute autre valeur (texte libre, nombre qui n'est pas une heure) est
  refusée avec la même précision (feuille, ligne, colonne).

## 5. Les lettres au-dessus des trains

Ce sont les symboles de la légende du document, lus tels quels :

| Lettre | Signification                                             | Police dans le document        |
| ------ | --------------------------------------------------------- | ------------------------------ |
| `R`    | Train **facultatif** (« opéré selon météo et affluence ») | texte normal                   |
| `b`    | Train accessible aux **vélos**                            | Webdings (s'affiche en vélo)   |
| `ÿ`    | Train **express** (sans arrêt à Col de Voza et Bellevue)  | Wingdings (s'affiche en train) |

Les lettres se combinent (`Rb` = facultatif + vélos, `Rÿ` = facultatif +
express). La police ne change rien à la lecture : c'est le caractère qui
compte. Une cellule vide = train normal.

Cohérence vérifiée à l'import, dans les deux sens, en **erreur bloquante** :

- un train marqué `ÿ` qui a pourtant des heures à Col de Voza ou Bellevue →
  « TRAIN 9 : symbole express mais des heures à Col de Voza » ;
- un train **non** marqué `ÿ` dont Col de Voza et Bellevue sont à `-` →
  « TRAIN 9 : passages absents à Col de Voza et Bellevue sans le symbole
  express ».

Quand une grille précédente existe pour les mêmes numéros de trains, ses
indicateurs sont comparés à ceux du fichier : **le fichier a le dernier
mot**, et chaque différence apparaît dans la liste des écarts de l'aperçu.

## 6. Ce que l'import lit, où, et ce qui se passe si c'est absent

| Information           | Où dans le fichier                                                                | Si absent ou illisible                                                             |
| --------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Feuilles d'horaires   | Feuilles contenant les deux titres HORAIRES DES …                                 | **Refus** : aucune feuille reconnue                                                |
| Numéros de trains     | Ligne sous chaque titre, cellules « Train N »                                     | **Refus** : bloc sans aucun train ; numéro en double ; parité fausse               |
| Indicateurs R / b / ÿ | Ligne sous les numéros de trains                                                  | Train considéré normal (pas d'erreur) ; comparé à la grille précédente             |
| Noms de gares         | Colonne A des lignes d'horaires                                                   | **Refus** : gare inconnue ; **ignoré** : Mont Lachat                               |
| Arrivée / Départ      | Colonne B : `A` ou `D`                                                            | **Refus** : ligne d'horaires sans A ni D                                           |
| Heures                | Une cellule par train et par ligne A/D                                            | **Refus** : cellule vide ou illisible ; `-` = pas d'arrêt                          |
| Dates de validité     | Titre en A1 (« DU 13 JUIN AU 3 JUILLET 2026 ET DU 31 AOUT AU 27 SEPTEMBRE 2026 ») | **Pré-remplies** si le titre est lisible, sinon champ vide ; à confirmer dans tous les cas |
| Nom de la grille      | Nom de la feuille + saison et année déduites des dates                            | Pré-rempli (« Grand service — été 2026 »), modifiable                              |
| Date de mise à jour   | Cellule « Mise à jour du JJ/MM/AAAA » (L1 ou Q1)                                  | Recopiée dans la provenance de la grille si présente, sinon nom du fichier seul    |

Lecture des dates du titre : quand la première date n'a pas d'année
(« DU 13 JUIN AU 3 JUILLET 2026 »), elle prend celle de la seconde. Une
période de décembre à mars prend l'année suivante pour sa fin.

## 7. Ce que l'import ne lit pas dans le fichier

Ces informations ne sont pas dans l'Excel (ou pas de façon fiable) ; elles
sont **saisies ou confirmées dans la Supervision**, pré-remplies quand c'est
possible :

- **Les dates de validité** (du … au …, plusieurs périodes possibles) :
  proposées d'après le titre, à confirmer explicitement. Tant qu'aucune
  période n'est renseignée, la validation est impossible.
- **Le nom de la grille** tel qu'il apparaît en Supervision.
- **Un commentaire** libre (pourquoi cette grille, qui l'a demandée).
- **Les gares et leurs altitudes** (Le Fayet 580 m … Nid d'Aigle 2 412 m) :
  ce sont des constantes de la ligne, définies dans l'application. Le
  « 2380m » écrit dans le titre du document n'est pas utilisé.
- **Les durées d'arrêt habituelles** (Saint-Gervais 5 min, Motivon 1,
  Col de Voza et Bellevue 2) : constantes de contrôle ; un arrêt différent
  déclenche un avertissement, pas un refus.
- **L'identifiant technique** de la grille : généré automatiquement sous la
  forme `année-saison-nom-de-feuille` (ex. `2026-ete-grand-service`), à
  partir des dates confirmées. Il n'est jamais réutilisé : réimporter une
  grille qui existe déjà crée `…-v2`, `…-v3`, et la précédente est
  désactivée automatiquement (elle reste réactivable : c'est le retour
  arrière).

## 8. Erreurs qui font refuser le fichier, et avertissements

**Refus** (rien n'est enregistré, le message indique feuille, ligne et
colonne) :

- aucune feuille d'horaires reconnue ; titre MONTEES ou DESCENTES absent ;
- numéro de train manquant, en double, montée paire ou descente impaire ;
- descente sans montée appariée (TRAIN 8 sans TRAIN 7) ;
- gare inconnue ; ligne sans A/D ; heure vide ou illisible ;
- heures qui ne se suivent pas le long de la ligne (arrivée à Motivon avant
  le départ de Saint-Gervais) ; arrivée après le départ dans une même gare ;
- symbole express incohérent avec les heures de Col de Voza et Bellevue
  (dans les deux sens, §5) ;
- dates de validité absentes, ou qui se chevauchent entre deux feuilles.

**Avertissements** (la grille peut être enregistrée après acquittement) :

- durée d'arrêt inhabituelle dans une gare ;
- train présent dans la grille précédente et absent de la nouvelle ;
- descente qui part avant l'arrivée de sa montée (rotation impossible) ;
- indicateur différent de la grille précédente pour le même numéro.
