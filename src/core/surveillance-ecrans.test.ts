// La règle « ce poste est-il en défaut ? », éprouvée seule.
//
// Ces tests portent sur la DÉCISION. Le câblage — que le guetteur applique
// bien cette règle-ci et pas une copie qui a dérivé — est éprouvé à part, dans
// `src/data/alerte-ecrans.test.ts`, qui exécute le code réellement déployé.
// Une règle verte et un câblage faux, c'est exactement l'état du 19/09 : la
// base savait, et personne ne regardait.
import { describe, expect, it } from 'vitest';

import {
  SEUIL_DEFAUT_MS,
  bilanSurveillance,
  estAuRepos,
  etatSurveillance,
  silenceLisible,
  type PosteSurveille,
} from './surveillance-ecrans';
import type { VeilleNuit } from './types';

/** Veille de nuit de la ligne, telle qu'elle est en base l'été 2026. */
const VEILLE: VeilleNuit = { debut: '21:00', fin: '06:00' };

/** 10:00:00 heure locale, un jour quelconque — l'instant de référence. */
const MAINTENANT_MS = Date.parse('2026-09-19T10:00:00+02:00');
const MAINTENANT_S = 10 * 3600;

/** Poste vu il y a `ms`. */
function vuIlYA(ms: number, reste: Partial<PosteSurveille> = {}): PosteSurveille {
  return {
    id: 'saint-gervais-ecran-1',
    gare: 'saint-gervais',
    derniere_vue: new Date(MAINTENANT_MS - ms).toISOString(),
    ...reste,
  };
}

function etat(poste: PosteSurveille, maintenant_s = MAINTENANT_S) {
  return etatSurveillance(poste, VEILLE, MAINTENANT_MS, maintenant_s);
}

describe('Le seuil', () => {
  it('vaut dix minutes, soit neuf battements manqués', () => {
    // Le battement est de 60 s (`INTERVALLE_HEARTBEAT_MS`). Ce n'est pas un
    // nombre rond choisi au hasard : c'est ce qui écarte une coupure brève.
    expect(SEUIL_DEFAUT_MS).toBe(600_000);
  });

  it('une seconde AVANT le seuil, le poste n’est pas en défaut', () => {
    const e = etat(vuIlYA(SEUIL_DEFAUT_MS - 1000));
    expect(e.defaut).toBe(false);
    expect(e.motif).toBe('vivant');
  });

  it('AU seuil exactement, il l’est', () => {
    // La borne est incluse. Un `>` au lieu d'un `>=` laisserait passer
    // l'instant pile, et personne ne le verrait jamais : la tâche ne tourne
    // que toutes les cinq minutes.
    expect(etat(vuIlYA(SEUIL_DEFAUT_MS)).defaut).toBe(true);
  });

  it('la panne du 19/09 — trois heures de silence — est en défaut', () => {
    const e = etat(vuIlYA(3 * 3_600_000 + 12 * 60_000));
    expect(e.defaut).toBe(true);
    expect(silenceLisible(e.silence_ms ?? 0)).toBe('3 h 12');
  });
});

describe('Les trois repos, dans leur ordre', () => {
  it('un poste RETIRÉ du service ne se juge pas, même muet depuis trois jours', () => {
    // Le cas du Nid d'Aigle l'hiver : sans cette porte, il alerterait chaque
    // jour pendant six mois, et l'alerte cesserait d'être lue.
    const e = etat(vuIlYA(3 * 24 * 3_600_000, { surveille: false }));
    expect(e.defaut).toBe(false);
    expect(e.motif).toBe('hors-service');
  });

  it('le retrait l’emporte sur tout le reste, y compris sur un silence énorme', () => {
    // L'ordre des tests est la règle : si le silence était mesuré d'abord, un
    // poste retiré ressortirait en défaut.
    expect(etat(vuIlYA(30 * 24 * 3_600_000, { surveille: false })).motif).toBe('hors-service');
  });

  it('un poste JAMAIS vu est déclaré, pas posé : aucune alerte', () => {
    expect(etat({ id: 'motivon-ecran-1', gare: 'motivon', derniere_vue: null }).motif).toBe(
      'jamais-vu',
    );
    expect(etat({ id: 'motivon-ecran-1', gare: 'motivon' }).motif).toBe('jamais-vu');
  });

  it('une date ILLISIBLE ne fait pas passer un poste mort pour vivant', () => {
    // `NaN` compare toujours faux : sans le garde, `NaN >= seuil` vaut FAUX et
    // le poste serait rendu « vivant ». C'est l'erreur qui se tait.
    const e = etat({ id: 'x', gare: 'bellevue', derniere_vue: 'pas-une-date' });
    expect(e.defaut).toBe(false);
    expect(e.motif).toBe('jamais-vu');
    expect(e.motif).not.toBe('vivant');
  });

  it('pendant la veille de nuit, le silence ne prouve rien', () => {
    const e = etat(vuIlYA(4 * 3_600_000), 2 * 3600); // 02:00
    expect(e.defaut).toBe(false);
    expect(e.motif).toBe('en-veille');
    // Le silence reste MESURÉ : la supervision doit pouvoir le dire même la nuit.
    expect(e.silence_ms).toBe(4 * 3_600_000);
  });

  it('la veille surveillée franchit minuit, des DEUX côtés', () => {
    const poste = vuIlYA(4 * 3_600_000);
    expect(etat(poste, 22 * 3600).motif).toBe('en-veille'); // 22:00, avant minuit
    expect(etat(poste, 3 * 3600).motif).toBe('en-veille'); // 03:00, après minuit
    expect(etat(poste, 20 * 3600 + 3599).defaut).toBe(true); // 20:59:59, dehors
    expect(etat(poste, 6 * 3600).defaut).toBe(true); // 06:00 pile, la veille est finie
  });

  it('la fenêtre PROPRE au poste l’emporte sur celle de la ligne', () => {
    // Un écran de quai très exposé s'éteint plus tôt. À 19:00 la ligne n'est
    // pas en veille, ce poste-là si.
    const poste = vuIlYA(4 * 3_600_000, { veille_debut: '18:00:00', veille_fin: '07:00:00' });
    expect(etat(poste, 19 * 3600).motif).toBe('en-veille');
    expect(etat(vuIlYA(4 * 3_600_000), 19 * 3600).defaut).toBe(true); // sans sa fenêtre
  });

  it('une SEULE borne ne décrit pas une fenêtre : la ligne reprend la main', () => {
    // Même règle que le moteur d'affichage (`veilleEffective`). Une demi-
    // surcharge qui vaudrait veille éteindrait la surveillance d'un poste pour
    // de bon.
    const moitie = vuIlYA(4 * 3_600_000, { veille_debut: '18:00:00', veille_fin: null });
    expect(etat(moitie, 19 * 3600).defaut).toBe(true);
    expect(estAuRepos(moitie, VEILLE, 19 * 3600)).toBe(false);
    expect(estAuRepos(moitie, VEILLE, 22 * 3600)).toBe(true); // la globale, elle, s'applique
  });
});

describe('Le bilan de la flotte', () => {
  const nuitCalme: VeilleNuit = { debut: '21:00', fin: '06:00' };
  const bilan = (postes: PosteSurveille[], s = MAINTENANT_S) =>
    bilanSurveillance(postes, nuitCalme, MAINTENANT_MS, s);

  it('ne compte comme surveillés ni les retirés, ni les jamais vus, ni les endormis', () => {
    const b = bilan(
      [
        vuIlYA(5000, { id: 'a', gare: 'le-fayet' }),
        vuIlYA(5000, { id: 'b', gare: 'nid-daigle', surveille: false }),
        { id: 'c', gare: 'motivon', derniere_vue: null },
        vuIlYA(5000, {
          id: 'd',
          gare: 'bellevue',
          veille_debut: '09:00:00',
          veille_fin: '11:00:00',
        }),
      ],
      MAINTENANT_S,
    );
    expect(b.surveilles).toBe(1);
    expect(b.enDefaut).toEqual([]);
  });

  it('un seul poste muet : pas de panne globale, on nomme le poste', () => {
    const b = bilan([
      vuIlYA(20 * 60_000, { id: 'saint-gervais-ecran-1', gare: 'saint-gervais' }),
      vuIlYA(5000, { id: 'le-fayet-ecran-1', gare: 'le-fayet' }),
    ]);
    expect(b.enDefaut.map((p) => p.id)).toEqual(['saint-gervais-ecran-1']);
    expect(b.globale).toBe(false);
  });

  it('tous muets : UNE panne globale, pas six courriels', () => {
    const b = bilan([
      vuIlYA(20 * 60_000, { id: 'a', gare: 'le-fayet' }),
      vuIlYA(25 * 60_000, { id: 'b', gare: 'saint-gervais' }),
      vuIlYA(30 * 60_000, { id: 'c', gare: 'motivon' }),
    ]);
    expect(b.globale).toBe(true);
    expect(b.enDefaut).toHaveLength(3);
  });

  it('un poste retiré ne fabrique pas une panne globale à lui tout seul', () => {
    // Deux postes en base, un seul surveillé et muet : ce n'est pas une panne
    // en amont, c'est un Raspberry débranché. Sans le plancher de deux, le
    // message parlerait d'une cause qui n'existe pas.
    const b = bilan([
      vuIlYA(20 * 60_000, { id: 'a', gare: 'le-fayet' }),
      vuIlYA(20 * 60_000, { id: 'b', gare: 'nid-daigle', surveille: false }),
    ]);
    expect(b.surveilles).toBe(1);
    expect(b.globale).toBe(false);
    expect(b.enDefaut).toHaveLength(1);
  });

  it('aucun poste surveillé : pas de panne globale sur une flotte vide', () => {
    expect(bilan([]).globale).toBe(false);
    expect(bilan([{ id: 'a', gare: 'le-fayet', derniere_vue: null }]).globale).toBe(false);
  });

  it('les postes sortent du plus ancien silence au plus récent', () => {
    // Le courriel nomme le premier poste de la liste : ce doit être celui qui
    // se tait depuis le plus longtemps, pas celui que la base a rendu d'abord.
    const b = bilan([
      vuIlYA(12 * 60_000, { id: 'recent', gare: 'le-fayet' }),
      vuIlYA(3 * 3_600_000, { id: 'ancien', gare: 'saint-gervais' }),
      vuIlYA(30 * 60_000, { id: 'moyen', gare: 'motivon' }),
    ]);
    expect(b.enDefaut.map((p) => p.id)).toEqual(['ancien', 'moyen', 'recent']);
  });

  it('chaque poste en défaut porte sa dernière vue : c’est la clé de l’épisode', () => {
    // Sans elle, un poste qui se tait, revient et se retait paraîtrait n'avoir
    // jamais cessé, et la seconde panne ne serait jamais annoncée.
    const b = bilan([vuIlYA(20 * 60_000, { id: 'a', gare: 'le-fayet' })]);
    expect(b.enDefaut[0]?.derniere_vue).toBe(new Date(MAINTENANT_MS - 20 * 60_000).toISOString());
  });
});

describe('Une durée qui se lit d’un coup d’œil', () => {
  it('sous la minute, en secondes', () => {
    expect(silenceLisible(0)).toBe('0 s');
    expect(silenceLisible(45_000)).toBe('45 s');
    expect(silenceLisible(59_400)).toBe('59 s');
  });

  it('sous l’heure, en minutes entières', () => {
    expect(silenceLisible(60_000)).toBe('1 min');
    expect(silenceLisible(12 * 60_000)).toBe('12 min');
    expect(silenceLisible(59 * 60_000 + 59_000)).toBe('59 min');
  });

  it('au-delà, en heures et minutes sur deux chiffres', () => {
    expect(silenceLisible(3_600_000)).toBe('1 h 00');
    expect(silenceLisible(3_600_000 + 5 * 60_000)).toBe('1 h 05');
    expect(silenceLisible(11_704_000)).toBe('3 h 15');
    expect(silenceLisible(47 * 3_600_000 + 59 * 60_000)).toBe('47 h 59');
  });

  it('au-delà de deux jours, en JOURS — sinon « 120 h 00 », puis « 4380 h 00 »', () => {
    // Mesuré à l'écran le 19/09/2026 : un poste retiré depuis cinq jours
    // affichait « 120 h 00 ». C'était l'illisibilité que cette fonction
    // existe pour supprimer, simplement déplacée d'un cran. Le Nid d'Aigle
    // hors-saison aurait affiché la durée en heures pendant six mois.
    expect(silenceLisible(48 * 3_600_000)).toBe('2 j');
    expect(silenceLisible(5 * 24 * 3_600_000)).toBe('5 j');
    expect(silenceLisible(183 * 24 * 3_600_000)).toBe('183 j');
  });

  it('une durée négative — horloge du poste en avance — se lit « 0 s », jamais « -3 min »', () => {
    expect(silenceLisible(-5000)).toBe('0 s');
  });
});
