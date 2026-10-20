# Nouveautés — une entrée par PR

L'onglet **Version** de la Supervision (groupe administration) liste ce qui a
changé, mise en ligne après mise en ligne. Cette liste est rédigée à la main.

1. **Un fichier par PR** dans `nouveautes/`, nommé `AAAA-MM-JJ-sujet-court.md`
   (minuscules, chiffres, tirets). Un fichier par PR et non un journal commun :
   plusieurs branches avancent en parallèle, un fichier unique serait en
   conflit à chaque fusion.
2. **Format** :

   ```
   ---
   date: 2026-10-20
   pour: tous
   ---

   - La Supervision affiche son numéro de version en haut de page.
   ```

   `date` = celle du nom de fichier (le jour où la PR est écrite ; pour la
   reprise de l'historique, la date de fusion sur `main`).
3. **Une à trois puces**, écrites **pour la caisse et l'exploitation** : ce qui
   change pour eux, en français clair. Ni nom de fichier, ni jargon.
4. **`pour: tous`** pour ce qui se voit à l'usage. **`pour: admin`** est réservé
   aux changements invisibles (refactorisation, CI, doc) : ils s'affichent en
   gris, marqués « technique ».
5. **Contrôles.** Le build valide chaque fichier (`src/core/nouveautes.ts`) : un
   en-tête manquant, une date invalide ou un `pour` inconnu font échouer le
   build en nommant le fichier. En PR, le job `build` refuse une PR qui touche
   `src/`, `public/` ou une page `*.html` racine sans **ajouter** de fichier ici.
   Une PR `dev → main` passe sans rien ajouter : ses entrées sont déjà dans son
   diff.
