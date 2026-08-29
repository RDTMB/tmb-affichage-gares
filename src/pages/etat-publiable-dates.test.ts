// Régression du 29/08/2026 : le compteur de la barre de publication sautait à
// 252 après un changement de date suivi d'une première action.
//
// Cause : les clés de l'instantané portent la date
// (`circulation|<date>|<numéro>|<champ>`). La référence restait figée sur la
// date précédente, dont les circulations comptaient comme supprimées pendant
// que celles de la nouvelle comptaient comme ajoutées — 26 trains en grand
// service × 6 champs + 16 en petit service × 6 = 252.
//
// Ces tests rejouent la composition EXACTE du contrôleur (`ecartsPublies`) :
// partie datée reconstruite des deux côtés depuis l'état publié, partie non
// datée seule à venir de la référence figée.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import { generationJour } from '../core/horaires';
import type { Grille, Jour, Params } from '../core/types';
import type { Ecart, Instantane, JourPubliable } from './etat-publiable';
import { ecartsPublies, instantanePubliable, resumeEcarts } from './etat-publiable';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;
const EN_GRAND = '2026-08-29'; // grand service : 26 trains
const EN_PETIT = '2026-09-10'; // petit service : 16 trains

function params(): Params {
  return {
    meteo_sommet: { t: 8, ciel_fr: 'Dégagé', ciel_en: 'Clear', heure_releve: '08:00' },
    veille_nuit: { debut: '21:00', fin: '06:00' },
    duree_horaires_s: 20,
    duree_cache_min: 15,
    vitesse_ticker_px_s: 90,
    a_quai_origine_s: 300,
    machines: [{ nom: 'Marie', couleur: '#2E74B5', en_service: true }],
    motifs: [{ fr: 'Météo', en: 'Weather' }],
  };
}

const P = params();

function entrees(jours: JourPubliable[]) {
  return {
    jours,
    messages: [],
    medias: [],
    params: P,
    ecrans: [],
    machines: P.machines,
    motifs: P.motifs,
    modeles: [],
  };
}

/** Référence figée au chargement, sur la date affichée à ce moment-là. */
function referenceSur(date: string, jour: Jour | null): Instantane {
  return instantanePubliable(entrees([{ date, jour }]));
}

/** Reproduit le calcul du contrôleur : `recalculeEcarts()`. */
function compteur(
  reference: Instantane,
  publies: Map<string, Jour>,
  effectifs: JourPubliable[],
): Ecart[] {
  return ecartsPublies(
    reference,
    effectifs.map((j) => ({ date: j.date, jour: publies.get(j.date) ?? null })),
    entrees(effectifs),
  );
}

function publiees(): Map<string, Jour> {
  return new Map<string, Jour>([
    [EN_GRAND, generationJour(GRAND, EN_GRAND)],
    [EN_PETIT, generationJour(PETIT, EN_PETIT)],
  ]);
}

describe('Le 252 est bien reproductible sur les grilles officielles', () => {
  it('26 trains en grand service, 16 en petit, six champs comparés', () => {
    expect(generationJour(GRAND, EN_GRAND).circulations).toHaveLength(26);
    expect(generationJour(PETIT, EN_PETIT).circulations).toHaveLength(16);
    expect(26 * 6 + 16 * 6).toBe(252);
  });

  it('sans le correctif, une référence figée sur l’ancienne date donnerait 252', () => {
    // Comparaison NAÏVE (l'ancien comportement) : référence datée figée.
    const jourGrand = generationJour(GRAND, EN_GRAND);
    const jourPetit = generationJour(PETIT, EN_PETIT);
    const reference = referenceSur(EN_GRAND, jourGrand);
    const naif = ecartsPublies(
      reference,
      [{ date: EN_GRAND, jour: jourGrand }], // ← la référence reste sur l'ANCIENNE date
      entrees([{ date: EN_PETIT, jour: jourPetit }]),
    );
    // 252 champs de circulation + les deux bascules de journée
    expect(naif.filter((e) => e.cle.startsWith('circulation|'))).toHaveLength(252);
  });
});

describe('Correctif : la référence datée suit la date affichée', () => {
  it('ouvrir une date jamais utilisée affiche 0 modification', () => {
    const publies = publiees();
    const reference = referenceSur(EN_GRAND, publies.get(EN_GRAND) ?? null);
    const apres = compteur(reference, publies, [
      { date: EN_PETIT, jour: publies.get(EN_PETIT) ?? null },
    ]);
    expect(apres).toEqual([]);
  });

  it('activer un facultatif sur la nouvelle date compte 1, jamais 252', () => {
    const publies = publiees();
    const reference = referenceSur(EN_GRAND, publies.get(EN_GRAND) ?? null);
    const base = publies.get(EN_PETIT);
    if (!base) throw new Error('journée absente');
    const facultatif = base.circulations.find((c) => c.facultatif);
    if (!facultatif) throw new Error('aucun facultatif au petit service');

    const effectif: Jour = {
      ...base,
      circulations: base.circulations.map((c) =>
        c.numero === facultatif.numero ? { ...c, facultatif_actif: true } : c,
      ),
    };
    const liste = compteur(reference, publies, [{ date: EN_PETIT, jour: effectif }]);
    expect(liste).toHaveLength(1);
    expect(liste[0]?.libelle).toBe(`TRAIN ${facultatif.numero} facultatif_actif`);
  });

  it('aller-retour entre deux dates sans rien modifier : 0 modification', () => {
    const publies = publiees();
    const reference = referenceSur(EN_GRAND, publies.get(EN_GRAND) ?? null);
    for (const date of [EN_PETIT, EN_GRAND, EN_PETIT, EN_GRAND]) {
      expect(compteur(reference, publies, [{ date, jour: publies.get(date) ?? null }])).toEqual([]);
    }
  });
});

describe('Une modification en attente sur une AUTRE date reste comptée', () => {
  // « Publier » publie TOUTES les dates du brouillon : les ignorer griserait
  // le bouton alors qu'il reste quelque chose à publier ailleurs — la
  // modification deviendrait impubliable.
  function grandRetarde(publies: Map<string, Jour>): Jour {
    const base = publies.get(EN_GRAND);
    if (!base) throw new Error('journée absente');
    return {
      ...base,
      circulations: base.circulations.map((c) =>
        c.numero === 5 ? { ...c, statut: 'retard' as const, retard_min: 10 } : c,
      ),
    };
  }

  it('elle est comptée alors même qu’on affiche une autre date', () => {
    const publies = publiees();
    const reference = referenceSur(EN_GRAND, publies.get(EN_GRAND) ?? null);
    const liste = compteur(reference, publies, [
      { date: EN_PETIT, jour: publies.get(EN_PETIT) ?? null },
      { date: EN_GRAND, jour: grandRetarde(publies) },
    ]);
    expect(liste.map((e) => e.libelle).sort()).toEqual(['TRAIN 5 retard_min', 'TRAIN 5 statut']);
  });

  it('et une seule fois, au retour sur sa date', () => {
    const publies = publiees();
    const reference = referenceSur(EN_GRAND, publies.get(EN_GRAND) ?? null);
    const modifie = grandRetarde(publies);
    // A → B → A : le compte ne double jamais
    expect(compteur(reference, publies, [{ date: EN_GRAND, jour: modifie }])).toHaveLength(2);
    expect(
      compteur(reference, publies, [
        { date: EN_PETIT, jour: publies.get(EN_PETIT) ?? null },
        { date: EN_GRAND, jour: modifie },
      ]),
    ).toHaveLength(2);
    expect(compteur(reference, publies, [{ date: EN_GRAND, jour: modifie }])).toHaveLength(2);
  });
});

describe('Le résumé de publication ne parle que des dates concernées', () => {
  it('aucun train d’une autre date n’y figure', () => {
    const publies = publiees();
    const reference = referenceSur(EN_GRAND, publies.get(EN_GRAND) ?? null);
    const base = publies.get(EN_PETIT);
    if (!base) throw new Error('journée absente');
    const modifie: Jour = {
      ...base,
      circulations: base.circulations.map((c) =>
        c.numero === 1 ? { ...c, statut: 'supprime' as const } : c,
      ),
    };
    const liste = compteur(reference, publies, [{ date: EN_PETIT, jour: modifie }]);
    expect(resumeEcarts(liste)).toBe('1 modification(s) : TRAIN 1 statut ok → supprime');
    expect(liste.every((e) => !e.cle.includes(EN_GRAND))).toBe(true);
  });
});
