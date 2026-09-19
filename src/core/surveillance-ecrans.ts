// Surveillance des écrans : « ce poste est-il en défaut ? »
//
// POURQUOI CE MODULE EXISTE. Le samedi 19/09/2026, l'écran de Saint-Gervais a
// affiché « Informations momentanément indisponibles » pendant plus de trois
// heures : la clé du Wi-Fi de la gare avait changé, le Raspberry n'a pas pu se
// réassocier. La base SAVAIT — plus aucun `derniere_vue` sur
// `saint-gervais-ecran-1` à partir de 10 h 40 — et rien ne la regardait. C'est
// un agent en gare qui l'a découvert.
//
// La décision vit ICI, PURE, et nulle part ailleurs : la pastille de la
// supervision et le guetteur qui envoie le courriel (Edge Function
// `alerte-ecrans`) répondent à la MÊME question. Deux énonciations d'une même
// règle finissent par diverger, et c'est alors la pastille qui ment ou le
// courriel qui manque.
//
// L'heure est INJECTÉE, comme partout dans `src/core/` : `maintenant_ms` pour
// mesurer un silence (une durée, insensible au fuseau) et `maintenant_s` pour
// la veille de nuit (une heure LOCALE, qui franchit minuit). Ce sont deux
// grandeurs différentes et il ne faut pas les confondre : le navigateur de la
// supervision est à l'heure de Paris, le guetteur tourne sur un serveur en
// UTC, et c'est à l'appelant de faire la conversion là où il sait la faire.
import { enVeille, veilleEffective } from './horaires';
import type { VeilleNuit } from './types';

/**
 * Silence au-delà duquel un poste est EN DÉFAUT : dix minutes.
 *
 * Le signal de vie bat toutes les 60 s (`INTERVALLE_HEARTBEAT_MS`). Dix
 * minutes laissent donc passer neuf battements manqués : une coupure brève,
 * un redémarrage, une reconnexion Wi-Fi. Ce seuil N'EST PAS celui de la
 * pastille « hors ligne » de la supervision (90 s, `SEUIL_HORS_LIGNE_MS`), et
 * il ne doit pas le devenir : l'un signale à un agent présent devant l'écran
 * qu'un poste vient de se taire, l'autre réveille quelqu'un le samedi. Les
 * confondre rendrait l'alerte bavarde, et une alerte bavarde cesse d'être lue.
 */
export const SEUIL_DEFAUT_MS = 10 * 60_000;

/** Ce que la surveillance a besoin de savoir d'un poste. */
export interface PosteSurveille {
  id: string;
  gare: string;
  /** Faux = poste retiré du service (hors-saison, déposé) : jamais d'alerte. */
  surveille?: boolean | null;
  derniere_vue?: string | null;
  veille_debut?: string | null;
  veille_fin?: string | null;
}

/**
 * Pourquoi un poste ne produit PAS d'alerte. Le motif est rendu plutôt que
 * tu : la supervision doit pouvoir dire « surveillé », « en veille » ou
 * « hors service », et non laisser croire que tout va bien parce que rien
 * n'est rouge.
 */
export type MotifRepos =
  /** Poste décoché dans la supervision : hors-saison, déposé, en atelier. */
  | 'hors-service'
  /** Jamais un seul signal de vie : poste déclaré mais pas encore posé. */
  | 'jamais-vu'
  /** Nuit : l'écran est éteint, son silence ne prouve rien. */
  | 'en-veille'
  /** Il bat. */
  | 'vivant';

export interface EtatSurveillance {
  /** Vrai = ce poste doit déclencher une alerte. */
  defaut: boolean;
  /** Motif du repos quand `defaut` est faux ; `vivant` quand il bat. */
  motif: MotifRepos | null;
  /** Silence mesuré, ou `null` si le poste n'a jamais été vu. */
  silence_ms: number | null;
}

/**
 * État de surveillance d'UN poste.
 *
 * L'ordre des tests est le fond de la règle, et il n'est pas commutatif :
 *
 *  1. `surveille = false` d'abord — un poste retiré du service ne se juge pas.
 *     C'est la seule réponse possible pour une gare fermée hors-saison : la
 *     table ne porte aucune autre façon de dire « ce poste n'est pas censé
 *     tourner », et sans elle le Nid d'Aigle alerterait tout l'hiver.
 *  2. jamais vu ensuite — un poste déclaré la veille au soir et posé le
 *     lendemain n'a pas à réveiller quelqu'un la nuit qui sépare les deux.
 *  3. la veille de nuit — voir le commentaire de `estAuRepos` : l'écran est
 *     censé être éteint, son silence n'apprend rien.
 *  4. le silence, en dernier : c'est la seule mesure, et elle ne vaut que
 *     lorsque les trois questions précédentes ont répondu non.
 */
export function etatSurveillance(
  poste: PosteSurveille,
  veilleGlobale: VeilleNuit,
  maintenant_ms: number,
  maintenant_s: number,
): EtatSurveillance {
  if (poste.surveille === false) {
    return { defaut: false, motif: 'hors-service', silence_ms: null };
  }

  const vue_ms = poste.derniere_vue ? new Date(poste.derniere_vue).getTime() : Number.NaN;
  // `Number.isFinite` et non `!poste.derniere_vue` : une date illisible
  // (colonne vide, chaîne tronquée) donne `NaN`, et `NaN - x >= seuil` vaut
  // FAUX. Sans ce garde, un horodatage abîmé ferait passer un poste mort pour
  // vivant — l'erreur qui se tait, exactement celle qu'on répare ici.
  if (!Number.isFinite(vue_ms)) {
    return { defaut: false, motif: 'jamais-vu', silence_ms: null };
  }

  if (estAuRepos(poste, veilleGlobale, maintenant_s)) {
    return { defaut: false, motif: 'en-veille', silence_ms: maintenant_ms - vue_ms };
  }

  const silence_ms = maintenant_ms - vue_ms;
  if (silence_ms >= SEUIL_DEFAUT_MS) return { defaut: true, motif: null, silence_ms };
  return { defaut: false, motif: 'vivant', silence_ms };
}

/**
 * Le poste est-il dans sa veille de nuit à cette heure locale ?
 *
 * LIMITE ASSUMÉE, mesurée le 19/09/2026 : pendant la veille, la page de
 * l'écran CONTINUE de battre — `ecran.ts` ne fait que basculer le rendu sur
 * `body.mode-veille`, l'onglet vit et le signal de vie part toutes les 60 s.
 * Un poste sain n'est donc jamais muet la nuit, et cette exception ne sert
 * qu'aux gares dont l'alimentation est coupée le soir. Sa contrepartie est
 * réelle : une VRAIE panne survenue à 23 h ne sera dite qu'à `veille_fin`.
 * C'est la décision de l'exploitant — « une alerte qui crie chaque nuit cesse
 * d'être lue » — et non un oubli.
 *
 * La fenêtre propre au poste l'emporte sur la globale, aux mêmes conditions
 * que le moteur d'affichage (`veilleEffective` : les DEUX bornes, une seule
 * heure ne décrit pas une fenêtre).
 */
export function estAuRepos(
  poste: Pick<PosteSurveille, 'veille_debut' | 'veille_fin'>,
  veilleGlobale: VeilleNuit,
  maintenant_s: number,
): boolean {
  const { fenetre } = veilleEffective(veilleGlobale, {
    debut: poste.veille_debut,
    fin: poste.veille_fin,
  });
  return enVeille(fenetre.debut, fenetre.fin, maintenant_s);
}

export interface PosteEnDefaut {
  id: string;
  gare: string;
  silence_ms: number;
  /** Dernier signal de vie, tel qu'il est en base : sert de clé d'épisode. */
  derniere_vue: string;
}

export interface BilanSurveillance {
  /** Postes en défaut, du plus ancien silence au plus récent. */
  enDefaut: PosteEnDefaut[];
  /** Postes réellement surveillés à cet instant (ni retirés, ni jamais vus, ni en veille). */
  surveilles: number;
  /**
   * Vrai quand TOUS les postes surveillés se taisent et qu'ils sont au moins
   * deux. La cause est alors en amont — Supabase injoignable, panne de la
   * fibre de la Régie — et six courriels ne disent rien de plus qu'un seul.
   */
  globale: boolean;
}

/**
 * Bilan de la flotte à un instant.
 *
 * Le seuil de deux postes pour parler de panne globale n'est pas décoratif :
 * avec un seul poste surveillé, « tous les postes se taisent » et « ce poste
 * se tait » sont la même phrase, et annoncer une panne globale ferait chercher
 * une cause en amont là où il n'y a qu'un Raspberry débranché.
 */
export function bilanSurveillance(
  postes: readonly PosteSurveille[],
  veilleGlobale: VeilleNuit,
  maintenant_ms: number,
  maintenant_s: number,
): BilanSurveillance {
  const enDefaut: PosteEnDefaut[] = [];
  let surveilles = 0;
  for (const poste of postes) {
    const etat = etatSurveillance(poste, veilleGlobale, maintenant_ms, maintenant_s);
    if (etat.motif === 'hors-service' || etat.motif === 'jamais-vu' || etat.motif === 'en-veille') {
      continue;
    }
    surveilles++;
    if (etat.defaut) {
      enDefaut.push({
        id: poste.id,
        gare: poste.gare,
        silence_ms: etat.silence_ms ?? 0,
        derniere_vue: poste.derniere_vue ?? '',
      });
    }
  }
  enDefaut.sort((a, b) => b.silence_ms - a.silence_ms);
  return {
    enDefaut,
    surveilles,
    globale: surveilles >= 2 && enDefaut.length === surveilles,
  };
}

/**
 * Durée LISIBLE d'un silence : « 45 s », « 12 min », « 3 h 12 », « 5 j ».
 *
 * L'exploitant a tranché le 31/08/2026 : une durée chiffrée se lit, un point
 * rouge clignotant finit par ne plus être vu. La supervision affichait
 * « vu il y a 11 704 s » — vrai, et illisible : personne ne convertit des
 * secondes en heures d'un coup d'œil, et c'est précisément ce coup d'œil
 * qu'on attend d'un agent qui passe devant la supervision.
 *
 * Au-delà d'une heure, les minutes restent affichées sur deux chiffres
 * (« 3 h 05 ») : « 3 h 5 » se lit mal, et l'heure du départ d'un train
 * s'écrit déjà ainsi partout ailleurs dans l'application.
 *
 * LES JOURS AU-DELÀ DE DEUX. Mesuré à l'écran le 19/09/2026 : un poste retiré
 * depuis cinq jours affichait « 120 h 00 », et le Nid d'Aigle hors-saison
 * aurait affiché « 4380 h 00 » — l'exacte illisibilité que cette fonction
 * existe pour supprimer, déplacée d'un cran. Les minutes disparaissent alors,
 * puis les heures : à cette échelle, elles n'apprennent plus rien.
 */
export function silenceLisible(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j`;
}
