# Projet Supabase — informations de connexion

Projet créé le 24/08/2026 (organisation RDTMB, région West EU — Paris).

- **URL du projet** : `https://csstkdcqdzaiibfqrscv.supabase.co`
- **Clé publishable** (publique par conception, sécurité assurée par les
  règles RLS côté serveur) :
  `sb_publishable_ruNurY9ZYC4TzBgIR-tHpA_vrZwpCxm`

## Utilisation

- Développement local : fichier `.env.local` (non versionné, voir
  `.gitignore`) :

  ```
  VITE_SUPABASE_URL=https://csstkdcqdzaiibfqrscv.supabase.co
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ruNurY9ZYC4TzBgIR-tHpA_vrZwpCxm
  ```

- Déploiement GitHub Pages (étape 9) : ces deux valeurs vont dans
  Settings → Secrets and variables → Actions → **Variables** du dépôt,
  sous les mêmes noms.

## Règles

- La clé « publishable » peut être publiée sans risque (elle remplace
  l'ancienne clé « anon » de Supabase).
- La clé **secret** (`sb_secret_…`) et le **mot de passe base de données**
  ne doivent JAMAIS apparaître dans le dépôt, une conversation ou un écran.
- État au 24/08/2026 : API REST et Auth vérifiées joignables ; le schéma
  (`supabase/schema.sql`) sera créé à l'étape 5 du plan de développement
  puis exécuté dans l'éditeur SQL du tableau de bord Supabase.
