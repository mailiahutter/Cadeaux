// Scénario navigateur à 3 téléphones (app servie sur :4173, branchée sur un Supabase local).
// Lancement : node tests/e2e-trois-telephones.cjs <dossier-captures>
const { chromium, devices } = require('playwright');
const OUT = process.argv[2];
const BASE = 'http://localhost:4173/';
const log = (...a) => console.log('•', ...a);
(async () => {
  const browser = await chromium.launch();
  const mk = async (dev) => {
    const ctx = await browser.newContext({ ...devices[dev], locale: 'fr-FR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('PAGEERROR', dev, e.message));
    p.on('dialog', async (d) => d.type() === 'prompt' ? d.accept('5555') : d.accept());
    return { ctx, p };
  };
  const A = await mk('iPhone 13');
  const B = await mk('Pixel 7');
  const C = await mk('Galaxy S9+');

  // Alice crée le groupe
  await A.p.goto(BASE);
  await A.p.getByText('Créer un groupe').click();
  await A.p.getByLabel('Nom du groupe').fill('Famille Martin');
  await A.p.getByLabel('Ton prénom').fill('Alice');
  await A.p.getByLabel(/Code secret/).fill('1111');
  await A.p.getByLabel(/anniversaire/).fill('1990-12-24');
  await A.p.getByRole('button', { name: 'Créer le groupe' }).click();
  await A.p.getByText('Groupe créé !').waitFor();
  const link = await A.p.locator('.linkbox').inputValue();
  log('Lien :', link.replace(/#\/g\/[^/]+\/[^/]+/, '#/g/<groupe>/<clé>'));
  await A.p.screenshot({ path: `${OUT}/1-alice-invitation.png` });

  // Bob et Carla rejoignent via le lien
  for (const [P, name, pin] of [[B, 'Bob', '2222'], [C, 'Carla', '3333']]) {
    await P.p.goto(link);
    await P.p.getByText('Je ne suis pas dans la liste').click();
    await P.p.getByLabel('Ton prénom').fill(name);
    await P.p.getByLabel(/code secret/i).fill(pin);
    await P.p.getByRole('button', { name: 'Rejoindre' }).click();
    await P.p.getByText(`Bonjour ${name} !`).waitFor();
  }
  log('Bob et Carla ont rejoint');

  // Alice ajoute deux souhaits
  await A.p.getByRole('button', { name: /Ma liste/ }).last().click();
  for (const [t, price] of [['Vélo de route', '400 €'], ['Livre de cuisine', '25 €']]) {
    await A.p.getByText('Ajouter un souhait').click();
    await A.p.getByLabel('Quoi ?').fill(t);
    await A.p.getByLabel(/Prix/).fill(price);
    await A.p.getByRole('button', { name: 'Enregistrer' }).click();
    await A.p.getByText(t).waitFor();
  }

  // Bob voit la liste d'Alice EN DIRECT (sans recharger)
  await B.p.getByText('2 cadeaux · 0 déjà pris').waitFor({ timeout: 10000 });
  log('Bob voit la liste d’Alice se mettre à jour en direct');
  await B.p.getByRole('button', { name: /^Alice/ }).click();
  const veloB = B.p.locator('.item', { hasText: 'Vélo de route' });
  await veloB.getByText('Je le prends').click();
  await veloB.getByText('Pris par toi').waitFor();
  log('Bob prend le vélo');

  // Carla voit le vélo coché/rayé "Pris par Bob" en direct, ajoute une idée hors liste
  await C.p.getByText('2 cadeaux · 1 déjà pris').waitFor({ timeout: 10000 });
  await C.p.getByRole('button', { name: /^Alice/ }).click();
  const veloC = C.p.locator('.item', { hasText: 'Vélo de route' });
  await veloC.getByText('Pris par Bob').waitFor();
  const crossed = await veloC.evaluate((el) => el.classList.contains('crossed') && getComputedStyle(el.querySelector('.item-title a, .item-title')).textDecorationLine);
  log('Carla voit le vélo rayé :', crossed);
  await C.p.getByText(/Idée cadeau hors liste pour Alice/).click();
  await C.p.getByLabel('Quoi ?').fill('Week-end spa');
  await C.p.getByRole('button', { name: 'Enregistrer' }).click();
  await C.p.getByText('Week-end spa').waitFor();
  // Cadeau commun lancé par Carla sur le livre, Bob participe
  await C.p.locator('.item', { hasText: 'Livre de cuisine' }).getByText('Cadeau commun').click();
  await C.p.locator('.item', { hasText: 'Livre de cuisine' }).getByText(/Cadeau commun : toi/).waitFor();
  await B.p.locator('.item', { hasText: 'Livre de cuisine' }).getByText('Participer').click({ timeout: 10000 });
  await B.p.locator('.item', { hasText: 'Livre de cuisine' }).getByText('Cadeau commun : Carla, toi').waitFor();
  await B.p.getByText('Week-end spa').waitFor({ timeout: 10000 });
  await C.p.screenshot({ path: `${OUT}/2-carla-liste-alice.png`, fullPage: true });
  await B.p.screenshot({ path: `${OUT}/3-bob-liste-alice.png`, fullPage: true });

  // Conflit : Bob et Carla tentent tous deux de prendre un même cadeau
  await A.p.getByText('Ajouter un souhait').click();
  await A.p.getByLabel('Quoi ?').fill('Écharpe');
  await A.p.getByRole('button', { name: 'Enregistrer' }).click();
  const eB = B.p.locator('.item', { hasText: 'Écharpe' });
  const eC = C.p.locator('.item', { hasText: 'Écharpe' });
  await eB.waitFor({ timeout: 10000 }); await eC.waitFor({ timeout: 10000 });
  await Promise.all([eB.getByText('Je le prends').click(), eC.getByText('Je le prends').click()]);
  await B.p.waitForTimeout(1500);
  const toasts = [await B.p.locator('.toast').textContent().catch(() => ''), await C.p.locator('.toast').textContent().catch(() => '')];
  log('Conflit simultané →', toasts);

  // Alice : sa liste ne montre ni réservation ni idée hors liste
  await A.p.reload();
  await A.p.getByText('Vélo de route').waitFor();
  const aliceText = await A.p.locator('main').innerText();
  const leaks = ['Pris par', 'Week-end spa', 'Cadeau commun :', 'Bob', 'Carla'].filter((w) => aliceText.includes(w));
  const aliceCrossed = await A.p.locator('.item.crossed').count();
  log('Fuites chez Alice :', leaks.length ? leaks : 'aucune', '| éléments rayés chez Alice :', aliceCrossed);
  await A.p.screenshot({ path: `${OUT}/4-alice-sa-liste.png`, fullPage: true });

  // Mes achats de Bob
  await B.p.getByRole('button', { name: /Mes achats/ }).click();
  await B.p.getByText('Pour Alice').waitFor();
  await B.p.screenshot({ path: `${OUT}/5-bob-mes-achats.png`, fullPage: true });

  // Hors connexion → bloqué
  await B.ctx.setOffline(true);
  await B.p.waitForTimeout(500);
  await B.p.getByText('Pas de connexion Internet').waitFor();
  log('Hors ligne : écran bloquant affiché');
  await B.p.screenshot({ path: `${OUT}/6-hors-ligne.png` });
  await B.ctx.setOffline(false);
  await B.p.getByText('Pour Alice').waitFor();
  log('Retour du réseau : reprise automatique');

  // Réouverture du lien : retour direct, sans redemander le code
  await A.p.goto(link);
  await A.p.getByText('Bonjour Alice !').waitFor();
  log('Le lien rouvre l’application directement');

  // Nouvelle année : Alice ouvre l'édition suivante → assistant de report
  await A.p.getByRole('button', { name: /Réglages/ }).click();
  await A.p.getByText(/Ouvrir l’édition/).click();
  await A.p.getByText(/Bienvenue en/).waitFor({ timeout: 10000 });
  await A.p.screenshot({ path: `${OUT}/7-report-annuel.png` });
  const boxes = A.p.locator('.check-row input');
  log('Report proposé :', await boxes.count(), 'souhaits');
  await A.p.locator('.check-row', { hasText: 'Écharpe' }).locator('input').uncheck();
  await A.p.getByRole('button', { name: /Reporter/ }).click();
  await A.p.getByRole('button', { name: /Ma liste/ }).last().click();
  await A.p.getByText('Vélo de route').waitFor();
  const kept = await A.p.locator('.item-title').allInnerTexts();
  log('Liste de l’année suivante :', kept);

  // Bob voit la nouvelle année et la liste reportée, avec réservations remises à zéro
  await B.p.getByRole('button', { name: /Famille/ }).click();
  await B.p.getByRole('button', { name: /^Alice/ }).click();
  await B.p.locator('.item', { hasText: 'Vélo de route' }).getByText('Je le prends').waitFor({ timeout: 10000 });
  log('Bob voit la liste reportée, cadeaux à nouveau libres');
  await browser.close();
  log('SCÉNARIO COMPLET OK');
})().catch((e) => { console.error('ÉCHEC', e.message); process.exit(1); });
