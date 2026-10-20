# Les horaires du Tramway sur le site web

Ce document s'adresse à la personne qui gère le site web du Tramway du
Mont-Blanc. Il n'y a rien à programmer : on colle un bout de code dans une
page du site, et les horaires s'affichent et se mettent à jour tout seuls.

## Le code à coller

Le site du Tramway est un **WordPress** (réalisé par l'agence Novius). Dans
l'éditeur de la page, ajoutez un bloc **« HTML personnalisé »** et collez
le code ci-dessous, tel quel. C'est la version transmise le 20/10/2026 :
**deux cadres** (les prochains départs, puis la journée complète) et **un
seul script** pour la page.

Si, à l'enregistrement, le bloc retire l'`<iframe>` (ou le `<script>`), ce
n'est pas une erreur de collage : votre compte n'a pas le droit d'insérer ce
type de code. C'est un droit à demander à l'administrateur du site WordPress
(ou à l'agence Novius) — il n'y a rien à changer au code.

```html
<iframe
  class="tmb-horaires"
  src="https://rdtmb.github.io/tmb-affichage-gares/embed.html"
  title="Horaires du Tramway du Mont-Blanc — prochains départs"
  style="width: 100%; border: 0; height: 900px; display: block"
  loading="lazy"
></iframe>
<iframe
  class="tmb-horaires"
  src="https://rdtmb.github.io/tmb-affichage-gares/embed.html?vue=jour"
  title="Horaires du Tramway du Mont-Blanc — toute la journée"
  style="width: 100%; border: 0; height: 900px; display: block"
  loading="lazy"
></iframe>
<script>
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://rdtmb.github.io') return;
    var d = e.data;
    if (!d || d.type !== 'tmb-embed-hauteur' || typeof d.hauteur !== 'number') return;
    var cadres = document.querySelectorAll('iframe.tmb-horaires');
    for (var i = 0; i < cadres.length; i++) {
      if (cadres[i].contentWindow === e.source) {
        cadres[i].style.height = Math.max(200, Math.min(d.hauteur, 6000)) + 'px';
      }
    }
  });
</script>
```

- **Les `<iframe>`** affichent les horaires. Chacune porte la classe
  `tmb-horaires` : c'est ce qui la fait reconnaître par le script.
- **Le `<script>`** ajuste la hauteur de CHAQUE cadre `tmb-horaires` de la
  page quand on change de gare, qu'on ouvre la journée complète ou qu'on
  touche un onglet grisé (la raison s'affiche dessous). Si le CMS refuse les
  scripts, ne collez que les `<iframe>` : tout fonctionne, avec une hauteur
  fixe de 900 px et une barre de défilement dans le cadre.
- **Un seul script par page**, quel que soit le nombre de cadres : pour en
  ajouter un, copiez une `<iframe>` en gardant `class="tmb-horaires"`. Ne
  dupliquez pas le script — chaque copie ferait le même travail une fois de
  plus.

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
- **En hiver**, l'onglet Nid d'Aigle est grisé : « Le Nid d'Aigle n'est pas
  ouvert pendant la période hivernale ! ». La raison d'un onglet grisé
  s'affiche au survol de la souris et, sur téléphone, au toucher, dans une
  ligne sous les onglets qui disparaît au bout de 5 secondes.
- **En français et en anglais**, lisible sur téléphone.

## Ce qu'elle ne fait pas

- **Pas de « temps réel » à la seconde** : une modification saisie en
  supervision (retard, suppression) apparaît sur le site **au plus une minute
  plus tard**. Les écrans de gare, eux, la reçoivent immédiatement.
- **Elle n'invente pas de fermeture.** Elle ne dit « fermé » que pendant une
  intersaison que l'exploitation a déclarée (voir plus bas).
- **Pas de messages de l'exploitation quand il n'y a pas d'horaires** : un
  message d'été oublié resterait sinon affiché tout l'hiver.
- Jamais d'horaires périmés de plus de quelques minutes.
- Pas de réservation ni de vente.

## Les quatre messages possibles

| Quand | La page affiche |
| --- | --- |
| Des horaires existent pour aujourd'hui | Les horaires (onglets par gare, journée complète). |
| Pas d'horaires aujourd'hui, et on est **entre deux périodes d'ouverture** déclarées | « Le Tramway du Mont-Blanc est fermé pour l'intersaison. Réouverture le samedi 12 décembre 2026. » (et en anglais), suivi du lien « Plus d'informations ». |
| Pas d'horaires aujourd'hui, **pendant** une période d'ouverture, **avant** la première ou **après** la dernière, ou aucune période déclarée | « Horaires pas encore disponibles en ligne / Timetable not yet available online », suivi du même lien. La page ne dit rien qu'on ne lui a pas dit. |
| La base de données ne répond pas | « Horaires en direct momentanément indisponibles », et la page réessaie toute seule. |

Le lien « Plus d'informations » mène à la page « Horaires et Tarifs » du site
(`https://www.tramwaydumontblanc.fr/horaires-tarifs/`) : c'est là que se font
les annonces de saison.

L'heure affichée est celle du serveur, pas celle de l'ordinateur ou du
téléphone du visiteur : une horloge mal réglée ne change rien à ce qu'il voit.

## Où changer les périodes d'ouverture

**Rien à faire côté site.** Les dates d'ouverture (été, hiver) se règlent dans
la **Supervision**, onglet **Paramètres**, carte « Grille en service et durées
d'affichage », bloc **« Périodes d'ouverture (site web) »**, avec un compte
**admin**. Une phrase sous la liste dit ce que le site affiche aujourd'hui avec
ces dates ; le site suit dans la minute.

## Ne JAMAIS intégrer `grille.html` ou `ecran.html` à la place

Ces deux pages sont faites pour les écrans des gares : chacune ouvre une
connexion permanente au même serveur que les six écrans, qui n'en accepte
qu'un nombre limité. Un afflux de visiteurs sur le site pourrait alors
empêcher un écran de gare de se reconnecter — `embed.html` est la seule page
prévue pour le site.
