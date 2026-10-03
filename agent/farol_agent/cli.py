"""CLI do agente.

Na etapa A2.1 há dois comandos, e os dois servem para trabalhar sem a loja:

    farol-agent sandbox    — processa uma pasta de quadros pelo pipeline
    farol-agent sondar     — mede a qualidade de uma imagem ou pasta

O `sondar` é o diagnóstico: diz se o detalhe real bate com a resolução
declarada, se está focado, se caiu para infravermelho e se o WDR dá conta.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import cv2

from farol_agent.fontes.sandbox import FonteSandbox
from farol_agent.modelos import Frame, Regra, TipoRegra, Zona
from farol_agent.pipeline import dedupe, qualidade, recorte


# Zona padrão para quando não há configuração: o quadro inteiro.
ZONA_CHEIA = Zona(
    id="zona-cheia",
    nome="quadro inteiro",
    poligono=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
)


def _carregar_zona(caminho: str | None) -> Zona:
    if not caminho:
        return ZONA_CHEIA
    dados = json.loads(Path(caminho).read_text(encoding="utf-8"))
    return Zona(
        id=dados.get("id", "zona"),
        nome=dados.get("nome", "zona"),
        poligono=[tuple(p) for p in dados["poligono"]],
    )


def cmd_sandbox(args: argparse.Namespace) -> int:
    fonte = FonteSandbox(args.pasta, ponto_id=args.ponto, fps=args.fps)
    zona = _carregar_zona(args.zona)
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)

    dedup = dedupe.Deduplicador(limiar=args.limiar_dedupe, memoria_seg=args.memoria)

    print(f"sandbox: {len(fonte)} quadros · {fonte.inicio:%d/%m %H:%M:%S} → {fonte.fim:%d/%m %H:%M:%S}")
    print(f"zona: {zona.nome} · resolução de envio: {args.lado_maior} px\n")

    enviados = 0
    repetidos = 0
    ts = fonte.inicio

    while ts <= fonte.fim:
        rajada = fonte.rajada(ts, quantidade=args.rajada)
        if not rajada:
            break

        bbox = zona.bbox(rajada[0].largura, rajada[0].altura)
        escolhido = qualidade.melhor_quadro(rajada, descartar=args.descartar, zona_bbox=bbox)
        if escolhido is None:
            ts = _avancar(ts, args.intervalo)
            continue

        f = recorte.recortar_zona(escolhido, zona, mascarar=args.mascarar)
        borrou = False
        if args.borrar_rosto:
            f, borrou = recorte.borrar_rostos(f)

        if dedup.repetido(f"{args.ponto}:{zona.id}", f.imagem, f.ts):
            repetidos += 1
            ts = _avancar(ts, args.intervalo)
            continue

        f = recorte.redimensionar(f, args.lado_maior)

        nome = saida / f"{f.ts:%Y%m%d_%H%M%S}_{zona.id}.jpg"
        cv2.imwrite(str(nome), f.imagem, [cv2.IMWRITE_JPEG_QUALITY, args.jpeg])
        enviados += 1
        print(
            f"  {f.ts:%H:%M:%S}  {f.largura}×{f.altura}  "
            f"nitidez {escolhido.nitidez:7.1f}  "
            f"{'rosto borrado  ' if borrou else '':<15}→ {nome.name}"
        )

        ts = _avancar(ts, args.intervalo)

    print(f"\n{enviados} recortes gerados · {repetidos} descartados por repetição")
    if enviados + repetidos:
        print(f"economia por deduplicação: {repetidos / (enviados + repetidos):.0%}")
    return 0


def _avancar(ts: datetime, segundos: float) -> datetime:
    from datetime import timedelta

    return ts + timedelta(seconds=segundos)


def cmd_sondar(args: argparse.Namespace) -> int:
    """Mede a qualidade real da imagem, em vez de confiar na ficha técnica."""
    alvo = Path(args.caminho)
    arquivos = (
        sorted(p for p in alvo.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
        if alvo.is_dir()
        else [alvo]
    )

    print(f"{'arquivo':<34} {'resolução':>11} {'detalhe':>8} {'nitidez':>9} {'satur.':>7} {'estour.':>8}")
    print("─" * 82)

    for arq in arquivos:
        img = cv2.imread(str(arq))
        if img is None:
            print(f"{arq.name:<34} {'ilegível':>11}")
            continue

        h, w = img.shape[:2]
        det = qualidade.detalhe_real(img)
        nit = qualidade.nitidez(img)
        sat = qualidade.saturacao_media(img)
        est, _cortado = qualidade.faixa_dinamica(img)

        print(
            f"{arq.name[:33]:<34} {f'{w}×{h}':>11} {det:>8.3f} {nit:>9.1f} "
            f"{sat:>7.2f} {est:>7.1%}"
        )

        if det < 0.08:
            print(f"{'':34} ⚠️  detalhe baixo: imagem provavelmente esticada de resolução menor (1080N?)")
        if sat < 0.05:
            print(f"{'':34} ⚠️  sem cor: está em infravermelho — regra que depende de cor não funciona aqui")
        if est > 0.05:
            print(f"{'':34} ⚠️  {est:.0%} dos pixels estourados: WDR insuficiente para a cena")

    return 0


def _forcar_utf8() -> None:
    """O console do Windows usa cp1252 e engasga em acento, régua e emoji.

    O agente roda em PC de loja com Windows, então isto não é conforto: sem
    reconfigurar, qualquer `print` com caractere fora do cp1252 derruba o
    processo com UnicodeEncodeError.
    """
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass   # fluxo redirecionado ou já em UTF-8


def main(argv: list[str] | None = None) -> int:
    _forcar_utf8()
    p = argparse.ArgumentParser(prog="farol-agent", description="Agente do Farol")
    sub = p.add_subparsers(dest="comando", required=True)

    s = sub.add_parser("sandbox", help="processa uma pasta de quadros pelo pipeline")
    s.add_argument("pasta", help="pasta com os quadros gravados")
    s.add_argument("--ponto", default="ponto-teste")
    s.add_argument("--zona", help="JSON com o polígono da zona")
    s.add_argument("--saida", default="./saida")
    s.add_argument("--fps", type=float, default=1.0, help="taxa do material de origem")
    s.add_argument("--intervalo", type=float, default=5.0, help="segundos entre análises")
    s.add_argument("--rajada", type=int, default=6)
    s.add_argument("--descartar", type=int, default=2)
    s.add_argument("--lado-maior", type=int, default=640, dest="lado_maior")
    s.add_argument("--jpeg", type=int, default=85)
    s.add_argument("--limiar-dedupe", type=int, default=6, dest="limiar_dedupe")
    s.add_argument("--memoria", type=int, default=30, help="segundos de memória do dedupe")
    s.add_argument("--mascarar", action="store_true", help="escurece fora do polígono")
    s.add_argument("--sem-borrao", dest="borrar_rosto", action="store_false")
    s.set_defaults(func=cmd_sandbox, borrar_rosto=True)

    d = sub.add_parser("sondar", help="mede a qualidade real de uma imagem ou pasta")
    d.add_argument("caminho")
    d.set_defaults(func=cmd_sondar)

    args = p.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
