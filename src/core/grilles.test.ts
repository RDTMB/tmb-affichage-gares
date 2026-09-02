// Grilles enregistrées en base : le contenu jsonb n'est jamais cru sur parole
// (C-01). La ligne fait foi sur le contenu pour ce que l'exploitant pilote.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import petitServiceJson from '../../public/grilles/2026-ete-petit-service.json';
import {
  contenuGrilleValide,
  contenuSansMetadonnees,
  estPeriode,
  grilleDepuisEnregistrement,
  type EnregistrementGrille,
} from './grilles';
import type { Grille } from './types';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;

function ligne(surcharge: Partial<EnregistrementGrille> = {}): EnregistrementGrille {
  return {
    version: GRAND.version,
    libelle: GRAND.libelle,
    source: GRAND.source ?? null,
    periodes: GRAND.periodes,
    actif: true,
    cree_le: '2026-09-02T10:00:00+00:00',
    cree_par: 'agent@tramwaydumontblanc.fr',
    commentaire: null,
    contenu: GRAND,
    ...surcharge,
  };
}

describe('grilleDepuisEnregistrement', () => {
  it('reconstitue la grille officielle à l’identique, métadonnées comprises', () => {
    const g = grilleDepuisEnregistrement(ligne());
    expect(g.montees).toEqual(GRAND.montees);
    expect(g.descentes).toEqual(GRAND.descentes);
    expect(g.periodes).toEqual(GRAND.periodes);
    expect(g.gares).toEqual(GRAND.gares);
    expect(g.arret_intermediaire_s).toBe(60);
    expect(g).toMatchObject({
      version: GRAND.version,
      libelle: GRAND.libelle,
      actif: true,
      cree_le: '2026-09-02T10:00:00+00:00',
      cree_par: 'agent@tramwaydumontblanc.fr',
    });
  });

  it('la ligne fait foi sur le contenu : libellé, périodes, activité', () => {
    const g = grilleDepuisEnregistrement(
      ligne({
        libelle: 'Grand service — été 2026 (corrigé)',
        periodes: [{ du: '2026-07-10', au: '2026-07-20' }],
        actif: false,
      }),
    );
    expect(g.libelle).toBe('Grand service — été 2026 (corrigé)');
    expect(g.periodes).toEqual([{ du: '2026-07-10', au: '2026-07-20' }]);
    expect(g.actif).toBe(false);
  });

  it('refuse un contenu illisible avec un message qui nomme la grille', () => {
    expect(() => grilleDepuisEnregistrement(ligne({ contenu: {} }))).toThrow(
      /2026-ete-grand-service.*illisible/,
    );
    expect(() => grilleDepuisEnregistrement(ligne({ contenu: null }))).toThrow(/illisible/);
    expect(() =>
      grilleDepuisEnregistrement(ligne({ contenu: { ...GRAND, montees: [{ numero: 'un' }] } })),
    ).toThrow(/illisible/);
    // Une gare inconnue du moteur (la halte de service) rend la grille inutilisable
    expect(() =>
      grilleDepuisEnregistrement(
        ligne({
          contenu: {
            ...GRAND,
            descentes: [
              {
                numero: 2,
                passages: [
                  { gare: 'mont-lachat', d: '08:00:00' },
                  { gare: 'le-fayet', a: '09:00:00' },
                ],
              },
            ],
          },
        }),
      ),
    ).toThrow(/illisible/);
  });

  it('un drapeau absent vaut false, un repli d’arrêt absent vaut 60 s, des périodes vides reprennent celles du contenu', () => {
    const contenu = {
      ...GRAND,
      arret_intermediaire_s: undefined,
      montees: GRAND.montees.map(({ numero, passages }) => ({ numero, passages })),
    };
    const g = grilleDepuisEnregistrement(ligne({ contenu, periodes: [] }));
    expect(g.arret_intermediaire_s).toBe(60);
    expect(g.montees.every((m) => !m.express && !m.facultatif && !m.velos)).toBe(true);
    expect(g.montees.map((m) => m.passages)).toEqual(GRAND.montees.map((m) => m.passages));
    expect(g.periodes).toEqual(GRAND.periodes);
  });

  it('des périodes mal formées dans la ligne sont écartées', () => {
    const g = grilleDepuisEnregistrement(
      ligne({
        periodes: [
          { du: '2026-13-40', au: 'x' },
          { du: '2026-07-04', au: '2026-08-30' },
        ],
      }),
    );
    expect(g.periodes).toEqual([{ du: '2026-07-04', au: '2026-08-30' }]);
    expect(estPeriode({ du: '2026-08-31', au: '2026-06-13' })).toBe(false); // fin avant début
  });
});

describe('contenuSansMetadonnees / contenuGrilleValide', () => {
  it('retire actif, cree_le, cree_par et commentaire sans toucher au reste', () => {
    const g: Grille = { ...PETIT, actif: false, cree_le: 'x', cree_par: 'y', commentaire: 'z' };
    const c = contenuSansMetadonnees(g);
    expect(c).toEqual(PETIT);
    expect(Object.keys(c)).not.toContain('actif');
    expect(Object.keys(c)).not.toContain('cree_le');
  });

  it('accepte les deux grilles officielles, refuse un train sans passages', () => {
    expect(contenuGrilleValide(GRAND)).toBe(true);
    expect(contenuGrilleValide(PETIT)).toBe(true);
    expect(contenuGrilleValide({ ...GRAND, montees: [{ numero: 1, passages: [] }] })).toBe(false);
  });
});
