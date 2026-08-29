// Cycle d'affichage des médias sur les écrans de gare — PUR et testé.
//
// L'heure est TOUJOURS injectée (`nowMs`) : jamais de `Date.now()` ici, comme
// partout dans src/core/. La page ne garde que le rendu (img/video,
// préchargement, classe `mode-media`, événement « ended » des vidéos) et
// appelle `prochainEtat()` à chaque tick avec l'état courant.
//
// Deux modes, réglables en supervision :
//   « alterne » — horaires → 1 média → horaires → média suivant (historique) ;
//   « serie »   — horaires → TOUS les médias à la suite → horaires.
import type { Media } from './types';

export type VueCycle = { vue: 'horaires' } | { vue: 'media'; index: number };

export type ModeMedias = 'alterne' | 'serie';

export interface EtatCycle {
  vue: VueCycle;
  /** Instant (ms) où la vue courante doit céder la place. */
  finMs: number;
  /**
   * Média à montrer au prochain passage en média. Porté par l'état parce que
   * la fonction est PURE : c'est ce qui permet de reprendre une série là où un
   * départ proche l'avait interrompue, plutôt que de repartir de zéro et de
   * sauter systématiquement les mêmes médias.
   */
  reprendreA?: number;
}

/** État de départ : les horaires, pour la durée configurée. */
export function etatInitial(dureeHorairesS: number, nowMs: number): EtatCycle {
  return horaires(dureeHorairesS, nowMs, 0);
}

function horaires(dureeHorairesS: number, nowMs: number, reprendreA: number): EtatCycle {
  return { vue: { vue: 'horaires' }, finMs: nowMs + dureeHorairesS * 1000, reprendreA };
}

function media(index: number, liste: Media[], nowMs: number): EtatCycle {
  const duree = liste[index]?.duree_s ?? 0;
  return { vue: { vue: 'media', index }, finMs: nowMs + duree * 1000, reprendreA: index };
}

/**
 * État suivant du cycle. Rendre le MÊME objet signifie « rien à changer » :
 * la page n'a alors rien à re-rendre.
 *
 * @param liste médias affichables, déjà filtrés (actif, non expiré, gare) et
 *              triés par `ordre` puis `cree_le`.
 * @param departProche à quai, ou départ dans ≤ 2 min : un média ne doit
 *                     JAMAIS masquer un départ imminent (docs/01 §3).
 */
export function prochainEtat(
  etat: EtatCycle,
  liste: Media[],
  mode: ModeMedias,
  dureeHorairesS: number,
  departProche: boolean,
  nowMs: number,
): EtatCycle {
  // 1. Règle métier prioritaire : un départ proche ramène IMMÉDIATEMENT aux
  //    horaires, quel que soit le mode et même au milieu d'une série.
  if (departProche) {
    if (etat.vue.vue === 'horaires') return etat; // déjà au bon endroit
    return {
      vue: { vue: 'horaires' },
      finMs: nowMs + dureeHorairesS * 1000,
      // La série reprendra au média SUIVANT : sans cela, un média placé juste
      // avant un départ serait sauté à chaque tour.
      reprendreA: etat.vue.index + 1,
    };
  }

  // 2. Sans média affichable, il n'y a rien d'autre à montrer.
  if (liste.length === 0) {
    return etat.vue.vue === 'horaires' ? etat : horaires(dureeHorairesS, nowMs, 0);
  }

  // 3. Média retiré, désactivé ou expiré pendant sa diffusion : l'index peut
  //    être hors bornes, on revient aux horaires sans planter.
  if (etat.vue.vue === 'media' && etat.vue.index >= liste.length) {
    return horaires(dureeHorairesS, nowMs, 0);
  }

  // 4. La vue courante n'est pas terminée : on ne touche à rien.
  if (nowMs < etat.finMs) return etat;

  if (etat.vue.vue === 'horaires') {
    const depuis = etat.reprendreA ?? 0;
    return media(depuis < liste.length ? depuis : 0, liste, nowMs);
  }

  // 5. Fin d'un média : en mode alterné on repasse par les horaires ; en mode
  //    série on enchaîne, et on ne revient aux horaires qu'après le DERNIER.
  const suivant = etat.vue.index + 1;
  if (mode === 'serie' && suivant < liste.length) return media(suivant, liste, nowMs);
  return horaires(dureeHorairesS, nowMs, suivant % liste.length);
}

/** Durée totale d'un tour de cycle, en secondes (récapitulatif supervision). */
export function dureeCycleS(liste: Media[], mode: ModeMedias, dureeHorairesS: number): number {
  if (liste.length === 0) return dureeHorairesS;
  const medias = liste.reduce((somme, m) => somme + m.duree_s, 0);
  // En mode alterné, un tour complet repasse par les horaires entre chaque
  // média : autant de retours aux horaires que de médias.
  return mode === 'serie' ? dureeHorairesS + medias : liste.length * dureeHorairesS + medias;
}
