// Compteur de la barre de publication : ÉCARTS RÉELS, pas nombre de clics.
// Scénario de référence de l'exploitant : 8 → 12 → 8 doit rendre « 0
// modification en attente » (le bouton repasse en gris), alors que le journal
// d'exploitation, lui, garde bien les deux écritures (voir mock.test.ts).
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import { generationJour } from '../core/horaires';
import type { EcranInfo, Grille, Jour, Message, Params } from '../core/types';
import {
  ecarts,
  horodatageJournal,
  instantanePubliable,
  journalVersCsv,
  libelleObjet,
  normalise,
  resumeEcarts,
} from './etat-publiable';

const GRAND = grandServiceJson as unknown as Grille;
const DATE = '2026-08-29';

function params(t: number, extra: Partial<Params> = {}): Params {
  return {
    meteo_sommet: { t, ciel_fr: 'Dégagé', ciel_en: 'Clear', heure_releve: '08:00' },
    veille_nuit: { debut: '21:00', fin: '06:00' },
    duree_horaires_s: 20,
    duree_cache_min: 15,
    mode_medias: 'alterne',
    vitesse_ticker_px_s: 90,
    a_quai_origine_s: 300,
    machines: [{ nom: 'Marie', couleur: '#2E74B5', en_service: true }],
    motifs: [{ fr: 'Météo', en: 'Weather' }],
    ...extra,
  };
}

function entrees(p: Params, jour: Jour, messages: Message[] = [], ecrans: EcranInfo[] = []) {
  return {
    jours: [{ date: DATE, jour }],
    messages,
    medias: [],
    params: p,
    ecrans,
    machines: p.machines,
    motifs: p.motifs,
    modeles: [],
  };
}

describe('Normalisation : aucune différence cosmétique ne compte', () => {
  it('les nombres sont comparés en VALEUR', () => {
    expect(normalise(8)).toBe(normalise('8'));
    expect(normalise('8.0')).toBe(normalise(8));
    expect(normalise('+8')).toBe(normalise(8));
  });

  it('les textes sont comparés après trim', () => {
    expect(normalise('  Dégagé  ')).toBe(normalise('Dégagé'));
  });

  it('l’absence de valeur se vaut sous toutes ses formes', () => {
    expect(normalise(null)).toBe('');
    expect(normalise(undefined)).toBe('');
    expect(normalise('   ')).toBe('');
  });

  it('une heure ou une date ne se fait pas avaler par la règle numérique', () => {
    expect(normalise('21:00')).toBe('21:00');
    expect(normalise('2026-08-29')).toBe('2026-08-29');
  });

  it('les booléens sont lisibles', () => {
    expect(normalise(true)).toBe('oui');
    expect(normalise(false)).toBe('non');
  });
});

describe('Aller-retour : la valeur revenue à son point de départ ne compte plus', () => {
  const jour = generationJour(GRAND, DATE);

  it('8 → 12 → 8 : aucune modification en attente', () => {
    const reference = instantanePubliable(entrees(params(8), jour));
    const apres12 = instantanePubliable(entrees(params(12), jour));
    const revenu8 = instantanePubliable(entrees(params(8), jour));

    expect(ecarts(reference, apres12)).toHaveLength(1); // le bouton s'active
    expect(ecarts(reference, revenu8)).toHaveLength(0); // …puis se rendort
  });

  it('8 → 12 : une seule modification, correctement nommée', () => {
    const liste = ecarts(
      instantanePubliable(entrees(params(8), jour)),
      instantanePubliable(entrees(params(12), jour)),
    );
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ libelle: 'météo t', avant: '8', apres: '12' });
  });

  it('un retard posé puis retiré ne laisse aucun écart', () => {
    const jourRetarde = generationJour(GRAND, DATE);
    const c = jourRetarde.circulations.find((x) => x.numero === 5);
    if (!c) throw new Error('TRAIN 5 absent');

    const reference = instantanePubliable(entrees(params(8), jour));
    c.statut = 'retard';
    c.retard_min = 10;
    c.motif = 'Météo';
    const pose = ecarts(reference, instantanePubliable(entrees(params(8), jourRetarde)));
    expect(pose.map((e) => e.libelle)).toEqual([
      'TRAIN 5 motif',
      'TRAIN 5 retard_min',
      'TRAIN 5 statut',
    ]);

    c.statut = 'ok';
    c.retard_min = 0;
    c.motif = null;
    expect(ecarts(reference, instantanePubliable(entrees(params(8), jourRetarde)))).toEqual([]);
  });

  it('« 8 » saisi en texte ne compte pas comme une modification', () => {
    const reference = instantanePubliable(entrees(params(8), jour));
    const texte = instantanePubliable(entrees(params('8' as unknown as number), jour));
    expect(ecarts(reference, texte)).toEqual([]);
  });
});

describe('Portée de l’état de référence', () => {
  const jour = generationJour(GRAND, DATE);

  it('couvre les champs de circulation qui comptent pour les voyageurs', () => {
    const instantane = instantanePubliable(entrees(params(8), jour));
    for (const champ of [
      'statut',
      'retard_min',
      'motif',
      'rame',
      'terminus',
      'facultatif_actif',
      'sans_voyageurs',
    ]) {
      expect(instantane).toHaveProperty(`circulation|${DATE}|5|${champ}`);
    }
  });

  it('couvre la veille globale ET la veille propre à chaque écran', () => {
    const ecran: EcranInfo = {
      id: 'bellevue-ecran-1',
      gare: 'bellevue',
      veille_debut: '19:00:00',
      veille_fin: '06:30:00',
    };
    const avec = instantanePubliable(entrees(params(8), jour, [], [ecran]));
    expect(avec['params|veille|debut']).toBe('21:00');
    expect(avec['ecran|bellevue-ecran-1|veille_debut']).toBe('19:00');

    const sans = instantanePubliable(
      entrees(params(8), jour, [], [{ id: 'bellevue-ecran-1', gare: 'bellevue' }]),
    );
    expect(ecarts(sans, avec)).toHaveLength(2);
  });

  it('un message supprimé est un écart, pas un non-événement', () => {
    const message: Message = {
      id: 'm1',
      texte_fr: 'Vent fort',
      texte_en: 'Strong wind',
      cible_type: 'toutes',
      priorite: 'normale',
      actif: true,
    };
    const avec = instantanePubliable(entrees(params(8), jour, [message]));
    const sans = instantanePubliable(entrees(params(8), jour, []));
    expect(ecarts(avec, sans).length).toBeGreaterThan(0);
  });

  it('la bascule Terminus Bellevue de la journée est suivie', () => {
    const limite = generationJour(GRAND, DATE);
    limite.terminus_bellevue = { a_partir_du_train: 19 };
    const liste = ecarts(
      instantanePubliable(entrees(params(8), jour)),
      instantanePubliable(entrees(params(8), limite)),
    );
    expect(liste).toHaveLength(1);
    expect(liste[0]?.libelle).toBe('terminus Bellevue');
  });
});

describe('Résumé consigné à la publication', () => {
  const jour = generationJour(GRAND, DATE);

  it('décrit les écarts réels', () => {
    const liste = ecarts(
      instantanePubliable(entrees(params(8), jour)),
      instantanePubliable(entrees(params(12), jour)),
    );
    expect(resumeEcarts(liste)).toBe('1 modification(s) : météo t 8 → 12');
  });

  it('ne mentionne PAS une valeur revenue à son point de départ', () => {
    const liste = ecarts(
      instantanePubliable(entrees(params(8), jour)),
      instantanePubliable(entrees(params(8), jour)),
    );
    expect(resumeEcarts(liste)).toBe('publication sans modification');
    expect(resumeEcarts(liste)).not.toContain('→');
  });

  it('tronque les longues listes en annonçant le reste', () => {
    const nombreux = Array.from({ length: 14 }, (_, i) => ({
      cle: `c${i}`,
      libelle: `champ ${i}`,
      avant: 'a',
      apres: 'b',
    }));
    const resume = resumeEcarts(nombreux);
    expect(resume).toContain('14 modification(s)');
    expect(resume).toContain('+4 autre(s)');
  });
});

describe('Journal d’exploitation : mise en forme', () => {
  it('les noms de tables deviennent des libellés d’exploitation', () => {
    expect(libelleObjet('circulations')).toBe('Circulation');
    expect(libelleObjet('modeles_messages')).toBe('Modèle');
    expect(libelleObjet('table_inconnue')).toBe('table_inconnue');
  });

  it('l’horodatage est rendu en heure de Paris', () => {
    // 29/08 07:19 UTC = 09:19 à Paris (heure d'été)
    expect(horodatageJournal('2026-08-29T07:19:42Z')).toBe('29/08 09:19:42');
  });

  it('un horodatage illisible est rendu tel quel plutôt qu’en « Invalid Date »', () => {
    expect(horodatageJournal('pas une date')).toBe('pas une date');
  });

  it('l’export CSV échappe les guillemets et porte un BOM', () => {
    const csv = journalVersCsv([
      {
        quand: '2026-08-29T07:19:42Z',
        qui: 'agent@tmb.fr',
        table_cible: 'params',
        cle: 'meteo_sommet',
        champ: 't',
        avant: '8',
        apres: '12',
        date_service: null,
      },
      {
        quand: '2026-08-29T07:20:00Z',
        qui: null,
        table_cible: 'messages',
        cle: 'm1',
        champ: 'texte_fr',
        avant: 'Vent dit "fort" sur le plateau',
        apres: null,
        date_service: '2026-08-29',
      },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('quand;qui;objet;cle;champ;avant;apres;date_service');
    // Un guillemet droit dans le texte doit être doublé, sinon Excel casse
    // la colonne au milieu du message.
    expect(csv).toContain('"Vent dit ""fort"" sur le plateau"');
    expect(csv).toContain('Paramètre');
    expect(csv).toContain('"agent@tmb.fr"');
    expect(csv).toContain('2026-08-29');
  });
});
