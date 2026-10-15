# Les horaires du Tramway sur le site web

Ce document s'adresse à la personne qui gère le site web du Tramway du
Mont-Blanc. Il n'y a rien à programmer : on colle un bout de code dans une
page du site, et les horaires s'affichent et se mettent à jour tout seuls.

## Le code à coller

Dans le CMS, ajoutez un bloc « HTML personnalisé » (ou « code », « embed »,
selon le CMS) et collez **les deux parties** ci-dessous, telles quelles.

```html
<iframe
  id="tmb-horaires"
  src="https://rdtmb.github.io/tmb-affichage-gares/embed.html"
  title="Horaires du Tramway du Mont-Blanc"
  style="width: 100%; border: 0; height: 900px; display: block"
  loading="lazy"
></iframe>
<script>
  // Ajuste la hauteur du cadre à son contenu (sinon, barre de défilement).
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://rdtmb.github.io') return;
    var d = e.data;
    if (!d || d.type !== 'tmb-embed-hauteur' || typeof d.hauteur !== 'number') return;
    var cadre = document.getElementById('tmb-horaires');
    if (!cadre || e.source !== cadre.contentWindow) return;
    cadre.style.height = Math.max(200, Math.min(d.hauteur, 6000)) + 'px';
  });
</script>
```

- **La première partie** (`<iframe>`) affiche les horaires.
- **La seconde** (`<script>`) ajuste la hauteur du cadre quand on change de
  gare ou qu'on ouvre la journée complète. Si le CMS refuse les scripts, ne
  collez que l'`<iframe>` : tout fonctionne, avec une hauteur fixe de 900 px
  et une barre de défilement dans le cadre.
- Une seule iframe `tmb-horaires` par page. Pour en mettre deux (deux gares
  sur une même page), donnez-leur des `id` différents et dupliquez le script
  en changeant l'`id`.

### Ouvrir directement une gare, ou la journée complète

Ajoutez à l'adresse, après `embed.html` :

| Pour… | Ajouter | Exemple |
| --- | --- | --- |
| ouvrir l'onglet d'une gare | `?gare=` suivi de l'identifiant | `embed.html?gare=saint-gervais` |
| ouvrir la grille complète du jour | `?vue=jour` | `embed.html?vue=jour` |
| les deux | `?gare=…&vue=jour` | `embed.html?gare=bellevue&vue=jour` |

Identifiants des gares : `le-fayet`, `saint-gervais`, `motivon`,
`col-de-voza`, `bellevue`, `nid-daigle`. Une faute de frappe n'affiche pas
d'erreur : la page ouvre simplement le premier onglet.

Avec `?gare=`, la page montre aussi les messages destinés à cette gare ; sans,
seulement ceux qui visent toute la ligne.

### Avant la mise en ligne : essayer sur la préversion

Tant que la page n'est pas en production, elle se regarde sur la
**préversion** (cadre rouge « préversion » autour de la page) :
`https://rdtmb.github.io/tmb-affichage-gares/preview/embed.html`.

Pour la voir **dans une iframe**, comme sur le site, ouvrez d'un double-clic
le fichier `docs/exemple-integration-site.html` : c'est le code ci-dessus,
pointé sur la préversion.

## Ce que la page fait toute seule

- **Un onglet par gare**, dans l'ordre de la ligne, avec les 4 prochains
  départs dans chaque sens : heure, destination, retard, train supprimé
  (barré, avec son motif), « Complet » / « Dernières places », train privé,
  compte à rebours. Ce sont **les mêmes informations que l'écran de la gare**.
- **« Toute la journée / Full day »** : la grille complète du jour, toutes
  gares, montée et descente. Sur téléphone, elle défile de gauche à droite
  dans son cadre.
- **Mise à jour chaque minute**, et aussitôt qu'on revient sur l'onglet du
  navigateur. Rien n'est relu tant que la page n'est pas regardée.
- **Messages** de l'exploitation, en haut de la page.
- **Travaux** : une gare non desservie a son onglet grisé, et le tronçon fermé
  est annoncé en tête.
- **En français et en anglais**, lisible sur téléphone.

## Ce qu'elle ne fait pas

- **Pas de « temps réel » à la seconde** : une modification saisie en
  supervision (retard, suppression) apparaît sur le site **au plus une minute
  plus tard**. Les écrans de gare, eux, la reçoivent immédiatement.
- **Elle n'annonce jamais que le Tramway est fermé.** Quand aucune grille
  horaire n'est saisie pour la date du jour, elle affiche « Horaires pas encore
  disponibles en ligne / Timetable not yet available online », suivi d'un lien
  vers la page d'informations du site lorsque son adresse a été fournie
  (réglage `src/pages/embed-reglages.ts`, à faire compléter). Les annonces de
  saison (dates d'ouverture) se font donc **sur le site lui-même**.
- Si la base de données est injoignable, elle affiche « Horaires en direct
  momentanément indisponibles » et réessaie seule ; jamais d'horaires
  périmés de plus de quelques minutes.
- Pas de réservation ni de vente.

## Ne JAMAIS intégrer `grille.html` ou `ecran.html` à la place

Ces deux pages sont faites pour les écrans des gares : chacune ouvre une
connexion permanente au même serveur que les six écrans, qui n'en accepte
qu'un nombre limité. Un afflux de visiteurs sur le site pourrait alors
empêcher un écran de gare de se reconnecter — `embed.html` est la seule page
prévue pour le site.
