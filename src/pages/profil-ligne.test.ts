// Profil de la ligne — géométrie et dessin (src/pages/profil-ligne.ts).
//
// Ce que ces tests protègent : le profil est un DESSIN QUI RENSEIGNE. Une
// gare posée à la mauvaise hauteur, un train dessiné là où il n'est pas, ou
// une couleur de rame injectée telle quelle dans un attribut seraient des
// fautes d'information, pas des défauts d'ornement.
import { describe, expect, it } from 'vitest';
import type { GareGrille, Machine, PositionTrain } from '../core/types';
import { BOITE_PROFIL, pointsProfil, profilSvg, trainsSurProfil } from './profil-ligne';

const GARES: GareGrille[] = [
  { id: 'le-fayet', nom: 'Le Fayet', altitude_m: 580 },
  { id: 'saint-gervais', nom: 'Saint-Gervais', altitude_m: 786 },
  { id: 'motivon', nom: 'Motivon', altitude_m: 1375 },
  { id: 'col-de-voza', nom: 'Col de Voza', altitude_m: 1653 },
  { id: 'bellevue', nom: 'Bellevue', altitude_m: 1794 },
  { id: 'nid-daigle', nom: "Nid d'Aigle", altitude_m: 2412 },
];

const MACHINES: Machine[] = [
  { nom: 'Marie', couleur: '#2E74B5', en_service: true },
  { nom: 'Marguerite', couleur: '#FFFFFF', cercle: '#E52A23', en_service: true },
];

describe('pointsProfil — les gares sur la pente', () => {
  const points = pointsProfil(GARES);

  it('une gare par gare de la grille, dans l’ordre de la ligne', () => {
    expect(points.map((p) => p.id)).toEqual(GARES.map((g) => g.id));
  });

  it('les abscisses avancent régulièrement, de marge à marge', () => {
    const pas = points.slice(1).map((p, i) => p.x - (points[i]?.x ?? 0));
    for (const d of pas) expect(d).toBeCloseTo(pas[0] ?? 0, 0);
    expect(points[0]?.x).toBe(BOITE_PROFIL.margeX);
    expect(points[points.length - 1]?.x).toBe(BOITE_PROFIL.largeur - BOITE_PROFIL.margeX);
  });

  it('plus la gare est haute, plus son point est HAUT (ordonnée plus petite)', () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i]?.y).toBeLessThan(points[i - 1]?.y ?? 0);
    }
  });

  it('les ordonnées sont proportionnelles aux altitudes RÉELLES', () => {
    // Motivon (1 375 m) est à (1375 − 580) / (2412 − 580) = 43,4 % de la montée.
    const [bas, , motivon] = points;
    const haut = points[points.length - 1];
    const part = ((bas?.y ?? 0) - (motivon?.y ?? 0)) / ((bas?.y ?? 0) - (haut?.y ?? 1));
    expect(part).toBeCloseTo((1375 - 580) / (2412 - 580), 2);
  });

  it('le dessin tient dans sa boîte, marges comprises', () => {
    for (const p of points) {
      expect(p.y).toBeGreaterThanOrEqual(BOITE_PROFIL.margeHaut);
      expect(p.y).toBeLessThanOrEqual(BOITE_PROFIL.hauteur - BOITE_PROFIL.margeBas);
    }
  });

  it('au-dessus du sommet du jour, la gare reste dessinée mais éteinte', () => {
    const hiver = pointsProfil(GARES, 'bellevue');
    expect(hiver.map((p) => p.desservie)).toEqual([true, true, true, true, true, false]);
    // Sans sommet connu : la ligne entière, comme sommetDeLaGrille() en repli.
    expect(pointsProfil(GARES, null).every((p) => p.desservie)).toBe(true);
  });

  it('aucune gare, aucun point — et aucune division par zéro à altitude égale', () => {
    expect(pointsProfil([])).toEqual([]);
    const plat = pointsProfil([
      { id: 'le-fayet', nom: 'A', altitude_m: 500 },
      { id: 'saint-gervais', nom: 'B', altitude_m: 500 },
    ]);
    expect(plat.every((p) => Number.isFinite(p.y))).toBe(true);
  });
});

describe('trainsSurProfil — où poser un train', () => {
  const points = pointsProfil(GARES);
  const position = (gare: PositionTrain['gare'], vers: PositionTrain['vers']): PositionTrain => ({
    numero: 9,
    sens: 'montee',
    rame: 'Marie',
    gare,
    vers,
  });

  it('à quai : SUR la gare', () => {
    const [t] = trainsSurProfil(points, [position('motivon', null)]);
    const motivon = points[2];
    expect(t).toMatchObject({ x: motivon?.x, y: motivon?.y, enRoute: false });
  });

  it('en route : À MI-CHEMIN des deux gares, jamais interpolé à l’heure', () => {
    const [t] = trainsSurProfil(points, [position('motivon', 'col-de-voza')]);
    const [a, b] = [points[2], points[3]];
    expect(t?.x).toBeCloseTo(((a?.x ?? 0) + (b?.x ?? 0)) / 2, 0);
    expect(t?.y).toBeCloseTo(((a?.y ?? 0) + (b?.y ?? 0)) / 2, 0);
    expect(t?.enRoute).toBe(true);
  });

  it('un express en route traverse les gares sautées : milieu de SES deux gares', () => {
    const [t] = trainsSurProfil(points, [position('motivon', 'nid-daigle')]);
    expect(t?.x).toBeCloseTo(((points[2]?.x ?? 0) + (points[5]?.x ?? 0)) / 2, 0);
  });

  it('une gare absente du profil : le train n’est PAS dessiné, on n’invente rien', () => {
    const court = pointsProfil(GARES.slice(0, 3));
    expect(trainsSurProfil(court, [position('bellevue', null)])).toEqual([]);
    expect(trainsSurProfil(court, [position('motivon', 'col-de-voza')])).toEqual([]);
  });
});

describe('profilSvg — le dessin', () => {
  it('moins de deux gares : rien, plutôt qu’un point seul', () => {
    expect(profilSvg({ gares: GARES.slice(0, 1) })).toBe('');
  });

  it('la gare du poste est cerclée, et une seule', () => {
    const svg = profilSvg({ gares: GARES, ici: 'col-de-voza' });
    expect(svg.match(/class="profil-ici"/g)).toHaveLength(1);
    expect(svg.match(/class="profil-gare ici"/g)).toHaveLength(1);
    expect(profilSvg({ gares: GARES })).not.toContain('profil-ici');
  });

  it('l’anneau « vous êtes ici » passe SOUS les trains : un train à quai reste visible', () => {
    const svg = profilSvg({
      gares: GARES,
      ici: 'motivon',
      positions: [{ numero: 9, sens: 'montee', rame: 'Marie', gare: 'motivon', vers: null }],
      machines: MACHINES,
    });
    expect(svg.indexOf('profil-ici')).toBeLessThan(svg.indexOf('profil-train'));
  });

  it('les altitudes des deux bouts de la ligne sont écrites, à la française', () => {
    const svg = profilSvg({ gares: GARES });
    expect(svg).toContain('580 m');
    expect(svg).toContain('2 412 m');
    expect(profilSvg({ gares: GARES, altitudes: 'aucune' })).not.toContain('profil-alt');
  });

  it('en hiver, le tronçon au-dessus du sommet est tracé à part, éteint', () => {
    const svg = profilSvg({ gares: GARES, sommet: 'bellevue' });
    expect(svg).toContain('class="profil-voie hors"');
    expect(svg).toContain('class="profil-gare hors"');
    expect(profilSvg({ gares: GARES })).not.toContain('hors');
  });

  it('un train porte la couleur de sa rame, et Marguerite son anneau rouge', () => {
    const svg = profilSvg({
      gares: GARES,
      positions: [
        { numero: 9, sens: 'montee', rame: 'Marie', gare: 'motivon', vers: null },
        { numero: 8, sens: 'descente', rame: 'Marguerite', gare: 'bellevue', vers: 'col-de-voza' },
      ],
      machines: MACHINES,
    });
    expect(svg).toContain('fill="#2E74B5" stroke="#ffffff"');
    expect(svg).toContain('fill="#FFFFFF" stroke="#E52A23"');
    expect(svg).toContain('class="profil-train en-route"');
  });

  it('une couleur mal formée ne sort JAMAIS telle quelle dans un attribut', () => {
    const svg = profilSvg({
      gares: GARES,
      positions: [{ numero: 9, sens: 'montee', rame: 'Pirate', gare: 'motivon', vers: null }],
      machines: [
        {
          nom: 'Pirate',
          couleur: '"/><script>x</script>',
          cercle: 'red" onload="x',
          en_service: true,
        },
      ],
    });
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onload');
    expect(svg).toContain('fill="#708DA4" stroke="#ffffff"');
  });

  it('un nom de gare ou de rame est échappé', () => {
    const svg = profilSvg({
      gares: [
        { id: 'le-fayet', nom: '<b>Fayet</b>', altitude_m: 580 },
        { id: 'saint-gervais', nom: 'Saint-Gervais', altitude_m: 786 },
      ],
      positions: [{ numero: 1, sens: 'montee', rame: '<i>X</i>', gare: 'le-fayet', vers: null }],
    });
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('<i>');
  });
});
