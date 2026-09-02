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
2. **Ouvrir la Supervision**, se connecter avec un compte supervision ou
   administrateur, onglet **Horaires**, bouton **Charger un fichier Excel…**,
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
