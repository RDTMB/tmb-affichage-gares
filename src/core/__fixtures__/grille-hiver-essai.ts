// Grille d'HIVER d'essai, construite depuis l'été 2026 : montées coupées à
// Bellevue (terminus NORMAL de l'hiver), express retirés. Même construction
// que hiver-bellevue.test.ts et terminus-par-gare.test.ts — réservée aux tests.
import grandServiceJson from '../../../docs/grilles-historique/2026-ete-grand-service.json';
import type { Grille, PassageGrille, TrainGrille } from '../types';

export const ETE = grandServiceJson as unknown as Grille;

export function grilleHiver(): Grille {
  const tronqueMontee = (t: TrainGrille): TrainGrille => {
    const index = t.passages.findIndex((p) => p.gare === 'bellevue');
    const passages: PassageGrille[] = t.passages.slice(0, index + 1).map((p, i, liste) => {
      if (i !== liste.length - 1) return { ...p };
      const { d: _d, ...sansDepart } = p;
      return sansDepart;
    });
    return { ...t, passages };
  };
  const tronqueDescente = (t: TrainGrille): TrainGrille => {
    const index = t.passages.findIndex((p) => p.gare === 'bellevue');
    const passages: PassageGrille[] = t.passages.slice(index).map((p, i) => {
      if (i !== 0) return { ...p };
      const { a: _a, ...sansArrivee } = p;
      return sansArrivee;
    });
    return { ...t, passages };
  };
  return {
    ...ETE,
    version: '2026-2027-hiver',
    libelle: 'Hiver 2026-2027',
    periodes: [{ du: '2026-12-01', au: '2027-04-11' }],
    montees: ETE.montees.filter((t) => !t.express).map(tronqueMontee),
    descentes: ETE.descentes
      .filter((t) => !t.express && ETE.montees.some((m) => m.numero === t.numero - 1 && !m.express))
      .map(tronqueDescente),
  };
}
