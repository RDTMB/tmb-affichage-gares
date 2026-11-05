// Tableaux montée / descente de la grille du jour — construction PURE.
//
// Extraite de `grille.ts` le 15/10/2026, À L'IDENTIQUE, pour que la page du
// site web (`embed.ts`) affiche la grille du jour par le MÊME code que
// `grille.html`. Recopier ce gabarit dans l'embed aurait créé une seconde
// source des règles d'affichage (tri des colonnes, train barré, retard,
// mentions « Privé » / remplissage, gares hors section, colonne éclairée) :
// deux pages publiques qui diraient deux choses du même train est le défaut
// que tout ce dépôt s'emploie à éviter.
//
// Aucun DOM, aucune donnée lue ici : la page passe ce qu'elle a chargé, ce
// module rend une chaîne. C'est ce qui le rend appelable par deux pages, et
// testable.
import {
  bornesAffichees,
  formatHeure,
  gareHorsSection,
  gareNonDesservie,
  libelleTrain,
  trainsDuJour,
} from '../core/horaires';
import type {
  Affluence,
  GareId,
  Grille,
  Jour,
  Machine,
  NiveauAffluence,
  PositionTrain,
  Sens,
  TrainJour,
} from '../core/types';
import { GARE_DEBUT_DEFAUT, GARE_FIN_DEFAUT } from '../core/types';
import { echapper, LIBELLE_MENTION, mentionCourse, styleRame } from './affichage-commun';
import { ancrePosition, indexProchainDepart } from './grille-logique';

/** Rame absente des paramètres : le bleu-gris de la charte, comme sur l'écran de gare. */
export const RAME_INCONNUE: Machine = { nom: '?', couleur: '#708DA4', en_service: true };

/** Ce que la page a chargé, et dont le tableau a besoin. */
export interface ContexteGrille {
  grille: Grille;
  jour: Jour;
  /**
   * Gare de l'écran (`?gare=`), ou `null` hors d'une gare : décide la colonne
   * éclairée (voir `indexProchainDepart`).
   */
  gare: GareId | null;
  /** Rames paramétrées (couleur, anneau). */
  machines: readonly Machine[];
  /** Remplissage déclaré du jour. */
  affluence: readonly Affluence[];
  /**
   * `true` : AUCUNE colonne n'est éclairée (ni `th.next` ni `td.next`), même
   * sans `?gare=`. Posé par l'embed du site web seulement — « le prochain
   * départ » y est la vue des départs d'une gare, la grille complète n'en
   * désigne pas. `grille.html` ne le pose pas et garde son éclairage.
   */
  sansProchain?: boolean;
}

export interface ColonneTrain {
  train: TrainJour;
  decalage: number;
  departTheorique_s: number;
  departReel_s: number;
  supprime: boolean;
  retard: boolean;
  passe: boolean;
}

export function colonnesDuSens(
  ctx: Pick<ContexteGrille, 'grille' | 'jour'>,
  sens: Sens,
  maintenant_s: number,
): ColonneTrain[] {
  const { grille, jour } = ctx;
  return (
    trainsDuJour(grille, jour)
      .filter((t) => t.sens === sens)
      // TRIÉ PAR L'HEURE, et il ne l'était pas. `trainsDuJour()` rend les trains
      // de grille puis les HORS GRILLE, dans cet ordre : un train spécial de
      // 10 h 30 arrivait donc en dernière colonne, après le train du soir. Même
      // défaut que l'onglet Circulations, relevé en le vérifiant le 11/09/2026.
      // Les colonnes se lisent de gauche à droite comme une journée : l'ordre
      // EST l'information.
      .sort((a, b) => {
        const ha = a.passages[0]?.depart_s ?? a.passages[0]?.arrivee_s ?? Number.POSITIVE_INFINITY;
        const hb = b.passages[0]?.depart_s ?? b.passages[0]?.arrivee_s ?? Number.POSITIVE_INFINITY;
        return ha === hb ? a.numero - b.numero : ha - hb;
      })
      .map((train) => {
        const decalage = train.statut === 'retard' ? train.retard_min * 60 : 0;
        const premier = train.passages[0];
        const dernier = train.passages[train.passages.length - 1];
        const departTheorique = premier?.depart_s ?? premier?.arrivee_s ?? 0;
        const finReelle = (dernier?.arrivee_s ?? dernier?.depart_s ?? 0) + decalage;
        return {
          train,
          decalage,
          departTheorique_s: departTheorique,
          departReel_s: departTheorique + decalage,
          supprime: train.statut === 'supprime',
          retard: train.statut === 'retard',
          passe: finReelle < maintenant_s, // colonne atténuée : train arrivé à son terminus
        };
      })
  );
}

/**
 * Titres des deux tableaux, en HTML ÉCHAPPÉ : le trajet en grand, « Le Fayet →
 * Bellevue », et à côté en plus petit le sens, « Montée / Ascent » (descente :
 * « Bellevue → Le Fayet » puis « Descente / Descent »). UNE SEULE source pour
 * `grille.html` et l'embed : les deux posent cette chaîne dans leur `<h2>`.
 *
 * Les bornes sont celles de `bornesAffichees` : la section du jour, coupée au
 * sommet de la grille — en hiver, le Nid d'Aigle n'est le terminus de rien.
 * Sans journée, la ligne complète, comme avant.
 */
export function titresDesSens(
  grille: Grille,
  jour: Jour | null,
  nomGare: (id: GareId) => string,
): Record<Sens, string> {
  const { debut, fin } = jour
    ? bornesAffichees(grille, jour)
    : { debut: GARE_DEBUT_DEFAUT, fin: GARE_FIN_DEFAUT };
  const titre = (de: GareId, a: GareId, sens: string): string =>
    `<span class="trajet">${echapper(nomGare(de))} → ${echapper(nomGare(a))}</span> <span class="en sens-mot">${echapper(sens)}</span>`;
  return {
    montee: titre(debut, fin, 'Montée / Ascent'),
    descente: titre(fin, debut, 'Descente / Descent'),
  };
}

/**
 * La FLÈCHE d'un train EN ROUTE : une pointe qui regarde toujours vers le bas,
 * parce que les lignes des deux tableaux se lisent de haut en bas et que la gare
 * suivante du train est la ligne du dessous, en montée comme en descente
 * (jamais retournée). Entre deux gares elle est SEULE : le rond n'est que pour
 * le train à quai (décision de l'exploitant du 05/11/2026).
 *
 * Un élément à part et non un pseudo-élément : sur `grille.html` le rond pulse
 * (opacité animée), et un enfant en hériterait. La couleur passe par `--rame` —
 * le MÊME fond que `styleRame` pose sur le rond, lu depuis sa chaîne plutôt que
 * recalculé : une seule décision de couleur. Le CSS (`embed.css`, `grille.css`)
 * donne la voie et la hauteur, partagées avec le rond (`--voie-rond`, `--saut`).
 *
 * `cle` : l'identité du train (`montee-12`), posée en `data-train` pour que
 * `grille-transition.ts` retrouve le MÊME train d'un rendu à l'autre.
 */
export function fleche(styleDuRond: string, saut: number, cle?: string): string {
  const style = styleDuRond.replace(/^background:/, '--rame:');
  const identite = cle ? ` data-train="${cle}"` : '';
  return `<svg class="train-fleche" viewBox="0 0 10 14" style="${style}--saut:${saut};"${identite} aria-hidden="true"><path d="M0 0H10L5 14Z"/></svg>`;
}

function classesColonne(colonne: ColonneTrain, estProchain: boolean): string {
  return [
    colonne.supprime ? 'supp' : '',
    colonne.retard ? 'retard' : '',
    colonne.passe ? 'passe' : '',
    estProchain ? 'next' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Le tableau d'un sens, `<thead>` et `<tbody>` compris — le contenu d'une
 * `<table>`, que chaque page pose dans son propre conteneur.
 */
export function tableHtml(
  ctx: ContexteGrille,
  sens: Sens,
  maintenant_s: number,
  positions: ReadonlyMap<number, PositionTrain>,
): string {
  const { grille, jour, gare } = ctx;

  function machineDe(nomRame: string): Machine {
    return ctx.machines.find((m) => m.nom === nomRame) ?? { ...RAME_INCONNUE, nom: nomRame };
  }

  /**
   * Remplissage déclaré d'un train, ou `null`. Même jointure que sur l'écran de
   * gare : la clé est le NUMÉRO, jamais la gare — un TRAIN 9 complet l'est dans
   * toutes celles qu'il doit encore desservir. Un niveau inconnu (base plus
   * récente que ce déploiement) est ignoré plutôt que recopié.
   */
  function affluenceDe(numero: number): NiveauAffluence | null {
    const a = ctx.affluence.find((x) => x.numero === numero);
    return a && (a.niveau === 'complet' || a.niveau === 'limite') ? a.niveau : null;
  }

  const colonnes = colonnesDuSens(ctx, sens, maintenant_s);
  // Les gares HORS section n'ont rien à montrer : trois lignes de « — »
  // seraient du bruit, et laisseraient croire à un service interrompu plutôt
  // qu'à un tronçon fermé (celui-ci est annoncé par le bandeau).
  // Une gare qu'aucune montée de la GRILLE n'atteint (Nid d'Aigle en hiver)
  // n'a pas de ligne non plus : la saison ne la dessert pas, il n'y a rien à
  // annoncer.
  const dansLaSection = grille.gares.filter(
    (g) => !gareHorsSection(jour, g.id) && !gareNonDesservie(grille, jour.date, g.id),
  );
  const gares = sens === 'montee' ? dansLaSection : [...dansLaSection].reverse();
  // Colonne éclairée : le prochain départ DE LA GARE DE L'ÉCRAN (`?gare=`), et
  // non plus de l'origine de la ligne — décision de l'exploitant du
  // 13/09/2026. La règle, ses deux cas limites et leur raison vivent dans
  // `grille-logique.ts`, PUR et testé : elle se décide, elle ne se dessine pas.
  const prochainIdx = ctx.sansProchain ? -1 : indexProchainDepart(colonnes, gare, maintenant_s);
  // OÙ POSER LE ROND de chaque train en ligne, sur les lignes AFFICHÉES de ce
  // sens (`gares`, déjà inversé en descente) : sur la ligne d'une gare quand le
  // train y est à quai, à mi-chemin de deux lignes quand il roule. La règle vit
  // dans `ancrePosition` (PURE, testée) ; ici on ne fait que la lire.
  const lignes = gares.map((g) => g.id);
  const ancres = colonnes.map((c) => {
    const position = positions.get(c.train.numero);
    return position ? ancrePosition(lignes, position) : null;
  });

  let html = '<thead><tr><th class="col-gare">GARE / STATION</th>';
  colonnes.forEach((c, i) => {
    // L'EN-TÊTE ANNONCE UN TRAIN, PLUS UNE HEURE (décision de l'exploitant du
    // 13/09/2026). L'heure d'ORIGINE est retirée PARTOUT, `?gare=` ou non :
    // elle ne faisait que répéter la première ligne du tableau, juste en
    // dessous, et mentait à toutes les autres — sur l'écran de Saint-Gervais,
    // la colonne mise en avant portait « TRAIN 14 · 13:13 » pour un train qui
    // part d'ici à 14:13. L'heure de chaque gare est dans la cellule de sa
    // ligne, qui est le seul endroit où elle est vraie.
    //
    // La ligne ainsi libérée PAIE les deux mentions ajoutées : « Privé » et le
    // remplissage tiennent dans la ligne `.picto` existante, en ligne et non
    // en bloc, si bien que l'en-tête compte un rang de MOINS qu'avant.
    html += `<th class="${classesColonne(c, i === prochainIdx)}"><span class="num">${echapper(
      libelleTrain(
        c.train,
        colonnes.map((x) => x.train),
      ),
    )}</span>`;
    const pictos: string[] = [];
    if (c.train.express) {
      pictos.push(`<img class="motrice" src="${__MOTRICE_BLANC__}" alt="Express"> EXPRESS`);
    }
    if (c.train.velos) pictos.push('<span class="velo">🚲 vélos</span>');
    if (c.retard) {
      pictos.push(
        `<span class="badge" style="color:var(--retard)">+${c.train.retard_min} min</span>`,
      );
    }
    if (c.supprime)
      pictos.push('<span class="badge" style="color:var(--supprime)">SUPPRIMÉ</span>');
    // La RÈGLE et les MOTS viennent de `mentionCourse` / `LIBELLE_MENTION` :
    // l'écran de gare affiche exactement les mêmes, et deux écrans qui
    // diraient deux choses du même train est le défaut à éviter.
    const mention = mentionCourse({
      supprime: c.supprime,
      acces: c.train.acces,
      affluence: affluenceDe(c.train.numero),
    });
    if (mention) {
      pictos.push(
        `<span class="mention ${mention}">${echapper(LIBELLE_MENTION[mention].fr)}<small>${echapper(
          LIBELLE_MENTION[mention].en,
        )}</small></span>`,
      );
    }
    if (pictos.length > 0) html += `<span class="picto">${pictos.join(' ')}</span>`;
    html += '</th>';
  });
  html += '</tr></thead><tbody>';

  gares.forEach((g, rang) => {
    html += `<tr><th>${echapper(g.nom)}<small>${g.altitude_m.toLocaleString('fr-FR')} m</small></th>`;
    colonnes.forEach((c, i) => {
      const cls = classesColonne(c, i === prochainIdx);
      const passage = c.train.passages.find((p) => p.gare === g.id);
      // Le rond est porté par la cellule de SA ligne, même « sautée » : une gare
      // que le train ne dessert pas peut être la plus proche de sa position.
      const ancre = ancres[i];
      let point = '';
      if (ancre && ancre.ligne === rang) {
        const style = styleRame(machineDe(c.train.rame));
        const cle = `${sens}-${c.train.numero}`;
        // DEUX ÉTATS, JAMAIS ENSEMBLE : à quai le rond seul, en route la flèche
        // seule. Le passage de l'un à l'autre est joué par `grille-transition.ts`.
        point =
          ancre.saut > 0
            ? fleche(style, ancre.saut, cle)
            : `<span class="train-pos" style="${style}" data-train="${cle}"></span>`;
      }
      if (!passage) {
        // « | » : passage express sans arrêt — « — » : gare non desservie (terminus Bellevue)
        html += `<td class="saute${cls ? ` ${cls}` : ''}">${c.train.express ? '|' : '—'}${point}</td>`;
        return;
      }
      const heureCellule = (passage.depart_s ?? passage.arrivee_s ?? 0) + c.decalage;
      html += `<td class="${cls}">${formatHeure(heureCellule)}${point}</td>`;
    });
    html += '</tr>';
  });
  return `${html}</tbody>`;
}
