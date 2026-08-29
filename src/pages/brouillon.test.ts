// Le brouillon de publication doit refléter fidèlement ce qui sera écrit à
// la publication, sans jamais toucher la base ni les objets d'origine.
import { describe, expect, it } from 'vitest';

import type { Circulation, Jour, Message, Params } from '../core/types';
import {
  appliqueBrouillonJour,
  appliqueBrouillonMessages,
  appliqueBrouillonParams,
  estIdMessageBrouillon,
  nbCirculationsEnAttente,
  nouvelIdMessageBrouillon,
  stageCirculation,
  videDate,
  type BrouillonCirculations,
  type BrouillonMessages,
  type BrouillonTerminus,
} from './brouillon';

function circulation(partiel: Partial<Circulation> = {}): Circulation {
  return {
    date: '2026-08-30',
    numero: 5,
    sens: 'montee',
    express: false,
    facultatif: false,
    facultatif_actif: true,
    velos: false,
    rame: 'Anne',
    terminus: 'nid-daigle',
    statut: 'ok',
    retard_min: 0,
    motif: null,
    sans_voyageurs: false,
    ...partiel,
  };
}

function jour(partiel: Partial<Jour> = {}): Jour {
  return {
    date: '2026-08-30',
    grille_version: 'grand-service',
    terminus_bellevue: false,
    circulations: [circulation()],
    ...partiel,
  };
}

describe('Circulations en attente', () => {
  it("n'affecte pas la journée tant que rien n'est en attente pour sa date", () => {
    const brouillonCirc: BrouillonCirculations = new Map();
    const brouillonTerminus: BrouillonTerminus = new Map();
    const j = jour();
    expect(appliqueBrouillonJour(j, brouillonCirc, brouillonTerminus)).toBe(j); // même référence
  });

  it('applique le patch en attente au train concerné, laisse les autres intacts', () => {
    const brouillonCirc: BrouillonCirculations = new Map();
    const brouillonTerminus: BrouillonTerminus = new Map();
    const j = jour({ circulations: [circulation({ numero: 5 }), circulation({ numero: 6 })] });
    stageCirculation(brouillonCirc, circulation({ numero: 5, rame: 'Bernard' }));

    const effectif = appliqueBrouillonJour(j, brouillonCirc, brouillonTerminus);

    expect(effectif.circulations.find((c) => c.numero === 5)?.rame).toBe('Bernard');
    expect(effectif.circulations.find((c) => c.numero === 6)?.rame).toBe('Anne');
    // La journée d'origine n'est jamais mutée (fonction pure).
    expect(j.circulations.find((c) => c.numero === 5)?.rame).toBe('Anne');
  });

  it('ne mélange pas les brouillons de deux dates différentes', () => {
    const brouillonCirc: BrouillonCirculations = new Map();
    const brouillonTerminus: BrouillonTerminus = new Map();
    stageCirculation(brouillonCirc, circulation({ date: '2026-08-30', numero: 5, rame: 'X' }));
    stageCirculation(brouillonCirc, circulation({ date: '2026-08-31', numero: 5, rame: 'Y' }));

    const j30 = jour({ date: '2026-08-30' });
    const j31 = jour({ date: '2026-08-31' });

    expect(appliqueBrouillonJour(j30, brouillonCirc, brouillonTerminus).circulations[0]?.rame).toBe(
      'X',
    );
    expect(appliqueBrouillonJour(j31, brouillonCirc, brouillonTerminus).circulations[0]?.rame).toBe(
      'Y',
    );
    expect(nbCirculationsEnAttente(brouillonCirc)).toBe(2);
  });

  it('re-stager le même train remplace le patch précédent (pas de pile)', () => {
    const brouillonCirc: BrouillonCirculations = new Map();
    stageCirculation(brouillonCirc, circulation({ numero: 5, rame: 'Bernard' }));
    stageCirculation(brouillonCirc, circulation({ numero: 5, rame: 'Chantal' }));
    expect(nbCirculationsEnAttente(brouillonCirc)).toBe(1);
    const effectif = appliqueBrouillonJour(jour(), brouillonCirc, new Map());
    expect(effectif.circulations[0]?.rame).toBe('Chantal');
  });

  it('applique une bascule Terminus Bellevue en attente', () => {
    const brouillonTerminus: BrouillonTerminus = new Map([
      ['2026-08-30', { a_partir_du_train: 9 }],
    ]);
    const effectif = appliqueBrouillonJour(jour(), new Map(), brouillonTerminus);
    expect(effectif.terminus_bellevue).toEqual({ a_partir_du_train: 9 });
  });

  it('videDate efface les deux brouillons de la date (ex. après réinitialisation)', () => {
    const brouillonCirc: BrouillonCirculations = new Map();
    const brouillonTerminus: BrouillonTerminus = new Map();
    stageCirculation(brouillonCirc, circulation({ date: '2026-08-30' }));
    brouillonTerminus.set('2026-08-30', { a_partir_du_train: 9 });
    stageCirculation(brouillonCirc, circulation({ date: '2026-08-31' }));

    videDate(brouillonCirc, brouillonTerminus, '2026-08-30');

    expect(brouillonCirc.has('2026-08-30')).toBe(false);
    expect(brouillonTerminus.has('2026-08-30')).toBe(false);
    expect(brouillonCirc.has('2026-08-31')).toBe(true); // l'autre date n'est pas touchée
  });
});

function message(partiel: Partial<Message> = {}): Message {
  return {
    id: 'm-1',
    texte_fr: 'Retard sur le réseau',
    texte_en: 'Delay on the network',
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
    ...partiel,
  };
}

describe('Messages en attente', () => {
  it('retourne la liste telle quelle si rien n’est en attente', () => {
    const messages = [message()];
    expect(appliqueBrouillonMessages(messages, new Map())).toBe(messages);
  });

  it('applique une modification en attente sur un message existant', () => {
    const brouillon: BrouillonMessages = new Map([
      ['m-1', message({ texte_fr: 'Retard important sur le réseau' })],
    ]);
    const effectif = appliqueBrouillonMessages([message()], brouillon);
    expect(effectif).toHaveLength(1);
    expect(effectif[0]?.texte_fr).toBe('Retard important sur le réseau');
  });

  it('retire un message dont la suppression est en attente', () => {
    const brouillon: BrouillonMessages = new Map([['m-1', null]]);
    expect(appliqueBrouillonMessages([message()], brouillon)).toHaveLength(0);
  });

  it('ajoute un message en cours de création (clé brouillon:...) à la suite', () => {
    const idTemp = nouvelIdMessageBrouillon();
    expect(estIdMessageBrouillon(idTemp)).toBe(true);
    const brouillon: BrouillonMessages = new Map([
      [idTemp, message({ id: idTemp, texte_fr: 'Nouveau' })],
    ]);
    const effectif = appliqueBrouillonMessages([message()], brouillon);
    expect(effectif.map((m) => m.texte_fr)).toEqual(['Retard sur le réseau', 'Nouveau']);
  });
});

function params(partiel: Partial<Params> = {}): Params {
  return {
    meteo_sommet: { t: 12, ciel_fr: 'Ensoleillé', ciel_en: 'Sunny', heure_releve: '09:00' },
    veille_nuit: { debut: '20:00', fin: '06:00' },
    duree_horaires_s: 20,
    duree_cache_min: 15,
    a_quai_origine_s: 300,
    vitesse_ticker_px_s: 90,
    machines: [],
    motifs: [],
    ...partiel,
  } as Params;
}

describe('Paramètres (météo, vitesse) en attente', () => {
  it('retourne params tel quel si rien n’est en attente', () => {
    const p = params();
    expect(appliqueBrouillonParams(p, {})).toBe(p);
  });

  it('applique la vitesse en attente sans toucher au reste', () => {
    const p = params();
    const effectif = appliqueBrouillonParams(p, { vitesse_ticker_px_s: 130 });
    expect(effectif.vitesse_ticker_px_s).toBe(130);
    expect(effectif.meteo_sommet).toEqual(p.meteo_sommet);
  });

  it('applique la météo en attente (objet complet, reconstruit à la saisie)', () => {
    const p = params();
    const nouvelleMeteo = { t: 18, ciel_fr: 'Pluie', ciel_en: 'Rain', heure_releve: '10:30' };
    const effectif = appliqueBrouillonParams(p, { meteo_sommet: nouvelleMeteo });
    expect(effectif.meteo_sommet).toEqual(nouvelleMeteo);
  });
});
