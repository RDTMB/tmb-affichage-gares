// Bandeau voyageurs : quand l'anglais manque (traduction indisponible), le
// français doit s'afficher SEUL — sans séparateur orphelin ni bloc vide, et
// jamais de faux anglais fabriqué.
import { describe, expect, it } from 'vitest';

import type { Message } from '../core/types';
import { contenuTicker } from './affichage-commun';

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
