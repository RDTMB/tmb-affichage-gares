# TMB — Affichage voyageurs en gare

Écrans d'information voyageurs du **Tramway du Mont-Blanc** (Régie
Départementale, Haute-Savoie) : 6 gares du Fayet (580 m) au Nid d'Aigle
(2 412 m) + poste de supervision.

## Pages

| Page                    | Usage                                       |
| ----------------------- | ------------------------------------------- |
| `index.html`            | Portail de test (liens vers les 6 gares)    |
| `ecran.html?gare=<id>`  | Écran de gare : arrivées/départs + médias   |
| `grille.html?gare=<id>` | Grille complète du jour (montée / descente) |
| `supervision.html`      | Pilotage (connexion obligatoire, rôles)     |

Paramètres utiles : `?simule=HH:MM` (heure simulée), `&terminus=N` (démo
bascule Terminus Bellevue), `&zoom=`, `&cache=N` (tests du mode dégradé).

## Documentation

- [Spécification fonctionnelle](docs/01-spec-fonctionnelle.md) — règles métier (fait foi)
- [Spécification technique](docs/02-spec-technique.md) — architecture, schéma, sécurité
- [Plan de développement](docs/03-plan-de-developpement.md) — étapes et acceptation
- [Mise en service](docs/mise-en-service.md) — GitHub Pages + Supabase pas à pas
- [Kiosque Raspberry Pi](docs/kiosque.md) — installation des écrans en gare
- [Tests manuels](docs/tests-manuels.md) — résilience et modes dégradés
- [Charger une grille horaire](docs/import-grilles.md) — import depuis l'Excel exploitation
- [Format du fichier Excel](docs/format-excel-horaires.md) — contrat lu par l'import

## Développement

```bash
npm install
npm run dev      # http://localhost:5173 (mode mock : aucune dépendance externe)
npm test         # moteur horaires (Vitest)
npm run build    # tsc strict + bundle
```

Sans `public/config.js`, l'application tourne en **mode mock** complet
(supervision comprise, état partagé entre onglets). Le déploiement génère
`config.js` depuis les variables de dépôt — **aucun secret dans le code**
(la clé Supabase « publishable » est publique par conception, la sécurité
repose sur RLS).

Horaires officiels : en base (table `grilles`), chargés depuis l'Excel
exploitation dans la Supervision → onglet Horaires
([guide](docs/import-grilles.md), [format du fichier](docs/format-excel-horaires.md)).
`docs/grilles-historique/` garde les grilles été 2026 de référence — ne
jamais modifier à la main.
Maquettes validées par l'exploitant : `maquettes/` — elles font foi pour le
rendu.
