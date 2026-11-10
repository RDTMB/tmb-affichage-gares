# Charte graphique 2026 (obligatoire)

Ouvre ce fichier si tu t'apprêtes à toucher une couleur, une police, un logo,
ou à reproduire une maquette.

Voisin : `.claude/regles-affichage.md` (ce que l'écran montre).

## Couleurs, polices, logos

- Couleurs : rouge `#E52A23`, bleu clair `#BDDCF4`, bleu-gris `#708DA4`,
  rouge foncé `#8B1419`, crème `#F1E5D1`, marine `#213B57`.
- Rames (pastilles) : Marie `#2E74B5`, Anne `#7FA51E`, Jeanne `#C2447A`,
  Marguerite blanc cerclé rouge `#E52A23` — modifiables dans Paramètres.
- Typographies : **Amaranth** (titres, noms de gares) + **Lato** (textes,
  heures) — auto-hébergées via @fontsource, JAMAIS de CDN (les écrans
  doivent démarrer sans internet).
- Logo : uniquement les fichiers de `public/logos/`, jamais redessiné,
  jamais déformé (interdits de la charte).
- `logo-long.svg` = logo HORIZONTAL officiel, porté par le bandeau de titre
  de l'écran de gare et de la grille du jour. Son `viewBox` (`119 229 1678
  617`) recadre le dessin : l'export d'origine laissait 46 % de VIDE en
  hauteur, et sans ce recadrage le logo s'afficherait à 71 px au lieu de 132
  — plus petit que le rond qu'il remplace. Ce n'est PAS une erreur à
  « corriger » : le recadrage retire du vide, il ne redimensionne ni ne
  déforme rien. Le fichier a aussi été débarrassé de cinq calques
  Illustrator invisibles (441 Ko de rasters hors du viewBox) ; le rendu est
  identique au pixel, mais leur data URI base64 pesait 427 Ko gzippés dans
  les bundles écran ET grille.
- Les écrans CENTRÉS gardent le logo ROND BLANC (écran neutre, fin de
  service, tronçon fermé, supervision) : il n'existe pas de version
  horizontale blanche exploitable, et une marque circulaire au-dessus d'une
  horloge fonctionne là où un logo horizontal étiré en plein écran non.

## Refonte du 10/11/2026 — les règles de forme

Les quatre surfaces (écran de gare, grille du jour, embed, supervision) ont
été reprises ensemble. Couleurs, polices et logos de la charte n'ont pas
changé ; ce qui suit s'y ajoute et vaut partout.

- **La couleur est une information, jamais un décor.** Rouge = la marque
  (filet du bandeau, pied des écrans) et l'ALERTE (supprimé, complet, départ
  imminent). Ambre = retard, dernières places. Vert = à quai. Crème = départ
  à cinq minutes ou moins. Le reste est marine, crème et blanc.
- **Le numéro de train est en bleu clair `#BDDCF4`, texte marine** (8,05:1) —
  plus en rouge : c'est un repère, pas un état.
- **« À l'heure » se dit sans couleur**, une puce verte devant. C'est le
  retard qui doit se détacher.
- **Le profil de la ligne** (`src/pages/profil-ligne.ts`,
  `src/styles/profil.css`) est le motif du TMB : la pente à l'échelle des
  altitudes, voie piquetée, gare du poste cerclée de rouge, trains à la
  couleur de leur rame. Bandeau de l'écran de gare et de la grille ;
  sélecteur de gare de l'embed. Ne pas en inventer un second.
- **L'altitude est un chiffre accolé au nom** (« Saint-Gervais 786 m »),
  jamais une étiquette « ALTITUDE ».
- **Bas de casse** pour les titres, en-têtes et intitulés. Pas de capitales
  espacées.
- **Une case ne se remplit que pour un état** ; un nombre ordinaire est nu.
  L'ovale est réservé à ce qui se compte ou se bascule.
- **Amaranth pour les noms propres** — gares, rames, titres ; Lato pour le
  reste.

## Ce qui fait foi

- `public/logos/` — logos officiels SVG (logo rond, logo rond blanc, picto
  motrice express blanc et marine)
- `maquettes/` — maquettes HTML **validées par l'exploitant** : REPRODUIRE
  fidèlement leur rendu (elles font foi pour le visuel)

Depuis la refonte du 10/11/2026, les trois maquettes sont des PHOTOGRAPHIES
du rendu réel (DOM de la page en démonstration + feuilles de style, en un
seul fichier), régénérées par `outils/regenerer-maquettes.cjs` — plus des
pages écrites à la main, qui divergeaient du code à chaque lot. Un lot qui
change le visuel les régénère et les fait valider ; il ne les retouche pas à
la main. Captures avant / après de la refonte :
`docs/captures/2026-11-10-refonte/`.
