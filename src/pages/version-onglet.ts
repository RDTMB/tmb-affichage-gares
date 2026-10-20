// Onglet « Version » de la Supervision (groupe administration) : la version
// en ligne, puis les nouveautés (nouveautes/, docs/nouveautes.md). Rendu PUR,
// testable sans DOM ; supervision.ts ne fait que poser le HTML.
import type { BaseServie } from '../data/config';
import { dateNouveaute, grouperParDate, type Nouveaute } from '../core/nouveautes';
import {
  dateMiseEnLigne,
  libelleVersion,
  lienCommit,
  lienPr,
  type VersionApp,
} from '../core/version';
import { echapper } from './affichage-commun';

function lien(url: string, texte: string): string {
  return `<a href="${echapper(url)}" target="_blank" rel="noopener noreferrer">${echapper(texte)}</a>`;
}

/** Haut de l'onglet : ce qui tourne, depuis quand, et sur quelle base. */
export function detailVersionHtml(v: VersionApp, base: BaseServie): string {
  const commit = lienCommit(v);
  const pr = lienPr(v);
  const quand = dateMiseEnLigne(v);
  const ligne = (titre: string, valeur: string): string =>
    `<dt>${echapper(titre)}</dt><dd>${valeur}</dd>`;
  const lignes = [
    ligne('Version', `<b>${echapper(libelleVersion(v))}</b>`),
    ligne(
      v.branche === 'main' ? 'Mise en ligne' : 'Date du commit',
      quand ? `${echapper(quand)} <span class="sous">(heure de Paris)</span>` : '—',
    ),
    ligne('Commit', commit && v.sha ? lien(commit, v.sha) : '—'),
    ligne('Pull request', pr && v.pr ? lien(pr, `#${v.pr}`) : '—'),
    ligne(
      'Base servie',
      `<span class="pill base ${echapper(base.classe)}" title="${echapper(base.detail)}">${echapper(
        base.libelle,
      )}</span>`,
    ),
  ];
  const note =
    v.branche === 'local'
      ? '<p class="note">Version locale : ce code n’a pas été construit par le déploiement, il n’a ni date ni numéro.</p>'
      : '';
  return `<dl class="detail-version">${lignes.join('')}</dl>${note}`;
}

/**
 * Nouveautés, de la plus récente à la plus ancienne, groupées par date. Les
 * entrées `pour: admin` (invisibles à l'usage) sont en gris, marquées
 * « technique ».
 */
export function nouveautesHtml(nouveautes: readonly Nouveaute[]): string {
  if (nouveautes.length === 0) return '<p class="note">Aucune nouveauté enregistrée.</p>';
  return grouperParDate(nouveautes)
    .map(({ date, entrees }) => {
      const puces = entrees
        .flatMap((n) =>
          n.puces.map((p) =>
            n.pour === 'admin'
              ? `<li class="nouveaute-admin"><span class="mention-technique">technique</span> ${echapper(p)}</li>`
              : `<li>${echapper(p)}</li>`,
          ),
        )
        .join('');
      return `<section class="nouveautes-jour"><h3>${echapper(dateNouveaute(date))}</h3><ul>${puces}</ul></section>`;
    })
    .join('');
}
