// Réglages de la page d'horaires du site web (embed.html), fixés AU BUILD.
//
// Un module à part, et non une variable de dépôt : les variables du
// déploiement sont verrouillées par moitié de site (production / préversion,
// `src/data/deploiement.test.ts`), et cette URL n'a rien de secret ni de
// propre à une base. Une variable d'environnement `VITE_EMBED_URL_INFOS`
// passée au build l'emporte sur la valeur écrite ici.

/**
 * Page d'informations du site du Tramway, vers laquelle l'embed renvoie quand
 * il n'a pas d'horaires à montrer (aucune grille saisie pour la date, ou base
 * injoignable).
 *
 * URL fournie par l'exploitant le 16/10/2026 : page « Horaires et Tarifs » du
 * site, vérifiée ce jour-là (elle répond, et annonçait déjà la fermeture
 * automnale). JAMAIS inventée : vide, l'embed n'affiche aucun lien.
 * `https://` uniquement (toute autre forme est ignorée, voir `urlInfosValide`).
 */
export const URL_INFOS_SITE = 'https://www.tramwaydumontblanc.fr/horaires-tarifs/';
