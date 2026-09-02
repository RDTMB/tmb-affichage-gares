# Grilles horaires — référence historique

Les grilles horaires vivent désormais **en base** (table `grilles`), chargées
depuis l'Excel d'exploitation dans la Supervision, onglet Horaires (voir
`docs/import-grilles.md` et `docs/format-excel-horaires.md`). Une seule source
de vérité : la base.

Les fichiers de ce dossier sont la **référence historique** des grilles
été 2026 telles qu'elles ont été générées le 25/08/2026 depuis le document
d'exploitation du 05/06/2026 :

- `2026-ete-grand-service.json` — 04/07 → 30/08/2026, 13 montées + 13 descentes ;
- `2026-ete-petit-service.json` — 13/06 → 03/07 et 31/08 → 27/09/2026, 8 + 8.

Ils servent encore à trois choses, et à rien d'autre :

1. **oracle des tests** (`src/core/*.test.ts`) : l'import de l'Excel doit les
   reproduire à l'identique ;
2. **grilles de démonstration** du fournisseur mock (`src/data/mock.ts`,
   `npm run dev` sans `public/config.js`, `?demo=1`), chargées à la demande ;
3. **insertion initiale** en base par `supabase/ajout-grilles.sql` (généré
   depuis ces fichiers, `on conflict do nothing`).

Ne pas les modifier à la main : une nouvelle grille passe par l'import.
