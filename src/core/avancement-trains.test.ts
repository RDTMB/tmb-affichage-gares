// Avancement ESTIMÉ d'un train entre deux gares (`avancementsTrains`) — la
// position que le profil de la ligne dessine (décision de l'exploitant du
// 10/11/2026).
//
// Ce que ces tests protègent :
//   - la part de trajet est calculée sur les heures RÉELLES de la grille
//     (départ de la gare → arrivée à la suivante), retard déclaré compris ;
//   - elle ne sort JAMAIS de [0, 1] — une machine dessinée au-delà de sa gare
//     suivante serait une position fausse, pas une estimation ;
//   - `positionsTrains`, que lit la grille du jour, n'a PAS changé : mêmes
//     trains, mêmes gares, et pas de part de trajet (règle du 05/11/2026 :
//     à mi-chemin, jamais interpolé).
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import { avancementsTrains, generationJour, heureVersSecondes, positionsTrains } from './horaires';
import type { Circulation, Grille, Jour } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const DATE = '2026-07-15';
const h = heureVersSecondes;

function jourGrand(): Jour {
  return generationJour(GRAND, DATE);
}

function circ(jour: Jour, numero: number): Circulation {
  const circulation = jour.circulations.find((c) => c.numero === numero);
  if (!circulation) throw new Error(`circulation ${numero} absente du jour généré`);
  return circulation;
}

describe('avancementsTrains — la part de trajet', () => {
  // TRAIN 1 : Le Fayet 07:00:00 → Saint-Gervais 07:10:00 / 07:15:00 → Motivon 07:26:30.
  it('au départ réel d’une gare : en route, part 0', () => {
    const t1 = avancementsTrains(GRAND, jourGrand(), h('07:00:00')).find((a) => a.numero === 1);
    expect(t1).toMatchObject({ gare: 'le-fayet', vers: 'saint-gervais', part: 0 });
  });

  it('à mi-temps entre deux gares : part 0,5', () => {
    const t1 = avancementsTrains(GRAND, jourGrand(), h('07:05:00')).find((a) => a.numero === 1);
    expect(t1).toMatchObject({ gare: 'le-fayet', vers: 'saint-gervais' });
    expect(t1?.part).toBeCloseTo(0.5, 5);
  });

  it('aux trois quarts du temps : part 0,75 — au prorata, pas par paliers', () => {
    const t1 = avancementsTrains(GRAND, jourGrand(), h('07:07:30')).find((a) => a.numero === 1);
    expect(t1?.part).toBeCloseTo(0.75, 5);
  });

  it('à quai d’une gare intermédiaire : part 0, pas de gare suivante', () => {
    const t1 = avancementsTrains(GRAND, jourGrand(), h('07:12:00')).find((a) => a.numero === 1);
    expect(t1).toMatchObject({ gare: 'saint-gervais', vers: null, part: 0 });
  });

  it('un express : la part se compte jusqu’à SA gare suivante, gares sautées comprises', () => {
    // TRAIN 9 : Motivon 10:57:30 → Nid d'Aigle 11:30:30 (33 min, sans arrêt).
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;
    const t9 = avancementsTrains(GRAND, jour, h('11:14:00')).find((a) => a.numero === 9);
    expect(t9).toMatchObject({ gare: 'motivon', vers: 'nid-daigle' });
    expect(t9?.part).toBeCloseTo(0.5, 5);
  });

  it('un retard déclaré décale le trajet entier : même part, dix minutes plus tard', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 1), { statut: 'retard', retard_min: 10, motif: 'Météo' });
    // À 07:05, le train retardé est encore à quai de son origine.
    expect(avancementsTrains(GRAND, jour, h('07:05:00')).find((a) => a.numero === 1)).toMatchObject(
      { gare: 'le-fayet', vers: null, part: 0 },
    );
    // À 07:15 il a fait la moitié du Fayet → Saint-Gervais (départ réel 07:10).
    const t1 = avancementsTrains(GRAND, jour, h('07:15:00')).find((a) => a.numero === 1);
    expect(t1).toMatchObject({ gare: 'le-fayet', vers: 'saint-gervais' });
    expect(t1?.part).toBeCloseTo(0.5, 5);
  });

  it('la part ne sort JAMAIS de [0, 1], à aucun instant de la journée', () => {
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;
    Object.assign(circ(jour, 11), { statut: 'retard', retard_min: 10, motif: 'Météo' });
    let vus = 0;
    for (let s = h('06:55'); s <= h('18:40'); s += 20) {
      for (const a of avancementsTrains(GRAND, jour, s)) {
        vus++;
        expect(a.part).toBeGreaterThanOrEqual(0);
        expect(a.part).toBeLessThanOrEqual(1);
        // À quai : pas de part ; en route : une gare suivante.
        if (a.vers === null) expect(a.part).toBe(0);
      }
    }
    expect(vus).toBeGreaterThan(1000); // le balayage a bien vu des trains
  });

  it('un train supprimé n’avance pas : il n’est pas en ligne', () => {
    const jour = jourGrand();
    Object.assign(circ(jour, 1), { statut: 'supprime' });
    expect(avancementsTrains(GRAND, jour, h('07:05')).find((a) => a.numero === 1)).toBeUndefined();
  });
});

describe('positionsTrains — la grille du jour n’a pas changé de règle', () => {
  it('mêmes trains, mêmes gares, dans le même ordre — et AUCUNE part de trajet', () => {
    const jour = jourGrand();
    circ(jour, 9).facultatif_actif = true;
    for (const instant of ['07:05', '07:12', '10:50', '11:14', '13:38', '16:20']) {
      const positions = positionsTrains(GRAND, jour, h(instant));
      const avancements = avancementsTrains(GRAND, jour, h(instant));
      expect(positions).toEqual(
        avancements.map(({ numero, sens, rame, gare, vers }) => ({
          numero,
          sens,
          rame,
          gare,
          vers,
        })),
      );
      for (const p of positions) expect(Object.keys(p)).not.toContain('part');
    }
  });
});
