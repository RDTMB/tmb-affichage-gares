// Correctifs d'audit C-03 (a et b) : l'âge des données et la datation de
// l'instantané décident du badge « données de HH:MM » (2 min) et de l'écran
// neutre (15 min). Un âge faux fait passer la journée de la veille pour
// fraîche — une information FAUSSE, pas une absence d'information.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { creeSynchronisation } from './resilience';

const CLE = 'tmb-test-instantane';
const DEBUT = new Date('2026-09-06T10:00:00Z').getTime();

/** localStorage minimal : le test tourne sans DOM. */
function installeStockage(): Map<string, string> {
  const donnees = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (c: string) => donnees.get(c) ?? null,
    setItem: (c: string, v: string) => void donnees.set(c, v),
    removeItem: (c: string) => void donnees.delete(c),
    clear: () => donnees.clear(),
  });
  return donnees;
}

function sync(charge: () => Promise<string>, valide?: (d: string) => string) {
  return creeSynchronisation<string>({
    cleSnapshot: CLE,
    charge,
    applique: () => {},
    ...(valide ? { valide } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DEBUT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('C-03 a — l’âge des données ne vaut jamais « négatif »', () => {
  it('une horloge qui RECULE ne rend pas les données « très fraîches »', async () => {
    installeStockage();
    const s = sync(async () => 'données');
    expect(await s.demarre()).toBe(true);
    expect(s.ageMs()).toBe(0);

    // Le Raspberry n'a pas de pile : au redémarrage sans réseau il repart sur
    // `fake-hwclock`, et l'horloge peut RECULER. Sans bornage, la
    // soustraction devenait négative — donc « plus frais que maintenant », et
    // ni le badge à 2 min ni l'écran neutre à 15 min ne se déclenchaient.
    vi.setSystemTime(DEBUT - 10 * 60_000);
    const age = s.ageMs();
    expect(age).toBe(0);
    expect(age).toBeGreaterThanOrEqual(0);
  });

  it('une horloge qui AVANCE normalement donne bien l’âge écoulé', async () => {
    installeStockage();
    const s = sync(async () => 'données');
    await s.demarre();
    vi.setSystemTime(DEBUT + 3 * 60_000);
    expect(s.ageMs()).toBe(3 * 60_000);
  });

  it('sans aucune synchronisation, l’âge reste null', () => {
    installeStockage();
    expect(sync(async () => 'données').ageMs()).toBeNull();
  });
});

describe('C-03 b — un instantané INDATABLE est traité comme absent', () => {
  /** Le réseau échoue : seul l'instantané peut sauver le démarrage. */
  const horsLigne = async (): Promise<string> => {
    throw new Error('réseau coupé');
  };

  it('cas nominal : un instantané bien daté est appliqué', async () => {
    const stock = installeStockage();
    stock.set(CLE, JSON.stringify({ quand: DEBUT - 60_000, donnees: 'du cache' }));
    const s = sync(horsLigne);
    expect(await s.demarre()).toBe(true);
    expect(s.ageMs()).toBe(60_000);
  });

  it('horodatage NON NUMÉRIQUE : rejeté', async () => {
    const stock = installeStockage();
    stock.set(CLE, JSON.stringify({ quand: 'hier', donnees: 'du cache' }));
    const s = sync(horsLigne);
    // Même comportement qu'une absence d'instantané : écran neutre.
    expect(await s.demarre()).toBe(false);
    expect(s.ageMs()).toBeNull();
  });

  it('horodatage non FINI (NaN, Infinity) : rejeté', async () => {
    const stock = installeStockage();
    // JSON.stringify transforme NaN et Infinity en null : on écrit le JSON
    // à la main pour reproduire un fichier corrompu.
    stock.set(CLE, '{"quand":null,"donnees":"du cache"}');
    expect(await sync(horsLigne).demarre()).toBe(false);
  });

  it('instantané POSTDATÉ de plus d’une minute : rejeté', async () => {
    const stock = installeStockage();
    stock.set(CLE, JSON.stringify({ quand: DEBUT + 5 * 60_000, donnees: 'du futur' }));
    expect(await sync(horsLigne).demarre()).toBe(false);
  });

  it('…mais quelques secondes d’avance restent tolérées', async () => {
    const stock = installeStockage();
    stock.set(CLE, JSON.stringify({ quand: DEBUT + 10_000, donnees: 'du cache' }));
    expect(await sync(horsLigne).demarre()).toBe(true);
  });

  it('instantané de PLUS DE 24 H : rejeté', async () => {
    const stock = installeStockage();
    stock.set(CLE, JSON.stringify({ quand: DEBUT - 25 * 60 * 60_000, donnees: 'avant-hier' }));
    expect(await sync(horsLigne).demarre()).toBe(false);
  });

  it('…et 23 h passent encore', async () => {
    const stock = installeStockage();
    stock.set(CLE, JSON.stringify({ quand: DEBUT - 23 * 60 * 60_000, donnees: 'hier' }));
    expect(await sync(horsLigne).demarre()).toBe(true);
  });

  it('un instantané illisible ne fait pas planter le démarrage', async () => {
    const stock = installeStockage();
    stock.set(CLE, 'ceci n’est pas du JSON');
    expect(await sync(horsLigne).demarre()).toBe(false);
  });

  it('le rejet vaut aussi quand l’horloge a reculé sous l’instantané', async () => {
    // Cas réel : le poste redémarre, `fake-hwclock` le remet une semaine en
    // arrière, et son propre instantané devient « postdaté ». Mieux vaut
    // l'écran neutre que des horaires dont on ne sait pas dater la fraîcheur.
    const stock = installeStockage();
    stock.set(CLE, JSON.stringify({ quand: DEBUT, donnees: 'du cache' }));
    vi.setSystemTime(DEBUT - 7 * 24 * 60 * 60_000);
    expect(await sync(horsLigne).demarre()).toBe(false);
  });
});
