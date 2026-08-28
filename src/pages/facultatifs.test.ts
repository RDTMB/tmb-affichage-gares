// Action groupée sur les facultatifs et rotations appariées (docs/01 §5.1).
import { describe, expect, it } from 'vitest';

import grandServiceJson from '../../public/grilles/2026-ete-grand-service.json';
import { generationJour, passagesPourGare } from '../core/horaires';
import type { Circulation, Grille, Jour } from '../core/types';
import { messagesVisibles } from './affichage-commun';
import {
  actionGroupeeFacultatifs,
  dateEnToutesLettres,
  propositionAppariementFacultatif,
} from './supervision-logique';

const GRAND = grandServiceJson as unknown as Grille;
const DATE = '2026-08-25'; // mardi

function jour(): Jour {
  return generationJour(GRAND, DATE);
}
function circ(j: Jour, numero: number): Circulation {
  const c = j.circulations.find((x) => x.numero === numero);
  if (!c) throw new Error(`circulation ${numero} absente`);
  return c;
}

describe('dateEnToutesLettres', () => {
  it('rend la date en français, sans dérive de fuseau', () => {
    expect(dateEnToutesLettres('2026-08-25')).toBe('mardi 25 août');
    expect(dateEnToutesLettres('2026-01-01')).toBe('jeudi 1 janvier');
  });
});

describe('action groupée sur les facultatifs', () => {
  it('propose d’activer ce qui reste inactif, avec le compte exact et la date', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    expect(facultatifs.length).toBeGreaterThan(1);
    const a = actionGroupeeFacultatifs(j.circulations, DATE);
    expect(a.disponible).toBe(true);
    expect(a.activer).toBe(true);
    expect(a.numeros).toEqual(facultatifs.map((c) => c.numero).sort((x, y) => x - y));
    expect(a.libelle).toBe(`Activer les ${facultatifs.length} trains facultatifs`);
    expect(a.confirmation).toContain(`du mardi 25 août ?`);
    expect(a.confirmation).toContain('apparaîtront immédiatement sur les écrans');
  });

  it('le compte annoncé est celui des trains RÉELLEMENT changés', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    const premier = facultatifs[0];
    if (!premier) throw new Error('aucun facultatif');
    premier.facultatif_actif = true; // déjà activé : hors du compte
    const a = actionGroupeeFacultatifs(j.circulations, DATE);
    expect(a.numeros).not.toContain(premier.numero);
    expect(a.numeros).toHaveLength(facultatifs.length - 1);
  });

  it('bascule en désactivation quand tous sont activés', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    for (const c of facultatifs) c.facultatif_actif = true;
    const a = actionGroupeeFacultatifs(j.circulations, DATE);
    expect(a.activer).toBe(false);
    expect(a.libelle).toBe(`Désactiver les ${facultatifs.length} trains facultatifs`);
    expect(a.confirmation).toContain('disparaîtront immédiatement des écrans');
    expect(a.numeros).toHaveLength(facultatifs.length);
  });

  it('journée sans aucun facultatif : bouton indisponible et mention explicite', () => {
    const a = actionGroupeeFacultatifs(
      jour().circulations.filter((c) => !c.facultatif),
      DATE,
    );
    expect(a.disponible).toBe(false);
    expect(a.libelle).toBe('Aucun train facultatif ce jour');
    expect(a.numeros).toEqual([]);
  });

  it('un seul facultatif : libellé au singulier', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    const garde = facultatifs[0]?.numero;
    const a = actionGroupeeFacultatifs(
      j.circulations.filter((c) => !c.facultatif || c.numero === garde),
      DATE,
    );
    expect(a.libelle).toBe('Activer le train facultatif');
  });

  it('l’action groupée ne touche JAMAIS le drapeau « sans voyageurs »', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    const cible = facultatifs[0];
    if (!cible) throw new Error('aucun facultatif');
    cible.sans_voyageurs = true;
    const a = actionGroupeeFacultatifs(j.circulations, DATE);
    // Reproduit exactement l'écriture du contrôleur : copie + facultatif_actif
    const ecrites = a.numeros
      .map((n) => circ(j, n))
      .map((c) => ({ ...c, facultatif_actif: a.activer }));
    expect(ecrites.every((c) => c.facultatif_actif === true)).toBe(true);
    expect(ecrites.find((c) => c.numero === cible.numero)?.sans_voyageurs).toBe(true);
    // Aucune autre course à vide n'a été inventée
    expect(ecrites.filter((c) => c.sans_voyageurs).map((c) => c.numero)).toEqual([cible.numero]);
  });
});

describe('rotations appariées à l’activation unitaire', () => {
  // Rotations facultatives du grand service : 3/4, 9/10, 17/18, 23/24
  it('activer une montée facultative propose sa descente appariée', () => {
    const j = jour();
    circ(j, 3).facultatif_actif = true;
    const p = propositionAppariementFacultatif(j.circulations, 3, true);
    expect(p?.numero).toBe(4);
    expect(p?.actif).toBe(true);
    expect(p?.question).toContain('la descente appariée (TRAIN 4)');
    expect(p?.question).toContain('sans train pour les redescendre');
  });

  it('désactiver une montée propose la même opération sur la descente', () => {
    const j = jour();
    circ(j, 3).facultatif_actif = false;
    circ(j, 4).facultatif_actif = true;
    const p = propositionAppariementFacultatif(j.circulations, 3, false);
    expect(p?.numero).toBe(4);
    expect(p?.actif).toBe(false);
  });

  it('l’appariement marche aussi depuis la descente', () => {
    const j = jour();
    circ(j, 4).facultatif_actif = true;
    const p = propositionAppariementFacultatif(j.circulations, 4, true);
    expect(p?.numero).toBe(3);
    expect(p?.question).toContain('la montée appariée (TRAIN 3)');
  });

  it('aucune proposition si la descente appariée est SANS VOYAGEURS', () => {
    const j = jour();
    circ(j, 4).sans_voyageurs = true; // rotation assurée, à vide
    circ(j, 3).facultatif_actif = true;
    expect(propositionAppariementFacultatif(j.circulations, 3, true)).toBeNull();
  });

  it('aucune proposition si l’apparié est déjà dans l’état visé', () => {
    const j = jour();
    circ(j, 3).facultatif_actif = true;
    circ(j, 4).facultatif_actif = true;
    expect(propositionAppariementFacultatif(j.circulations, 3, true)).toBeNull();
  });

  it('aucune proposition pour un train qui n’est pas facultatif', () => {
    const j = jour();
    expect(circ(j, 1).facultatif).toBe(false);
    expect(propositionAppariementFacultatif(j.circulations, 1, true)).toBeNull();
  });
});

describe('messages ciblant un train à vide', () => {
  it('un message attaché à un train sans voyageurs ne s’affiche jamais', () => {
    const j = jour();
    const cible = 5;
    const message = {
      id: 'm1',
      texte_fr: 'Correspondance assurée',
      texte_en: '',
      cible_type: 'train' as const,
      gares: [],
      train_numero: cible,
      priorite: 'normale' as const,
      actif: true,
      expire_at: null,
    };
    const maintenant = 0;

    const visiblesAvant = messagesVisibles(
      [message],
      'saint-gervais',
      passagesPourGare(GRAND, j, 'saint-gervais'),
      maintenant,
    );
    expect(visiblesAvant).toHaveLength(1);

    circ(j, cible).sans_voyageurs = true;
    const visiblesApres = messagesVisibles(
      [message],
      'saint-gervais',
      passagesPourGare(GRAND, j, 'saint-gervais'),
      maintenant,
    );
    expect(visiblesApres).toEqual([]);
  });
});

describe('correctifs issus de l’audit adversarial', () => {
  it('la confirmation prévient qu’un facultatif à vide restera invisible', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    const cible = facultatifs[0];
    if (!cible) throw new Error('aucun facultatif');
    cible.sans_voyageurs = true;

    const a = actionGroupeeFacultatifs(j.circulations, DATE);
    expect(a.aVide).toEqual([cible.numero]);
    expect(a.confirmation).toContain(`TRAIN ${cible.numero} : sans voyageurs`);
    expect(a.confirmation).toContain('restera invisible');
  });

  it('aucune réserve superflue quand aucun train à vide n’est concerné', () => {
    const a = actionGroupeeFacultatifs(jour().circulations, DATE);
    expect(a.aVide).toEqual([]);
    expect(a.confirmation).not.toContain('sans voyageurs');
  });

  it('la réserve ne s’affiche pas à la DÉSACTIVATION (rien n’apparaît)', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    for (const c of facultatifs) c.facultatif_actif = true;
    const cible = facultatifs[0];
    if (!cible) throw new Error('aucun facultatif');
    cible.sans_voyageurs = true;

    const a = actionGroupeeFacultatifs(j.circulations, DATE);
    expect(a.activer).toBe(false);
    expect(a.aVide).toEqual([cible.numero]);
    expect(a.confirmation).not.toContain('restera invisible');
  });

  it('la réserve s’accorde au pluriel', () => {
    const j = jour();
    const facultatifs = j.circulations.filter((c) => c.facultatif);
    facultatifs.slice(0, 2).forEach((c) => (c.sans_voyageurs = true));
    const a = actionGroupeeFacultatifs(j.circulations, DATE);
    expect(a.aVide).toHaveLength(2);
    expect(a.confirmation).toContain('ils resteront invisibles');
  });
});
