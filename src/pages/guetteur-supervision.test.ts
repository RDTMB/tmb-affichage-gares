// Ce que la supervision DIT de la surveillance.
//
// Deux décisions, toutes deux pures, toutes deux nées du 19/09/2026 :
//   • le bandeau du guetteur — a-t-il tourné ? Sans cette question posée à
//     l'écran, une tâche planifiée inerte et une flotte en bonne santé
//     produisent exactement la même chose : rien ;
//   • la pastille par poste — quelqu'un sera-t-il prévenu ? « En panne » et
//     « en panne, et le courriel n'est pas parti » ne sont pas le même état.
import { describe, expect, it } from 'vitest';

import {
  SEUIL_GUETTEUR_MUET_MS,
  bandeauGuetteur,
  pastilleSurveillance,
} from './supervision-logique';
import { etatSurveillance, SEUIL_DEFAUT_MS } from '../core/surveillance-ecrans';
import type { VeilleNuit } from '../core/types';

const MAINTENANT = Date.parse('2026-09-19T10:00:00+02:00');
const ilYA = (ms: number) => new Date(MAINTENANT - ms).toISOString();

describe('Le bandeau du guetteur', () => {
  it('quinze minutes : deux passages manqués sur une tâche de cinq', () => {
    expect(SEUIL_GUETTEUR_MUET_MS).toBe(900_000);
  });

  it('un passage récent : la surveillance est annoncée ACTIVE, avec son âge', () => {
    const b = bandeauGuetteur(
      { derniere_execution: ilYA(2 * 60_000), dernier_resultat: '6 surveillés, aucun défaut' },
      MAINTENANT,
    );
    expect(b.classe).toBe('ok');
    expect(b.libelle).toBe('Surveillance active — dernier passage il y a 2 min.');
    expect(b.detail).toBe('6 surveillés, aucun défaut');
  });

  it('« jamais tourné » et « ne tourne plus » sont dits DIFFÉREMMENT', () => {
    // Le premier est un déploiement inachevé — migration non jouée, coffre
    // vide — et c'est le cas le plus probable les jours qui suivent la mise
    // en service. Le second est une panne. Les confondre enverrait chercher
    // le mauvais problème.
    const jamais = bandeauGuetteur({ derniere_execution: null }, MAINTENANT);
    const arrete = bandeauGuetteur({ derniere_execution: ilYA(3 * 3_600_000) }, MAINTENANT);
    expect(jamais.classe).toBe('alerte');
    expect(arrete.classe).toBe('alerte');
    expect(jamais.libelle).toContain('JAMAIS lancée');
    expect(arrete.libelle).toContain("À L'ARRÊT");
    expect(arrete.libelle).toContain('3 h 00');
    expect(jamais.libelle).not.toBe(arrete.libelle);
  });

  it('une date illisible vaut « jamais lancée », pas « il y a 56 ans »', () => {
    expect(bandeauGuetteur({ derniere_execution: 'abîmé' }, MAINTENANT).libelle).toContain(
      'JAMAIS lancée',
    );
  });

  it('juste sous le seuil c’est vert, juste au-dessus c’est rouge', () => {
    expect(
      bandeauGuetteur({ derniere_execution: ilYA(SEUIL_GUETTEUR_MUET_MS - 1000) }, MAINTENANT)
        .classe,
    ).toBe('ok');
    expect(
      bandeauGuetteur({ derniere_execution: ilYA(SEUIL_GUETTEUR_MUET_MS) }, MAINTENANT).classe,
    ).toBe('alerte');
  });

  it('le détail du dernier passage est rendu tel quel, même en alerte', () => {
    // C'est là que le guetteur écrit « aucun destinataire » : l'oubli du
    // réglage doit se voir, pas seulement dans les journaux de la fonction.
    const b = bandeauGuetteur(
      { derniere_execution: ilYA(3 * 3_600_000), dernier_resultat: 'aucun destinataire' },
      MAINTENANT,
    );
    expect(b.detail).toBe('aucun destinataire');
  });
});

describe('La pastille d’un poste', () => {
  const VEILLE: VeilleNuit = { debut: '21:00', fin: '06:00' };
  const etat = (silence_ms: number, surveille?: boolean, heure_s = 10 * 3600) =>
    etatSurveillance(
      {
        id: 'saint-gervais-ecran-1',
        gare: 'saint-gervais',
        surveille,
        derniere_vue: ilYA(silence_ms),
      },
      VEILLE,
      MAINTENANT,
      heure_s,
    );

  it('un poste qui bat : « Surveillé », et rien de plus', () => {
    const p = pastilleSurveillance(etat(30_000), true);
    expect(p.classe).toBe('surveille');
    expect(p.libelle).toBe('Surveillé');
  });

  it('un poste décoché le dit, et dit la CONSÉQUENCE', () => {
    // « Hors surveillance » seul laisserait croire à un état d'affichage. Ce
    // qui compte est qu'aucune alerte ne partira.
    const p = pastilleSurveillance(etat(3 * 3_600_000, false), false);
    expect(p.classe).toBe('hors');
    expect(p.libelle).toBe('Hors surveillance — aucune alerte ne partira');
  });

  it('en défaut, alerte partie : l’heure de l’envoi est dite', () => {
    const p = pastilleSurveillance(etat(3 * 3_600_000 + 12 * 60_000), true, {
      envoyee_at: '2026-09-19T08:05:00+02:00',
    });
    expect(p.classe).toBe('defaut');
    expect(p.libelle).toContain('En défaut depuis 3 h 12');
    expect(p.libelle).toContain('alerte envoyée à 08:05');
  });

  it('en défaut, alerte NON partie : c’est écrit en toutes lettres', () => {
    // Le cas de la clé Brevo absente. Sans cette ligne, la supervision
    // afficherait la panne, personne ne recevrait le courriel, et rien ne
    // relierait les deux.
    const p = pastilleSurveillance(etat(20 * 60_000), true, {
      envoyee_at: null,
      dernier_echec: 'BREVO_API_KEY absent',
    });
    expect(p.classe).toBe('defaut');
    expect(p.libelle).toContain('ALERTE NON ENVOYÉE');
    expect(p.libelle).toContain('BREVO_API_KEY absent');
  });

  it('en défaut, guetteur pas encore repassé : on le dit plutôt que de laisser croire à une panne de l’alerte', () => {
    const p = pastilleSurveillance(etat(SEUIL_DEFAUT_MS + 1000), true, undefined);
    expect(p.classe).toBe('defaut');
    expect(p.libelle).toContain('alerte au prochain passage du guetteur');
  });

  it('un envoi RÉUSSI prime sur un échec antérieur du même épisode', () => {
    // La ligne garde `dernier_echec` d'une tentative précédente ; annoncer
    // « non envoyée » après un succès serait faux.
    const p = pastilleSurveillance(etat(20 * 60_000), true, {
      envoyee_at: '2026-09-19T09:50:00+02:00',
      dernier_echec: 'Brevo 503',
    });
    expect(p.libelle).toContain('alerte envoyée à 09:50');
    expect(p.libelle).not.toContain('NON ENVOYÉE');
  });

  it('la nuit, la pastille dit pourquoi elle se tait', () => {
    const p = pastilleSurveillance(etat(4 * 3_600_000, true, 2 * 3600), true);
    expect(p.classe).toBe('repos');
    expect(p.libelle).toContain('En veille de nuit');
    expect(p.libelle).toContain('pas d’alerte avant le matin');
  });

  it('un poste jamais vu est distingué d’un poste en panne', () => {
    const p = pastilleSurveillance(
      etatSurveillance(
        { id: 'x', gare: 'motivon', derniere_vue: null },
        VEILLE,
        MAINTENANT,
        10 * 3600,
      ),
      true,
    );
    expect(p.classe).toBe('repos');
    expect(p.libelle).toBe('Jamais vu — déclaré, pas encore posé');
  });

  it('le décochage l’emporte sur tout, y compris sur une alerte en cours', () => {
    // Un épisode peut survivre un instant à la décoche, le temps du prochain
    // passage du guetteur. La carte ne doit pas annoncer une alerte qui ne
    // repartira plus.
    const p = pastilleSurveillance(etat(3 * 3_600_000, false), false, {
      envoyee_at: '2026-09-19T08:05:00+02:00',
    });
    expect(p.classe).toBe('hors');
  });
});
