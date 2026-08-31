// C-02 — Le mode démonstration ne doit JAMAIS s'appliquer implicitement à une
// page vue par un voyageur. Sans configuration et sans `?demo=1` explicite,
// une page d'affichage ne construit aucun fournisseur : elle montre l'écran
// neutre. Le mock peint en effet une journée de démonstration (retard inventé,
// train supprimé) par-dessus les VRAIES grilles officielles : l'affichage est
// crédible et pourtant faux.
import { describe, expect, it } from 'vitest';

import { estModeDemo, modeDonnees } from './config';

describe('estModeDemo — la démonstration se demande EXPLICITEMENT', () => {
  it('reconnaît `?demo=1`, et lui seul', () => {
    expect(estModeDemo(new URLSearchParams('demo=1'))).toBe(true);
    expect(estModeDemo(new URLSearchParams('gare=le-fayet&demo=1'))).toBe(true);
  });

  it('une faute de frappe n’ouvre PAS la porte aux horaires fictifs', () => {
    for (const q of ['demo', 'demo=true', 'demo=0', 'demo=oui', 'Demo=1', 'demo=11', '']) {
      expect(estModeDemo(new URLSearchParams(q))).toBe(false);
    }
  });
});

describe('modeDonnees — que fait une page d’affichage selon ce dont elle dispose', () => {
  it('configuration présente : données RÉELLES', () => {
    expect(modeDonnees(true, false)).toBe('reel');
  });

  it('sans configuration et sans demande : AUCUNE source — écran neutre', () => {
    // C'est le correctif : autrefois, ce cas retombait silencieusement sur la
    // démonstration et annonçait en gare un retard et une suppression inventés.
    expect(modeDonnees(false, false)).toBe('aucune');
  });

  it('sans configuration mais démonstration demandée : mode démo assumé', () => {
    expect(modeDonnees(false, true)).toBe('demo');
  });

  it('une URL de démonstration ne peut JAMAIS masquer la vraie source', () => {
    // Un paramètre d'URL ne doit pas pouvoir substituer des horaires fictifs à
    // des horaires réels sur un écran qui dispose de la vraie source.
    expect(modeDonnees(true, true)).toBe('reel');
  });
});
