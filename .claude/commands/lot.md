---
description: Sort le squelette d'un prompt de lot, à remplir
argument-hint: [sujet du lot, en une phrase]
---

Produis le SQUELETTE d'un prompt de lot pour ce dépôt, en Markdown, prêt à
être complété par Thomas. Sujet du lot : $ARGUMENTS

Tu écris un GABARIT, pas le lot lui-même : tu ne codes rien, tu n'ouvres pas
le chantier. Quand tu connais déjà un élément (une mesure, un fichier, un
nom), écris-le ; quand tu ne le connais pas, laisse un `<crochet>` explicite
plutôt qu'une phrase creuse — un gabarit rempli au hasard se relit moins bien
qu'un gabarit visiblement vide.

Un lot mesure ce qu'il affirme. Avant d'écrire le constat, va CHERCHER les
chiffres dans le dépôt (lignes, octets ÷ 4 pour les tokens, nombre
d'occurrences, taille de bundle) plutôt que de les estimer, et dis
explicitement ce que tu n'as pas mesuré.

Rends le gabarit dans un bloc de code Markdown, avec ces sections, dans cet
ordre :

## `# <Titre du lot>`

Une phrase qui dit ce qui CHANGE, pas le domaine touché.

## `## Réglages conseillés`

Trois lignes — **modèle**, **effort**, **multi-agents** — et chacune porte une
justification RATTACHÉE À UN POINT PRÉCIS de ce prompt-ci, jamais une
justification générique. « Effort élevé parce que c'est important » ne vaut
rien ; « effort élevé parce que le point 1 commence par décider où passe la
frontière, et cette décision commande tout le reste » se vérifie. Pour
multi-agents, dis ce qui serait parallélisable et ce qui ne l'est pas, et
pourquoi — deux agents sur un même découpage se marchent dessus.

## `## Le constat, mesuré`

Ce qui ne va pas AUJOURD'HUI, avec les chiffres, et la ligne de séparation :
ce qui est mesuré / ce qui est supposé. Termine par la raison profonde en une
phrase — pas le symptôme.

## `## Le travail`

Numéroté, un point par décision. Chaque point dit ce qu'il faut obtenir, et
laisse la mise en œuvre ouverte quand elle l'est. Quand une proposition est
donnée (un découpage, une liste de fichiers), dire explicitement qu'elle est
une PROPOSITION et non une vérité, et demander que l'écart soit justifié dans
la PR.

## `## Contrôles`

Ce qui doit être vu vert, et surtout ce qui doit être vu ROUGE avant d'être
vu vert : un test de non-régression qui n'a jamais échoué ne se distingue pas
d'un test qui ne teste rien. Rappelle les quatre contrôles (`/verif`) et la
« definition of done » de `CLAUDE.md`.

## `## Pull request`

Un **titre** (une ligne, ce que le lot change du point de vue de qui l'utilise)
et une **description** complète en bloc Markdown : le constat, ce qui a été
fait, le risque et ce qui le couvre, ce qui reste ouvert. La description est
écrite d'avance : si elle ne s'écrit pas, le lot n'est pas clair.

## `## Reste ouvert`

Ce que ce lot ne fait pas, ce qu'il prépare, et ce qui demandera une décision
de Thomas (réglages GitHub, SQL en production, recette en gare).

---

Rappels de ce dépôt à refléter dans le gabarit quand ils s'appliquent :

- branche `chantier-…`, jamais de travail sur `main` ; PR ouverte après les
  tests de Thomas ;
- SQL éprouvé sur le projet Supabase de TEST avant la production ;
- `npm run build` type-vérifie, `npm test` non ;
- ce qui se vérifie en gare (écrans, `?simule=`, réseau coupé) se dit dans les
  contrôles, pas dans la PR seulement.
