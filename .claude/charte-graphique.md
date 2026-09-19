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

## Ce qui fait foi

- `public/logos/` — logos officiels SVG (logo rond, logo rond blanc, picto
  motrice express blanc et marine)
- `maquettes/` — maquettes HTML **validées par l'exploitant** : REPRODUIRE
  fidèlement leur rendu (elles font foi pour le visuel)
