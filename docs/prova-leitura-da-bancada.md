# Prova da leitura da bancada — 08/10/2026

Primeira prova, ao vivo, do algoritmo descrito no roadmap (A19, frente C). Rodou no PC da
loja de teste, no canal 4 (câmera nova, de cima, sobre a bancada de montagem), das 21h36 às
21h49, com a loja em operação.

**O que rodou:** três sinais, em todo quadro do fluxo principal, **sem modelo nenhum**:

1. **o braço** — o que difere do fundo e está ligado à borda do operador; a ponta é a mão.
   Mão dentro da faixa das cubas por 3 quadros = "foi à cuba da coluna N";
2. **pôs / tirou** — quando a bancada fica parada por 0,6 s, compara-se com a última vez
   em que ficou parada; mancha nova = algo posto, mancha que sumiu = tirado;
3. **a comanda** — papel branco novo ao lado da impressora.

**O que saiu da loja:** números e uma folha com 96 recortes pequenos (128 px) do que o
passo 2 detectou. Nenhuma imagem inteira. A folha foi apagada do PC da loja depois de
copiada e não está neste repositório.

## Resultado

| | |
|---|---|
| Quadros | 11.707 de 1920×1080 em 780 s — 15,0 por segundo, em tempo real |
| Conta por quadro | mediana 6,1 ms; o maior, 119 ms |
| Mão na faixa das cubas | 146 idas; por coluna, da esquerda: 7 · 21 · 34 · 28 · 41 · 15 |
| Postos / tirados | 73 / 61 |
| Comandas | 32 — não conferido (este sinal não guardou recorte) |
| Postos até 4 s depois de uma ida às cubas | 19 de 73 |
| Recortes que são camada ou item de verdade | 37 de 96 (contados a olho): pão, carne, fatia de queijo, alface, molho branco, molho laranja, batata, caixa |
| Os outros 59 | brilho do papel alumínio amassado, brilho do inox, borda de caixa |

## O que ensinou

1. **O sinal existe.** A ≈ 12 px por cm as camadas aparecem e são distinguíveis a olho no
   recorte — inclusive molho branco sobre a carne.
2. **A posição de montagem desta loja é a folha de papel alumínio** (ou a caixa).
3. **O papel alumínio é o gerador de alarme falso**: muda de brilho a cada toque. A
   comparação tem de ser por posição, e a mancha tem de ter cor e forma de alimento.
4. **Esperar a bancada inteira parar atrasa a leitura**: no pico, vários itens saíram no
   mesmo instante. A quietude tem de ser por posição.
5. As regiões estavam escritas à mão para o enquadramento de 08/10. No produto elas são os
   quadros do canal, com papel (cuba, posição, impressora).

**Lido depois, no estudo de um lote** ([estudo-do-lote-de-montagem.md](estudo-do-lote-de-montagem.md)):
os "19 de 73" têm explicação. A montagem é por ingrediente, em lote — a carne vem numa
cuba para cima da bancada, o queijo num maço na mão, o molho numa bisnaga —, e uma ida às
cubas serve várias posições. Ligar cada item posto à última ida não é a régua certa; a
régua é a fase.

## O que NÃO é

Não é acerto medido: não houve contagem humana para comparar. Os limiares não foram
ajustados. A câmera ainda não foi regulada (35% do quadro era piso, as cubas estavam
cortadas no topo, havia reflexo no meio da bancada).

## O roteiro

Guardado aqui para a prova poder ser refeita. Não é código do produto: as regiões são as
do enquadramento daquele dia.

```python
"""A19 — primeira prova do algoritmo de "leitura da bancada", ao vivo, no canal da montagem.

Tres sinais baratos, sem modelo nenhum, medidos em todo quadro do fluxo principal:

  1. BRACO: o que mudou em relacao ao fundo e esta ligado a borda do operador; a ponta dele e a mao.
     Mao dentro da faixa das cubas = "foi a cuba da coluna N".
  2. DEPOSITO / RETIRADA: quando a bancada fica parada, compara com a ultima vez em que ficou parada.
     Mancha nova = algo foi posto (ou tirado). Guarda tamanho, cor e um recorte pequeno.
  3. COMANDA: papel branco novo ao lado da impressora.

Sai uma linha do tempo de acontecimentos e uma folha com os recortes dos depositos (para ver o que
ele pegou). Nada alem dessa folha e gravado; a senha do gravador vem do cofre e nao e impressa.

    cd /d C:\\Farol\\agent && .venv\\Scripts\\python.exe -X utf8 C:\\Farol\\prova_bancada.py <canal> <segundos> <pasta>
"""
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

os.environ["OPENCV_LOG_LEVEL"] = "SILENT"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|timeout;8000000|stimeout;8000000|max_delay;500000"

import cv2  # noqa: E402
import numpy as np  # noqa: E402

RAIZ = Path(r"C:\Farol\agent")
sys.path.insert(0, str(RAIZ))

from farol_agent import cofre, imagens  # noqa: E402
from farol_agent.configuracao import de_json  # noqa: E402
from farol_agent.dvr.dahua import ClienteDahua  # noqa: E402

CANAL, DURACAO, PASTA = int(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
PX_POR_CM = 12.0  # medido pela comanda de 80 mm

# Regioes, na imagem reduzida a 960x540 (olhadas nos quadros de 08/10):
BANCADA = (10, 165, 810, 345)      # x0, y0, x1, y1 — o tampo, abaixo das cubas
CUBAS = (0, 60, 600, 165)          # a faixa das cubas, em 6 colunas
COLUNAS = 6
COMANDA = (672, 125, 768, 260)     # ao lado da impressora, onde o papel sai e fica
EMBALAGEM = (815, 110, 960, 345)   # o papel de embrulho, a direita
BORDA_DO_OPERADOR = 345            # daqui para baixo e onde a pessoa fica

config = de_json(json.loads(sorted(RAIZ.rglob("configuracao.json"))[0].read_text(encoding="utf-8")))
ponto = next(p for p in config.pontos if p.host and p.canal)
cliente = ClienteDahua(ponto.host, ponto.usuario or "admin", cofre.resolver(ponto.segredo_ref))
print(f"comeco na loja {datetime.now():%Y-%m-%d %H:%M:%S} · canal {CANAL} por {DURACAO} s")
sys.stdout.flush()
sys.stderr.flush()
os.dup2(os.open(os.devnull, os.O_WRONLY), 2)
PASTA.mkdir(parents=True, exist_ok=True)

url = cliente.url_rtsp(CANAL, sub=False)
cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
url = None
assert cap.isOpened(), "o fluxo principal nao abriu"

nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
fundo = None            # fundo que se adapta devagar (para achar o braco)
anterior = None
parada_desde = None     # desde quando a bancada esta sem movimento
estavel = None          # a bancada, na ultima vez em que ficou parada (cor, reduzida)
estavel_cheio = None    # o mesmo instante, em resolucao cheia (para o recorte)
brancos = []            # historico do papel branco na regiao da comanda
eventos = []            # (segundo, tipo, detalhe)
recortes = []           # (segundo, tipo, imagem 128x128)
na_cuba = [0] * COLUNAS  # quadros seguidos com a mao em cada coluna
ja_contou = [False] * COLUNAS
tempos, n, t0 = [], 0, time.perf_counter()
ultimo_papel = -99.0
x0, y0, x1, y1 = BANCADA


def textura(img):
    c = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(c, cv2.CV_32F).var())


while True:
    ok, q = cap.read()
    if not ok or q is None:
        break
    t = time.perf_counter() - t0
    if t >= DURACAO:
        break
    n += 1
    ti = time.perf_counter()
    p = cv2.resize(q, (960, 540), interpolation=cv2.INTER_AREA)
    cinza = cv2.GaussianBlur(cv2.cvtColor(p, cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.int16)
    if fundo is None:
        fundo, anterior = cinza.copy(), cinza.copy()
        continue
    mov = np.abs(cinza - anterior) > 12
    anterior = cinza

    # o fundo anda 1 nivel na direcao do quadro, a cada 3 quadros, onde nao ha movimento
    if n % 3 == 0:
        fundo += np.where(mov, 0, np.sign(cinza - fundo)).astype(np.int16)

    # ───── 1 · o braco e a mao ─────
    frente = (np.abs(cinza - fundo) > 26).astype(np.uint8)
    faixa = cv2.morphologyEx(frente[CUBAS[1] : BORDA_DO_OPERADOR + 6], cv2.MORPH_OPEN, nucleo)
    qtd, rot, est, _ = cv2.connectedComponentsWithStats(faixa, 8)
    ponta = None
    base = faixa.shape[0] - 1
    for k in range(1, qtd):
        xx, yy, ww, hh, area = est[k]
        if area < 900 or yy + hh < base - 2:  # tem de encostar na borda do operador
            continue
        if ponta is None or yy < ponta[1]:
            linha = np.where(rot[yy] == k)[0]
            ponta = (int(linha.mean()), int(yy))
    for c in range(COLUNAS):
        dentro = False
        if ponta is not None:
            px, py = ponta[0], ponta[1] + CUBAS[1]
            larg = (CUBAS[2] - CUBAS[0]) / COLUNAS
            dentro = py < CUBAS[3] - 8 and CUBAS[0] + c * larg <= px < CUBAS[0] + (c + 1) * larg
        na_cuba[c] = na_cuba[c] + 1 if dentro else 0
        if na_cuba[c] >= 3 and not ja_contou[c]:  # 3 quadros seguidos = 0,2 s
            eventos.append((t, "cuba", c + 1))
            ja_contou[c] = True
        if na_cuba[c] == 0:
            ja_contou[c] = False

    # ───── 2 · deposito e retirada na bancada ─────
    mexe = float(mov[y0:y1, x0:x1].mean())
    braco_na_bancada = float(frente[y0:y1, x0:x1].mean())
    if mexe > 0.003:
        parada_desde = None
    elif parada_desde is None:
        parada_desde = t
    if parada_desde is not None and t - parada_desde >= 0.6:
        agora = cv2.GaussianBlur(p[y0:y1, x0:x1], (5, 5), 0)
        if estavel is None:
            estavel, estavel_cheio = agora, q.copy()
        else:
            dif = (np.abs(agora.astype(np.int16) - estavel.astype(np.int16)).max(axis=2) > 30).astype(np.uint8)
            dif = cv2.morphologyEx(cv2.morphologyEx(dif, cv2.MORPH_OPEN, nucleo), cv2.MORPH_CLOSE, nucleo)
            qd, _, ed, _ = cv2.connectedComponentsWithStats(dif, 8)
            total = dif.shape[0] * dif.shape[1]
            mudou = False
            for k in range(1, qd):
                bx, by, bw, bh, area = ed[k]
                if not (220 <= area <= 0.10 * total):
                    continue
                mudou = True
                antes, depois = estavel[by : by + bh, bx : bx + bw], agora[by : by + bh, bx : bx + bw]
                posto = textura(depois) + float(cv2.cvtColor(depois, cv2.COLOR_BGR2HSV)[:, :, 1].mean()) > textura(antes) + float(cv2.cvtColor(antes, cv2.COLOR_BGR2HSV)[:, :, 1].mean())
                com_item = depois if posto else antes
                lab = cv2.cvtColor(com_item, cv2.COLOR_BGR2LAB).reshape(-1, 3).mean(axis=0)
                eventos.append((t, "posto" if posto else "tirado", dict(x=int(bx + bw / 2 + x0), y=int(by + bh / 2 + y0), larg_cm=round(bw * 2 / PX_POR_CM, 1), alt_cm=round(bh * 2 / PX_POR_CM, 1), area_cm2=round(area * 4 / PX_POR_CM**2), cor=[int(v) for v in lab])))
                if len(recortes) < 96:
                    cheio = q if posto else estavel_cheio
                    m = 14
                    X0, Y0 = max(0, (bx + x0) * 2 - m), max(0, (by + y0) * 2 - m)
                    X1, Y1 = min(1920, (bx + bw + x0) * 2 + m), min(1080, (by + bh + y0) * 2 + m)
                    rec = cheio[Y0:Y1, X0:X1]
                    lado = max(rec.shape[0], rec.shape[1])
                    tela = np.zeros((lado, lado, 3), np.uint8)
                    tela[: rec.shape[0], : rec.shape[1]] = rec
                    peca = cv2.resize(tela, (128, 128), interpolation=cv2.INTER_AREA)
                    cv2.putText(peca, f"{'+' if posto else '-'}{t:.0f}s", (3, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
                    recortes.append(peca)
            if mudou or n % 150 == 0:  # a luz muda devagar: renova a referencia de tempos em tempos
                estavel, estavel_cheio = agora, q.copy()

    # ───── 3 · a comanda ─────
    cx0, cy0, cx1, cy1 = COMANDA
    lab = cv2.cvtColor(p[cy0:cy1, cx0:cx1], cv2.COLOR_BGR2LAB).astype(np.int16)
    papel = int(((lab[:, :, 0] > 205) & (np.abs(lab[:, :, 1] - 128) < 10) & (np.abs(lab[:, :, 2] - 128) < 14)).sum())
    brancos.append(papel)
    if len(brancos) > 60:  # 4 s atras contra agora, sustentado por 1 s
        velho = float(np.median(brancos[-60:-45]))
        novo = float(np.min(brancos[-15:]))
        if novo - velho > 500 and t - ultimo_papel > 6:
            eventos.append((t, "comanda", int(novo - velho)))
            ultimo_papel = t
        if len(brancos) > 600:
            del brancos[:300]
    tempos.append(time.perf_counter() - ti)
cap.release()

dur = time.perf_counter() - t0
print(f"li {n} quadros em {dur:.0f} s ({n / dur:.1f} q/s) · conta por quadro: mediana {1000 * float(np.median(tempos)):.1f} ms, maior {1000 * max(tempos):.0f} ms")
por_tipo = Counter(e[1] for e in eventos)
print("acontecimentos:", dict(por_tipo))
cubas = Counter(e[2] for e in eventos if e[1] == "cuba")
print("idas a faixa das cubas, por coluna (1 = esquerda):", {c: cubas.get(c, 0) for c in range(1, COLUNAS + 1)})
postos = [e for e in eventos if e[1] == "posto"]
if postos:
    areas = sorted(e[2]["area_cm2"] for e in postos)
    print(f"itens postos na bancada: {len(postos)} · area mediana {areas[len(areas) // 2]} cm2 (de {areas[0]} a {areas[-1]}) · por minuto {60 * len(postos) / dur:.1f}")
    # onde: tercos da bancada
    onde = Counter("esquerda" if e[2]["x"] < 277 else "meio" if e[2]["x"] < 543 else "direita" for e in postos)
    print("  onde na bancada:", dict(onde))
# pares: ida a cuba seguida de item posto em ate 4 s
pares = 0
for e in postos:
    if any(c[1] == "cuba" and 0 < e[0] - c[0] <= 4 for c in eventos):
        pares += 1
print(f"itens postos ate 4 s depois de uma ida as cubas: {pares} de {len(postos)}")
print("linha do tempo (segundo · o que):")
for e in eventos[:160]:
    if e[1] == "cuba":
        print(f"  {e[0]:6.1f} · mao na cuba da coluna {e[2]}")
    elif e[1] == "comanda":
        print(f"  {e[0]:6.1f} · COMANDA (papel novo: {e[2]} px)")
    else:
        d = e[2]
        print(f"  {e[0]:6.1f} · {e[1]} · {d['larg_cm']} x {d['alt_cm']} cm · {d['area_cm2']} cm2 · em ({d['x']},{d['y']}) · cor Lab {d['cor']}")
if recortes:
    col = 12
    lin = (len(recortes) + col - 1) // col
    folha = np.zeros((lin * 128, col * 128, 3), np.uint8)
    for i, r in enumerate(recortes):
        folha[(i // col) * 128 : (i // col + 1) * 128, (i % col) * 128 : (i % col + 1) * 128] = r
    assert imagens.escrever(PASTA / f"c{CANAL}_depositos.jpg", folha, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f"folha de recortes: {len(recortes)} em {PASTA}")
print(f"fim na loja {datetime.now():%H:%M:%S}")
```
