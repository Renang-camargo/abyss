"""
E2E: dois navegadores reais (desktop + celular) jogam uma partida completa
pela interface — criação de sala, entrada por convite, 10 rodadas,
queda de conexão no meio, pódio — e salvam screenshots de cada tela.

Uso: servidor rodando (npm start) e `python3 e2e/full_match.py [url]`
"""
import os, re, sys, glob, time, json, urllib.request
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'artifacts')
os.makedirs(OUT, exist_ok=True)
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')

def load_bank():
    """prompt → {tier: [nomes]} lido dos arquivos .abyss (o cliente nunca recebe isso)."""
    bank = {}
    for f in glob.glob(os.path.join(ROOT, '..', 'server', 'data', 'questions', '*.abyss')):
        cur = None
        for line in open(f, encoding='utf8'):
            line = line.strip()
            if line.startswith('@'): cur = {}
            m = re.match(r'^enunciado:\s*(.+)$', line)
            if m and cur is not None: bank[m.group(1)] = cur
            m = re.match(r'^([1-5]):\s*(.+)$', line)
            if m and cur is not None:
                cur.setdefault(int(m.group(1)), []).extend(i.split('|')[0].strip() for i in m.group(2).split(';') if i.strip())
    return bank

BANK = load_bank()
shots = []
def shot(page, name):
    p = os.path.join(OUT, f'{len(shots)+1:02d}-{name}.png')
    page.screenshot(path=p)
    shots.append(p)
    print('  📸', os.path.basename(p))

def onboard(page, character, name, invite=False):
    page.get_by_role('button', name='Mergulhar').click()
    page.get_by_role('radio', name=character).click()
    page.get_by_role('button', name=re.compile('^Continuar com')).click()
    page.locator('#name').fill(name)
    page.get_by_role('button', name='Confirmar entrada').click()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    A = browser.new_context(viewport={'width': 1366, 'height': 820})
    B = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    a, b = A.new_page(), B.new_page()
    for pg, tag in ((a, 'A'), (b, 'B')):
        pg.on('pageerror', lambda e, t=tag: print(f'  ⚠ erro JS {t}:', e))

    print('1) Lucas cria a sala (desktop)')
    a.goto(URL); a.wait_for_timeout(2600); shot(a, 'inicial-desktop')
    a.get_by_role('button', name='Mergulhar').click()
    a.get_by_role('radio', name='Polvo').click(); a.wait_for_timeout(600); shot(a, 'personagem-desktop')
    a.get_by_role('button', name=re.compile('^Continuar com')).click()
    a.locator('#name').fill('Lucas'); a.wait_for_timeout(500); shot(a, 'identificacao-desktop')
    a.get_by_role('button', name='Confirmar entrada').click()
    a.wait_for_timeout(1200); shot(a, 'menu-desktop')
    a.get_by_role('button', name='Criar sala').click()
    a.wait_for_timeout(900); shot(a, 'criar-sala-desktop')
    a.get_by_role('button', name='Criar sala').click()
    code_el = a.locator('[aria-label^="Código"]')
    expect(code_el).to_be_visible(timeout=8000)
    code = code_el.inner_text().strip()
    print('   código da sala:', code)

    print('2) Marina entra pelo link de convite (celular)')
    b.goto(f'{URL}/?sala={code}'); b.wait_for_timeout(2600); shot(b, 'inicial-celular')
    onboard(b, 'Peixe-abissal', 'Marina')
    b.wait_for_timeout(800); shot(b, 'menu-convite-celular')
    b.get_by_role('button', name='Entrar', exact=True).click()
    expect(b.get_by_text('Esperando o anfitrião')).to_be_visible(timeout=8000)
    expect(a.get_by_text('Marina')).to_be_visible(timeout=8000)
    a.wait_for_timeout(900); shot(a, 'lobby-desktop'); shot(b, 'lobby-celular')

    print('3) Partida')
    a.get_by_role('button', name='Começar o mergulho').click()
    b.wait_for_timeout(700); shot(b, 'contagem-celular')

    for rnd in range(1, 11):
        h1a = a.locator('main h1'); h1b = b.locator('main h1')
        expect(a.get_by_text(f'Rodada {rnd} de 10')).to_be_visible(timeout=30000)
        expect(b.locator('#answer')).to_be_visible(timeout=30000)
        prompt = h1a.inner_text().strip()
        assert prompt == h1b.inner_text().strip(), 'jogadores viram perguntas diferentes'
        tiers = BANK[prompt]
        pool = tiers.get(5) or tiers.get(4) or tiers[3]
        rare = pool[rnd % len(pool)]
        common = tiers[1][0]
        a_answer = rare.upper()  # caixa diferente de propósito
        b_answer = 'helicóptero de chocolate' if rnd == 3 else (common[:-1] + common[-1] * 2 if len(common) > 7 else common)  # erro de digitação
        print(f'   R{rnd}: "{prompt}" — Lucas: {a_answer!r}  Marina: {b_answer!r}')
        if rnd == 1: shot(b, 'pergunta-celular')
        a.locator('#answer').fill(a_answer); a.get_by_role('button', name='Enviar resposta').click()
        expect(a.get_by_text('Sua resposta foi enviada')).to_be_visible()
        if rnd == 1: shot(a, 'pergunta-enviada-desktop')

        if rnd == 5:
            print('   ⚡ Marina perde a conexão por 4 s')
            B.set_offline(True)
            expect(b.get_by_text('Reconectando…')).to_be_visible(timeout=5000)
            b.wait_for_timeout(1500)
            shot(b, 'reconectando-celular')
            # servidor percebe a queda: como só faltava Marina, a rodada fecha mais cedo
            B.set_offline(False)
            expect(b.get_by_text('Reconectando…')).to_be_hidden(timeout=20000)
            print('   ✓ Marina voltou')
        if rnd != 5 or b.locator('#answer').is_visible():
            b.locator('#answer').fill(b_answer); b.get_by_role('button', name='Enviar resposta').click()

        expect(a.get_by_text('Todas as respostas')).to_be_visible(timeout=30000)
        if rnd != 5: expect(b.get_by_text('Todas as respostas')).to_be_visible(timeout=30000)
        a.wait_for_timeout(3600)
        txt = a.locator('main').inner_text()
        if rnd in (1, 4): shot(a, f'resultado-r{rnd}-desktop'); shot(b, f'resultado-r{rnd}-celular')
        if rnd == 3:
            assert 'helicóptero de chocolate' in txt and 'Não ' in txt, 'resposta absurda deveria ser recusada'
        if rnd < 10:
            expect(a.get_by_role('heading', name='Classificação')).to_be_visible(timeout=20000)
            if rnd == 2: a.wait_for_timeout(900); shot(a, 'classificacao-desktop'); shot(b, 'classificacao-celular')

    print('4) Pódio')
    expect(a.get_by_role('heading', name='Classificação completa')).to_be_visible(timeout=30000)
    expect(b.get_by_role('heading', name='Classificação completa')).to_be_visible(timeout=30000)
    a.wait_for_timeout(1200); shot(a, 'podio-subindo-desktop')
    a.wait_for_timeout(2600); shot(a, 'podio-desktop'); shot(b, 'podio-celular')
    final_text = a.locator('main').inner_text()
    assert 'Lucas' in final_text and 'Marina' in final_text
    b.mouse.wheel(0, 900); b.wait_for_timeout(500); shot(b, 'podio-ranking-celular')

    print('5) Jogar de novo e sair')
    a.get_by_role('button', name='Jogar de novo').click()
    expect(b.get_by_text('Esperando o anfitrião')).to_be_visible(timeout=8000)
    b.get_by_role('button', name='Sair', exact=True).click()
    expect(b.get_by_role('heading', name='Pronto para descer?')).to_be_visible(timeout=8000)
    browser.close()

health = json.load(urllib.request.urlopen(f'{URL}/api/health'))
print('health:', health)
assert health['matches'] >= 1 and health['answers'] >= 19
print(f'\n✅ Partida completa com 2 navegadores: OK ({len(shots)} screenshots em e2e/artifacts)')
