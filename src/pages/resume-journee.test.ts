// Barre du jour de l'onglet Circulations : libellés et compteurs.
//
// L'agent ne voyait qu'un champ date au format ISO — le premier moyen de
// travailler sur le mauvais jour sans s'en apercevoir — et l'étiquette de
// service se tronquait faute de place. Ces libellés vivent désormais dans une
// fonction PURE, couverte par les cas d'exploitation réels.
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../docs/grilles-historique/2026-ete-grand-service.json';
import petitServiceJson from '../../docs/grilles-historique/2026-ete-petit-service.json';
import { generationJour } from '../core/horaires';
import type { Circulation, Grille, Jour } from '../core/types';
import { resumeJournee } from './supervision-logique';

const GRAND = grandServiceJson as unknown as Grille;
const PETIT = petitServiceJson as unknown as Grille;
const EN_GRAND = '2026-08-15';
const EN_PETIT = '2026-09-10';

function jourGrand(partiel: Partial<Jour> = {}): Jour {
  return { ...generationJour(GRAND, EN_GRAND), ...partiel };
}

/** Rotation supplémentaire minimale, telle qu'elle vit en base. */
function sup(numero: number): Circulation[] {
  const base: Circulation = {
    date: EN_GRAND,
    numero,
    sens: 'montee',
    express: false,
    facultatif: false,
    facultatif_actif: false,
    velos: false,
    rame: 'Marie',
    terminus: 'nid-daigle',
    statut: 'ok',
    retard_min: 0,
    motif: null,
    sans_voyageurs: false,
    supplementaire: true,
    passages: [
      { gare: 'le-fayet', d: '11:20:00' },
      { gare: 'col-de-voza', a: '12:00:00' },
    ],
  };
  return [base, { ...base, numero: numero + 1, sens: 'descente' }];
}

// ---------------------------------------------------------------------------

describe('Date en toutes lettres', () => {
  it('porte le jour, la date ET l’année', () => {
    // Sans l'année, préparer la saison suivante en consultant la précédente
    // se fait à l'aveugle.
    expect(resumeJournee(jourGrand(), GRAND).jourEnLettres).toBe('samedi 15 août 2026');
  });

  it('ne dérive pas de fuseau en début de mois', () => {
    const j = { ...generationJour(PETIT, '2026-09-01'), date: '2026-09-01' };
    expect(resumeJournee(j, PETIT).jourEnLettres).toBe('mardi 1 septembre 2026');
  });
});

describe('Étiquette de service', () => {
  it('grand service : une seule période', () => {
    expect(resumeJournee(jourGrand(), GRAND).service).toBe('Grand service (04/07→30/08)');
  });

  it('petit service : les DEUX périodes, en entier', () => {
    // C'est ce libellé que la barre tronquait : il doit sortir complet.
    const j = generationJour(PETIT, EN_PETIT);
    expect(resumeJournee(j, PETIT).service).toBe('Petit service (13/06→03/07 · 31/08→27/09)');
  });

  it('hors saison : dit qu’aucun service ne circule', () => {
    const j = jourGrand({ hors_saison: true });
    expect(resumeJournee(j, null).service).toBe('Hors saison / service hiver');
    expect(resumeJournee(j, null).etat).toBe('hors-saison');
    expect(resumeJournee(j, null).etatLibelle).toBe('aucun service ne circule');
  });
});

describe('État de la journée', () => {
  it('enregistrée par défaut', () => {
    const r = resumeJournee(jourGrand(), GRAND);
    expect(r.etat).toBe('enregistree');
    expect(r.etatLibelle).toBe('journée enregistrée');
  });

  it('journée NON enregistrée : aperçu théorique, et la lecture seule est dite', () => {
    const r = resumeJournee(jourGrand({ enregistre: false }), GRAND);
    expect(r.etat).toBe('apercu');
    expect(r.etatLibelle).toContain('aperçu théorique');
    expect(r.etatLibelle).toContain('lecture seule');
  });

  it('hors saison l’emporte sur « non enregistrée »', () => {
    // Les deux peuvent coexister ; c'est l'absence de service qui explique le
    // mieux ce que l'agent a sous les yeux.
    const r = resumeJournee(jourGrand({ enregistre: false, hors_saison: true }), null);
    expect(r.etat).toBe('hors-saison');
  });
});

describe('Compteur des trains facultatifs', () => {
  it('aucun activé au départ : « 0 activés sur N »', () => {
    const r = resumeJournee(jourGrand(), GRAND);
    expect(r.facultatifsActifs).toBe(0);
    expect(r.facultatifsTotal).toBeGreaterThan(0);
    expect(r.facultatifsLibelle).toBe(`0 activés sur ${r.facultatifsTotal}`);
  });

  it('compte ceux qui sont réellement activés', () => {
    const j = jourGrand();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    facultatifs[0]!.facultatif_actif = true;
    facultatifs[1]!.facultatif_actif = true;
    facultatifs[2]!.facultatif_actif = true;
    const r = resumeJournee(j, GRAND);
    expect(r.facultatifsActifs).toBe(3);
    expect(r.facultatifsLibelle).toBe(`3 activés sur ${facultatifs.length}`);
  });

  it('AUCUN facultatif ce jour : on le dit, plutôt que « 0 sur 0 »', () => {
    const j = jourGrand();
    for (const c of j.circulations) c.facultatif = false;
    const r = resumeJournee(j, GRAND);
    expect(r.facultatifsTotal).toBe(0);
    expect(r.facultatifsLibelle).toBe('aucun ce jour');
  });
});

describe('Compteur des trains supplémentaires', () => {
  it('aucun : le compteur reste VIDE, pas « 0 ce jour »', () => {
    // Un compteur à zéro affiché en permanence est du bruit dans la barre.
    const r = resumeJournee(jourGrand(), GRAND);
    expect(r.sups).toBe(0);
    expect(r.supsLibelle).toBe('');
  });

  it('une rotation compte pour UN renfort, pas deux trains', () => {
    const j = jourGrand();
    j.circulations.push(...sup(101));
    const r = resumeJournee(j, GRAND);
    expect(r.sups).toBe(1);
    expect(r.supsLibelle).toBe('1 ce jour');
  });

  it('plusieurs renforts', () => {
    const j = jourGrand();
    j.circulations.push(...sup(101), ...sup(103), ...sup(105));
    const r = resumeJournee(j, GRAND);
    expect(r.sups).toBe(3);
    expect(r.supsLibelle).toBe('3 ce jour');
  });
});

describe('Réglages actifs : ce qui doit être mis en évidence', () => {
  it('ligne entière et aucun terminus : rien d’actif', () => {
    const r = resumeJournee(jourGrand(), GRAND);
    expect(r.sectionRestreinte).toBe(false);
    expect(r.terminusActif).toBe(false);
  });

  it('section restreinte : signalée', () => {
    const r = resumeJournee(jourGrand({ gare_debut: 'col-de-voza' }), GRAND);
    expect(r.sectionRestreinte).toBe(true);
  });

  it('restreinte par le HAUT aussi', () => {
    expect(resumeJournee(jourGrand({ gare_fin: 'bellevue' }), GRAND).sectionRestreinte).toBe(true);
  });

  it('des bornes absentes (instantané ancien) ne se lisent PAS comme une restriction', () => {
    // `sectionDuJour()` retombe sur la ligne complète : la barre ne doit pas
    // annoncer des travaux imaginaires.
    const ancien = { ...jourGrand() } as Partial<Jour>;
    delete ancien.gare_debut;
    delete ancien.gare_fin;
    expect(resumeJournee(ancien as Jour, GRAND).sectionRestreinte).toBe(false);
  });

  it('terminus Bellevue actif : signalé', () => {
    const r = resumeJournee(jourGrand({ terminus_bellevue: { a_partir_du_train: 9 } }), GRAND);
    expect(r.terminusActif).toBe(true);
  });

  it('les deux à la fois', () => {
    const r = resumeJournee(
      jourGrand({ gare_debut: 'col-de-voza', terminus_bellevue: { a_partir_du_train: 1 } }),
      GRAND,
    );
    expect(r.sectionRestreinte).toBe(true);
    expect(r.terminusActif).toBe(true);
  });
});
