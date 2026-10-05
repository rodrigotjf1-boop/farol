"""CLI do agente.

Três comandos, e os três funcionam sem a loja:

    farol-agent sandbox    — processa uma pasta de quadros pelo pipeline
    farol-agent sondar     — mede a qualidade de uma imagem ou pasta
    farol-agent laco       — roda o laço COMPLETO: gatilho → regra → fila →
                             juiz → alerta, contra material gravado

O `sondar` é o diagnóstico: diz se o detalhe real bate com a resolução
declarada, se está focado, se caiu para infravermelho e se o WDR dá conta.

O `laco` é o que permite afinar motor, limiar e janela de silêncio sem
gastar nem ir ao restaurante — com `--simulado` (padrão) o veredito é
determinístico por imagem, então duas versões do motor se comparam contra
exatamente o mesmo material.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

import cv2

from farol_agent.config import ErroDeConfig, carregar
from farol_agent.fila import Fila
from farol_agent.fontes.sandbox import FonteSandbox
from farol_agent.modelos import EventoGatilho, Frame, Regra, TipoRegra, Zona
from farol_agent.motor import MotorDeRegras
from farol_agent import imagens
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
        imagens.escrever(str(nome), f.imagem, [cv2.IMWRITE_JPEG_QUALITY, args.jpeg])
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
        img = imagens.ler(str(arq))
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


def cmd_laco(args: argparse.Namespace) -> int:
    """Laço completo contra material gravado: gatilho → fila → juiz → alerta."""
    logging.basicConfig(
        level=logging.INFO if args.verboso else logging.WARNING,
        format="  [%(levelname)s] %(message)s",
    )

    try:
        ponto_id, regras = carregar(args.config)
    except ErroDeConfig as e:
        print(f"\n  ERRO de configuração: {e}\n", file=sys.stderr)
        return 1

    ativas = [r for r in regras if r.ativa]
    print(f"\nconfig: {len(regras)} regras, {len(ativas)} ativas · ponto {ponto_id}")
    if not ativas:
        print("\n  Nenhuma regra ativa. Regra nasce desligada de propósito —")
        print("  marque `ativa: true` no YAML depois de medir a acurácia.\n")
        return 1

    if args.nuvem:
        from farol_agent.juizes.nuvem import JuizNuvem
        from farol_agent.juizes.base import ErroDoJuiz

        try:
            juiz = JuizNuvem()
        except ErroDoJuiz as e:
            print(f"\n  ERRO: {e}\n", file=sys.stderr)
            return 1
        print(f"juiz: nuvem ({juiz.modelo}, escala para {juiz.modelo_forte})")
    else:
        from farol_agent.juizes.simulado import JuizSimulado

        juiz = JuizSimulado()
        print("juiz: simulado (nenhuma chamada de API, nenhum custo)")

    fonte = FonteSandbox(args.pasta, ponto_id=ponto_id, fps=args.fps)
    fila = Fila(args.fila)
    motor = MotorDeRegras(fila, regras, rajada=args.rajada, descartar=args.descartar)

    print(f"material: {len(fonte)} quadros · "
          f"{fonte.inicio:%d/%m %H:%M:%S} → {fonte.fim:%d/%m %H:%M:%S}")
    print(f"gatilho a cada {args.intervalo}s\n")

    enfileirados = silenciados = repetidos = 0
    alertas_total = []
    ts = fonte.inicio

    while ts <= fonte.fim:
        evento = EventoGatilho(ponto_id=ponto_id, ts=ts, origem="sandbox")
        p = motor.preparar(evento, fonte)
        enfileirados += len(p.enfileirados)
        silenciados += len(p.em_silencio)
        repetidos += len(p.repetidos)

        # Julga no mesmo passo: no agente real a drenagem é outro laço, mas
        # aqui interessa ver o alerta nascer junto da cena que o gerou.
        for a in motor.processar(juiz, ts, limite=args.limite):
            alertas_total.append(a)
            print(
                f"  🔔 {a.ts:%H:%M:%S}  [{a.severidade.value}] {a.regra_nome}"
                f"  conf {a.confianca:.2f}"
            )
            print(f"       {a.motivo}")
            print(f"       ações: {', '.join(a.acoes)}")

        ts += timedelta(seconds=args.intervalo)

    # Drena o que sobrou na fila depois do último gatilho.
    for a in motor.processar(juiz, ts, limite=1000):
        alertas_total.append(a)

    resumo = fila.resumo()
    custo = fila.custo_centavos(fonte.inicio - timedelta(days=1))

    print(f"\n  enfileirados {enfileirados} · "
          f"em silêncio {silenciados} · repetidos {repetidos}")
    print(f"  fila: {resumo}")
    print(f"  alertas: {len(alertas_total)}")
    print(f"  custo estimado: R$ {custo / 100:.4f}\n")

    fila.fechar()
    return 0


def _senha_do_dvr(args: argparse.Namespace) -> str:
    """Nunca pela linha de comando.

    Senha em argumento aparece no histórico do shell e na lista de
    processos — qualquer um na máquina a lê com `ps`. Vem do ambiente ou
    de prompt que não ecoa.
    """
    import os
    from getpass import getpass

    senha = os.environ.get("FAROL_DVR_SENHA")
    if senha:
        return senha
    return getpass(f"senha de {args.usuario}@{args.host}: ")


def cmd_dvr(args: argparse.Namespace) -> int:
    from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador
    from farol_agent.dvr.descoberta import limpar_arp, rede_local, varrer

    if args.acao == "descobrir":
        rede = args.rede or rede_local()
        if not rede:
            print("não descobri a rede desta máquina; informe com --rede", file=sys.stderr)
            return 1
        if args.limpar_arp:
            if limpar_arp():
                print("\ncache ARP esvaziado — a lista é o que responde AGORA")
            else:
                print("\nNÃO consegui esvaziar o cache ARP (precisa de administrador).")
                print("A lista pode trazer aparelho que já saiu da rede.")
        print(f"\nvarrendo {rede} … (portas 80, 554 e 37777, depois a tabela ARP)\n")
        achados = varrer(rede)
        if not achados:
            print("  nada respondeu, nem a ARP.")
            print("  O DVR está ligado e no mesmo switch/roteador que este PC?\n")
            return 1

        print(f"  {'IP':<16} {'MAC':<19} {'portas':<12} {'observação'}")
        print("  " + "─" * 76)
        for a in achados:
            portas = ",".join(str(p) for p in a.portas) if a.portas else "nenhuma"
            if a.realm:
                obs = str(a.realm)[:34]
            elif a.mac_local:
                obs = "MAC administrado localmente"
            else:
                obs = "só responde a ARP"
            marca = "  ⇐ parece gravador" if a.parece_gravador else ""
            print(f"  {a.host:<16} {(a.mac or '—'):<19} {portas:<12} {obs}{marca}")

        print()
        print(f"  {len(achados)} aparelhos. TODOS podem ser o gravador — a lista")
        print("  está ordenada por probabilidade, não filtrada.")
        print("  'MAC administrado localmente' é comum em celular, MAS um MHDX")
        print("  3116-C de fábrica também tem (ERR-003): não descarte por isso.")
        print()
        print("  TESTE DECISIVO: tire o cabo de rede do DVR, rode de novo, recoloque")
        print("  e rode outra vez. O IP que sumir e voltar é ele.\n")
        return 0

    cliente = ClienteDahua(
        args.host, args.usuario, _senha_do_dvr(args), porta=args.porta
    )

    try:
        if args.acao == "info":
            info = cliente.info()
            print()
            print(json.dumps(info, indent=2, ensure_ascii=False))
            print()
            canais = info.get("canais")
            if canais:
                print(f"  {canais} canais. URLs do main-stream:")
                for c in range(1, min(canais, 4) + 1):
                    print(f"    canal {c}: {cliente.url_rtsp_sem_segredo(c)}")
                if canais > 4:
                    print(f"    … e mais {canais - 4}")
                print()
            return 0

        if args.acao == "rtsp":
            print(cliente.url_rtsp(args.canal, sub=args.sub))
            return 0

        if args.acao == "eventos":
            print(f"\nouvindo {args.host} · códigos=[{args.codigos}] · Ctrl+C para parar")
            print("sem câmera ligada, espere VideoLoss em todos os canais\n")
            n = 0
            for e in cliente.eventos(args.codigos, keepalive=args.keepalive):
                n += 1
                extra = f"  {json.dumps(e.dados, ensure_ascii=False)}" if e.dados else ""
                print(f"  [{n:>4}] {e.codigo:<22} {e.acao:<6} canal {e.canal:>2}{extra}")
                if args.limite and n >= args.limite:
                    break
            print(f"\n  {n} eventos recebidos\n")
            return 0

    except ErroDoGravador as e:
        print(f"\n  ERRO: {e}", file=sys.stderr)
        if e.dica:
            print(f"  {e.dica}", file=sys.stderr)
        print(file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n  interrompido\n")
        return 0

    return 1


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

    l = sub.add_parser("laco", help="laço completo: gatilho → fila → juiz → alerta")
    l.add_argument("pasta", help="pasta com os quadros gravados")
    l.add_argument("--config", required=True, help="YAML com zonas e regras")
    l.add_argument("--fila", default="./fila.db", help="banco SQLite da fila")
    l.add_argument("--nuvem", action="store_true",
                   help="julga de verdade pela API (CUSTA DINHEIRO)")
    l.add_argument("--fps", type=float, default=1.0, help="taxa do material")
    l.add_argument("--intervalo", type=float, default=30.0,
                   help="segundos entre gatilhos simulados")
    l.add_argument("--rajada", type=int, default=6)
    l.add_argument("--descartar", type=int, default=2)
    l.add_argument("--limite", type=int, default=10,
                   help="itens julgados por passada")
    l.add_argument("--verboso", action="store_true")
    l.set_defaults(func=cmd_laco)

    v = sub.add_parser("dvr", help="fala com o gravador: acha, identifica e ouve eventos")
    v.add_argument("acao", choices=["descobrir", "info", "eventos", "rtsp"])
    v.add_argument("--rede", help="faixa a varrer, ex. 192.168.1.0/24 (padrão: a desta máquina)")
    v.add_argument("--limpar-arp", dest="limpar_arp", action="store_true",
                   help="esvazia o cache ARP antes de varrer (precisa de administrador)")
    v.add_argument("--host", help="IP do gravador")
    v.add_argument("--porta", type=int, default=80)
    v.add_argument("--usuario", default="admin")
    v.add_argument("--canal", type=int, default=1)
    v.add_argument("--sub", action="store_true", help="sub-stream em vez do main")
    v.add_argument("--codigos", default="All", help="ex.: VideoMotion,VideoLoss")
    v.add_argument("--keepalive", type=int, default=20)
    v.add_argument("--limite", type=int, default=0, help="para após N eventos (0 = sem fim)")
    v.set_defaults(func=cmd_dvr)

    args = p.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
