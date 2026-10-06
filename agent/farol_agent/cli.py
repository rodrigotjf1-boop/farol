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
from farol_agent.modelos import (
    RESOLUCOES,
    EventoGatilho,
    Frame,
    Regra,
    TipoRegra,
    Zona,
)
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
        print("  'MAC administrado localmente' é comum em celular, mas não é")
        print("  exclusivo dele (ERR-003): não descarte ninguém por esse motivo.")
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

        if args.acao == "canais":
            # Varre os canais e diz QUAIS têm câmera. Numa instalação,
            # "em que canal ficou essa câmera?" é a primeira pergunta, e
            # ela se responde medindo, não conferindo etiqueta de cabo.
            from farol_agent.fontes.rtsp import ErroDaFonte, FonteRTSP
            from farol_agent.pipeline import qualidade

            total = args.ate or (cliente.quantidade_de_canais() or 16)
            print(f"\nvarrendo canais 1 a {total} de {args.host} …")
            print("(cada canal leva alguns segundos; canal vazio demora mais)\n")
            print(f"  {'canal':>5}  {'resolução':>11}  {'detalhe':>8}  {'satur.':>7}  situação")
            print("  " + "─" * 62)

            com_camera = []
            for canal in range(1, total + 1):
                fonte = FonteRTSP(f"canal{canal}", cliente.url_rtsp(canal), abrir_sub=False)
                try:
                    quadros = fonte.rajada(datetime.now(), quantidade=3)
                except ErroDaFonte:
                    print(f"  {canal:>5}  {'—':>11}  {'—':>8}  {'—':>7}  não abriu")
                    continue
                finally:
                    fonte.fechar()

                if not quadros:
                    print(f"  {canal:>5}  {'—':>11}  {'—':>8}  {'—':>7}  sem transmissão")
                    continue

                melhor = quadros[-1]
                ok, porque = qualidade.cena_utilizavel(melhor.imagem)
                det = qualidade.detalhe_real(melhor.imagem)
                sat = qualidade.saturacao_media(melhor.imagem)
                situacao = "CÂMERA" if ok else (porque[:34] or "sem cena")
                if ok:
                    com_camera.append(canal)
                print(
                    f"  {canal:>5}  {f'{melhor.largura}×{melhor.altura}':>11}  "
                    f"{det:>8.3f}  {sat:>7.2f}  {situacao}"
                )

            print()
            if com_camera:
                lista = ", ".join(str(c) for c in com_camera)
                print(f"  {len(com_camera)} canal(is) com imagem: {lista}")
                print(f"\n  próximo: dvr quadro --host {args.host} "
                      f"--canal {com_camera[0]} --salvar camera.jpg\n")
            else:
                print("  nenhum canal com imagem — só telas de 'sem sinal'.\n")
            return 0

        if args.acao == "quadro":
            # Captura um quadro de verdade pelo RTSP e mede. Em canal sem
            # camera, muito gravador transmite uma tela de "sem sinal" —
            # e isso basta para validar a captura inteira antes de a
            # camera chegar.
            from farol_agent import imagens
            from farol_agent.fontes.rtsp import ErroDaFonte, FonteRTSP
            from farol_agent.pipeline import qualidade

            fonte = FonteRTSP(
                f"canal{args.canal}",
                cliente.url_rtsp(args.canal, sub=args.sub),
                abrir_sub=False,
            )
            tipo = "sub" if args.sub else "main"
            print(f"\nabrindo canal {args.canal} ({tipo}-stream) …")
            try:
                quadros = fonte.rajada(datetime.now(), quantidade=args.rajada)
            except ErroDaFonte as e:
                print(f"\n  ERRO: {e}", file=sys.stderr)
                if e.dica:
                    print(f"  {e.dica}", file=sys.stderr)
                return 1
            finally:
                fonte.fechar()

            if not quadros:
                print("\n  abriu, mas nenhum quadro veio.")
                print("  Canal sem câmera costuma ser isso: o gravador aceita a")
                print("  conexão e não transmite nada.\n")
                return 1

            melhor = qualidade.melhor_quadro(quadros, descartar=min(2, len(quadros) - 1))
            det = qualidade.detalhe_real(melhor.imagem)
            sat = qualidade.saturacao_media(melhor.imagem)
            est, cortado = qualidade.faixa_dinamica(melhor.imagem)

            print(f"\n  {len(quadros)} quadros · escolhido o mais nítido")
            print(f"  resolução : {melhor.largura}×{melhor.altura}")
            print(f"  nitidez   : {melhor.nitidez:.1f}")
            print(f"  detalhe   : {det:.3f}")
            print(f"  saturação : {sat:.2f}")
            print(f"  estourado : {est:.1%}   cortado: {cortado:.1%}")
            if det < 0.08:
                print("  ⚠️  detalhe baixo — imagem esticada (1080N?) ou tela fixa")
            if sat < 0.05:
                print("  ⚠️  sem cor — infravermelho, ou tela de 'sem sinal'")

            if args.salvar:
                if imagens.escrever(args.salvar, melhor.imagem):
                    print(f"\n  salvo em {args.salvar}")
                else:
                    print(f"\n  não consegui salvar em {args.salvar}", file=sys.stderr)
            print()
            return 0

        if args.acao == "eventos":
            print(f"\nouvindo {args.host} · códigos=[{args.codigos}] · Ctrl+C para parar")
            print("o MHDX fecha a conexão a cada evento; religar é o normal aqui\n")
            n = 0

            def religou(espera, houve_evento):
                # Mostrar a religação é o que separa "está ouvindo e nada
                # aconteceu" de "o caminho caiu" — as duas se parecem.
                if args.verboso or not houve_evento:
                    print(f"       … religando em {espera:.0f}s")

            for e in cliente.eventos(
                args.codigos, keepalive=args.keepalive, ao_religar=religou
            ):
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


def _area_para_zona(texto: str | None) -> tuple[Zona | None, float]:
    """`--area x1,y1,x2,y2` em fração do quadro → zona retangular.

    Sem `--area`, devolve `(None, _)`: o quadro inteiro vai ao modelo. É a
    opção de análise completa — serve quando a cena toda é o objeto da
    pergunta, e paga com menos detalhe por centímetro.

    A margem vai a **zero** quando a área é explícita. Os 5% do padrão
    existem para polígono desenhado a olho, onde a folga ajuda; um
    retângulo que o usuário escolheu já é a resposta dele.
    """
    if not texto:
        return None, 0.0

    try:
        partes = [float(x) for x in texto.split(",")]
    except ValueError:
        raise SystemExit("--area quer quatro números: x1,y1,x2,y2 (fração 0..1)")
    if len(partes) != 4:
        raise SystemExit("--area quer quatro números: x1,y1,x2,y2 (fração 0..1)")

    x1, y1, x2, y2 = partes
    if not all(0.0 <= v <= 1.0 for v in partes):
        raise SystemExit("--area é em fração do quadro (0..1), não em pixels")
    if x2 <= x1 or y2 <= y1:
        raise SystemExit("--area precisa de x2 > x1 e y2 > y1")

    return (
        Zona(
            id="area",
            nome="área marcada",
            poligono=[(x1, y1), (x2, y1), (x2, y2), (x1, y2)],
        ),
        0.0,
    )


def _mostrar_analise(i: int, r, marcou_area: bool, simulado: bool = False) -> None:
    """Uma linha de cabeçalho por análise, detalhes embaixo."""
    v = r.veredito

    if v is None:
        print(f"  {i:02d} · ✗ {r.erro}")
        if not r.cena_utilizavel:
            print("       Isso não é falha do modelo: o canal não entregou cena.")
            print("       Câmera ligada nesse canal? Lente tampada? Ambiente escuro?")
        return

    marca = {
        "conforme": "✓",
        "nao_conforme": "✗",
        "nao_avaliavel": "?",
    }.get(v.resultado.value, "·")
    conf = f"{v.confianca:.0%}" if v.confianca is not None else "—"
    print(f"  {i:02d} · {marca} {v.resultado.value}  confiança {conf}  {r.ms_total} ms")
    if v.motivo:
        print(f"       {v.motivo}")

    detalhe = f"{r.enviado_largura}×{r.enviado_altura}, {r.enviado_bytes / 1024:.0f} kB"
    if r.px_por_cm:
        detalhe += f", {r.px_por_cm} px/cm no modelo"
    print(f"       enviado: {detalhe}")

    if v.tokens_entrada:
        custo = f", R$ {v.custo_centavos / 100:.4f}" if v.custo_centavos else ""
        print(f"       {v.modelo}: {v.tokens_entrada} entrada / "
              f"{v.tokens_saida} saída{custo}")

    # O simulador SORTEIA a confiança a partir do hash da imagem
    # (0,60 a 0,95). Diagnosticar essa oscilação como se fosse medida manda
    # alguém investigar foco e contraluz por causa de um número inventado —
    # aconteceu no primeiro uso em campo, 05/10/2026 (ERR-008).
    if simulado:
        print("       (a confiança acima é sorteada pelo simulador, não medida)")
        for aviso in r.avisos:
            print(f"       · {aviso}")
        return

    # Confiança baixa não é só um número: é o gancho da recomendação de
    # equipamento. Enquanto a tela não existe, o diagnóstico sai aqui — e
    # sai apontando a causa medida, não "troque a câmera".
    if v.confianca is not None and v.confianca < 0.70:
        print("       ⚠ confiança abaixo de 70% — este veredito não se sustenta.")
        if r.nitidez is not None and r.nitidez < 100:
            print(f"         nitidez {r.nitidez:.0f} (baixa): foco ou sujeira na lente.")
        if r.px_por_cm and r.px_por_cm < 3:
            print(f"         {r.px_por_cm} px/cm é pouco até para estado. Aproxime a "
                  "câmera, estreite a área ou suba o envio.")
        if r.estourado and r.estourado > 0.15:
            print(f"         {r.estourado:.0%} do quadro estourado: contraluz, "
                  "precisa de WDR.")
        if not marcou_area:
            print("         Sem área marcada o detalhe se dilui no quadro todo — "
                  "marcar a área costuma resolver sem trocar de câmera.")

    for aviso in r.avisos:
        print(f"       · {aviso}")


def cmd_analisar(args: argparse.Namespace) -> int:
    """Uma análise de verdade, do canal do gravador ao veredito.

    É o comando que fecha a cadeia. Até aqui o laço rodava contra material
    gravado e o gatilho se provava sozinho; este junta câmera ao vivo,
    critério escrito à mão e juiz — e mostra **a imagem que foi enviada**,
    porque veredito sem saber o que o modelo viu não se audita.
    """
    import time as relogio

    from farol_agent.analise import analisar
    from farol_agent.dvr.dahua import ClienteDahua, ErroDoGravador
    from farol_agent.fontes.rtsp import ErroDaFonte, FonteRTSP

    zona, margem = _area_para_zona(args.area)

    if args.simulado:
        from farol_agent.juizes.simulado import JuizSimulado

        juiz = JuizSimulado()
        print("\n⚠ juiz SIMULADO — veredito determinístico pela imagem, custo zero.")
        print("  Prova a cadeia inteira. Para julgar de verdade, tire o --simulado.")
    else:
        from farol_agent.juizes.base import ErroDoJuiz
        from farol_agent.juizes.nuvem import JuizNuvem

        try:
            juiz = JuizNuvem()
        except ErroDoJuiz as e:
            print(f"\nnão consegui preparar o juiz da nuvem: {e}\n", file=sys.stderr)
            print("  A chave vem do ambiente, nunca da linha de comando", file=sys.stderr)
            print("  (argumento aparece no histórico do shell e em `ps`):",
                  file=sys.stderr)
            print('    PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."',
                  file=sys.stderr)
            print("  Ou rode com --simulado para provar a cadeia sem gastar.\n",
                  file=sys.stderr)
            return 1

    try:
        cliente = ClienteDahua(
            args.host, usuario=args.usuario, senha=_senha_do_dvr(args), porta=args.porta
        )
        url = cliente.url_rtsp(args.canal, sub=args.sub)
    except ErroDoGravador as e:
        print(f"\nnão falei com o gravador: {e}", file=sys.stderr)
        if e.dica:
            print(f"  {e.dica}", file=sys.stderr)
        print(file=sys.stderr)
        return 1

    fonte = FonteRTSP(f"canal{args.canal}", url, abrir_sub=False)

    destino = Path(args.salvar_em)
    destino.mkdir(parents=True, exist_ok=True)

    print(f"\ncritério: {args.criterio}")
    area = f"marcada {args.area}" if args.area else "quadro inteiro"
    print(f"canal {args.canal} · envio {args.envio} · área: {area}")
    if args.repetir > 1:
        print(f"\n{args.repetir} análises a cada {args.intervalo:g}s — "
              "mexa na frente da câmera entre elas.\n")
    else:
        print()

    centavos = 0.0
    falhas = 0
    feitas = 0

    try:
        for i in range(1, args.repetir + 1):
            arquivo = destino / f"analise-{datetime.now():%H%M%S}-{i:02d}.jpg"
            try:
                r = analisar(
                    fonte,
                    juiz,
                    args.criterio,
                    zona=zona,
                    margem=margem,
                    envio=args.envio,
                    rajada=args.rajada,
                    largura_zona_cm=args.largura_cm,
                    salvar_em=arquivo,
                )
            except ErroDaFonte as e:
                print(f"  {i:02d} · a fonte falhou: {e}")
                if e.dica:
                    print(f"       {e.dica}")
                falhas += 1
                break

            feitas += 1
            _mostrar_analise(i, r, bool(args.area), simulado=args.simulado)
            if r.veredito and r.veredito.custo_centavos:
                centavos += r.veredito.custo_centavos
            if r.veredito is None:
                falhas += 1

            if i < args.repetir:
                relogio.sleep(args.intervalo)
    except KeyboardInterrupt:
        print("\n  interrompido")

    print()
    if centavos and feitas:
        media = centavos / 100 / feitas
        print(f"custo de {feitas} análise(s): R$ {centavos / 100:.4f} "
              f"(R$ {media:.4f} cada)")
        # A conta que decide o produto: o preço de uma análise vezes o
        # volume de um dia de loja.
        print(f"  a 200 análises/dia numa loja: R$ {media * 200 * 30:.2f}/mês")
    print(f"imagens enviadas em {destino.resolve()}")
    print("  Abra-as: é exatamente o que o modelo viu. Veredito estranho quase")
    print("  sempre se explica aí — área torta, quadro borrado ou objeto fora.")
    print()

    return 1 if feitas == 0 or falhas == feitas else 0


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
    v.add_argument("acao",
                   choices=["descobrir", "info", "eventos", "rtsp", "quadro", "canais"])
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
    v.add_argument("--verboso", action="store_true", help="mostra cada religação")
    v.add_argument("--rajada", type=int, default=6, help="quantos quadros capturar")
    v.add_argument("--salvar", help="grava o melhor quadro neste arquivo")
    v.add_argument("--ate", type=int, help="último canal a varrer (padrão: todos)")
    v.set_defaults(func=cmd_dvr)

    a = sub.add_parser("analisar",
                       help="análise real: canal do gravador → critério → veredito")
    a.add_argument("--host", required=True, help="IP do gravador")
    a.add_argument("--porta", type=int, default=80)
    a.add_argument("--usuario", default="admin")
    a.add_argument("--canal", type=int, default=1)
    a.add_argument("--sub", action="store_true", help="sub-stream em vez do main")
    a.add_argument("--criterio", required=True,
                   help="a pergunta, em português, do jeito que se falaria a um gerente")
    a.add_argument("--area", help="x1,y1,x2,y2 em fração do quadro (0..1). "
                                  "Sem isto, analisa o quadro inteiro")
    a.add_argument("--largura-cm", type=float, dest="largura_cm",
                   help="quanto a ÁREA cobre no mundo real, em cm — habilita o px/cm")
    a.add_argument("--envio", default="r640", choices=sorted(RESOLUCOES),
                   help="degrau de envio (padrão r640)")
    a.add_argument("--rajada", type=int, default=6, help="quadros capturados por análise")
    a.add_argument("--repetir", type=int, default=1, help="quantas análises seguidas")
    a.add_argument("--intervalo", type=float, default=4.0,
                   help="segundos entre análises, para dar tempo de mexer na cena")
    a.add_argument("--salvar-em", default="./analises", dest="salvar_em",
                   help="pasta onde ficam as imagens ENVIADAS")
    a.add_argument("--simulado", action="store_true",
                   help="não chama a API: prova a cadeia sem gastar")
    a.set_defaults(func=cmd_analisar)

    args = p.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
