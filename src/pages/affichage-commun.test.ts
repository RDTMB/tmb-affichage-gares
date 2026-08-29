// Bandeau voyageurs : quand l'anglais manque (traduction indisponible), le
// français doit s'afficher SEUL — sans séparateur orphelin ni bloc vide, et
// jamais de faux anglais fabriqué.
import { describe, expect, it, vi } from 'vitest';

import type { Message } from '../core/types';
import { contenuTicker, creeJournalHeartbeat, INTERVALLE_HEARTBEAT_MS } from './affichage-commun';
import { identifiantEcran, identifiantEcranDeclare } from './supervision-logique';

function message(id: string, fr: string, en: string): Message {
  return {
    id,
    texte_fr: fr,
    texte_en: en,
    cible_type: 'toutes',
    priorite: 'normale',
    actif: true,
  };
}

describe('contenuTicker', () => {
  it('affiche « FR • EN » quand la traduction existe', () => {
    const html = contenuTicker([
      message('a', 'Réservation obligatoire.', 'Booking is compulsory.'),
    ]);
    expect(html).toContain('Réservation obligatoire.');
    expect(html).toContain('class="sep"');
    expect(html).toContain('Booking is compulsory.');
  });

  it('n’affiche QUE le français quand texte_en est vide : aucun séparateur orphelin', () => {
    const html = contenuTicker([message('a', 'Quai glissant, soyez prudents.', '')]);
    expect(html).toBe('Quai glissant, soyez prudents.');
    expect(html).not.toContain('class="sep"');
    expect(html).not.toContain('class="en"');
  });

  it('traite de la même façon un anglais réduit à des espaces', () => {
    expect(contenuTicker([message('a', 'Texte français.', '   ')])).toBe('Texte français.');
  });

  it('n’affiche jamais un préfixe « [EN] » fabriqué', () => {
    const html = contenuTicker([message('a', 'Phrase inconnue du dictionnaire.', '')]);
    expect(html).not.toContain('[EN]');
  });

  it('sépare plusieurs messages, y compris mixtes (traduits et non traduits)', () => {
    const html = contenuTicker([
      message('a', 'Un.', 'One.'),
      message('b', 'Deux.', ''),
      message('c', 'Trois.', 'Three.'),
    ]);
    expect(html.split('<span class="sep">◆</span>')).toHaveLength(3);
    // Le message non traduit n'apporte ni « • » ni bloc anglais
    expect(html.match(/class="en"/g)).toHaveLength(2);
    expect(html.match(/<span class="sep">•<\/span>/g)).toHaveLength(2);
  });

  it('échappe le HTML des deux langues', () => {
    const html = contenuTicker([message('a', '<b>fr</b> & "x"', "<i>en</i> & 'y'")]);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&amp;');
  });
});

describe('Signal de vie : un échec ne doit jamais interrompre l’affichage', () => {
  it('trace une fois par cause, sans jamais lever', () => {
    const traces: string[] = [];
    const espion = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
      traces.push(String(m));
    });
    const journalise = creeJournalHeartbeat();

    // Même cause répétée à chaque cycle : une seule trace (18 h/jour de kiosque)
    for (let i = 0; i < 50; i += 1) {
      expect(() => journalise(new Error('réseau injoignable'))).not.toThrow();
    }
    expect(traces).toHaveLength(1);
    expect(traces[0]).toContain('réseau injoignable');
    expect(traces[0]).toContain('réessai au prochain cycle');

    // Une cause DIFFÉRENTE mérite sa trace
    journalise(new Error('Écran « le-fayet-ecran-1 » non déclaré en supervision'));
    expect(traces).toHaveLength(2);
    expect(traces[1]).toContain('non déclaré');

    // Une valeur qui n'est pas une Error ne casse rien non plus
    expect(() => journalise('panne')).not.toThrow();
    expect(traces).toHaveLength(3);
    espion.mockRestore();
  });

  it('la cadence du signal de vie est celle attendue par la supervision', () => {
    expect(INTERVALLE_HEARTBEAT_MS).toBe(60_000);
  });
});

describe('Identifiant de poste : déclaration et écran tombent sur la même chaîne', () => {
  it('la convention est partagée', () => {
    expect(identifiantEcranDeclare('ecran', 'le-fayet')).toBe('le-fayet-ecran-1');
    expect(identifiantEcranDeclare('grille', 'bellevue', 2)).toBe('bellevue-grille-2');
    // Ce que l'écran calcule pour lui-même doit être déclarable à l'identique
    expect(identifiantEcran('ecran', 'motivon', null)).toBe(
      identifiantEcranDeclare('ecran', 'motivon'),
    );
    expect(identifiantEcran('grille', 'col-de-voza', null)).toBe(
      identifiantEcranDeclare('grille', 'col-de-voza'),
    );
  });

  it('le paramètre ?ecran= reste prioritaire (poste nommé à la main)', () => {
    expect(identifiantEcran('ecran', 'le-fayet', 'hall-principal')).toBe('hall-principal');
  });
});
